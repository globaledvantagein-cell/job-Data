/**
 * Low-level SES send primitives.
 *
 * sendEmail()     — one recipient, one message. Always personalized.
 * sendBulkEmails() — many recipients, each with their own personalized
 *                    content. Respects SES rate limits (14/sec default).
 *
 * We do NOT use SES's SendBulkEmail / templates feature because every
 * digest is personalized (different jobs per user). Instead we send N
 * individual messages in parallel batches with rate limiting.
 */
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { getSesClient, FROM_EMAIL, FROM_NAME, REPLY_TO } from './client.js';

// SES sandbox limit is 1/sec. Production default is 14/sec. We default
// conservatively so it works in both. Override via env if you bump quota.
const SEND_RATE_PER_SECOND = Number(process.env.SES_SEND_RATE_PER_SECOND) || 10;

/**
 * Send a single email.
 *
 * @param {Object} msg
 * @param {string} msg.to              - recipient email
 * @param {string} msg.subject
 * @param {string} msg.html
 * @param {string} msg.text
 * @param {string} [msg.unsubscribeUrl] - if provided, adds List-Unsubscribe headers
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
    const client = getSesClient();

    const command = new SendEmailCommand({
        FromEmailAddress: `${FROM_NAME} <${FROM_EMAIL}>`,
        ReplyToAddresses: [REPLY_TO],
        Destination: { ToAddresses: [to] },
        Content: {
            Simple: {
                Subject: { Data: subject, Charset: 'UTF-8' },
                Body: {
                    Html: { Data: html, Charset: 'UTF-8' },
                    Text: { Data: text, Charset: 'UTF-8' },
                },
            },
        },
    });

    try {
        const response = await client.send(command);
        return { ok: true, messageId: response.MessageId };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/**
 * Send many personalized emails, respecting SES's per-second rate limit.
 *
 * Each message is an object compatible with sendEmail(). Results are
 * returned in input order. Failures are logged but don't stop the batch.
 *
 * @param {Array} messages — list of { to, subject, html, text, unsubscribeUrl, meta }
 *                           `meta` is optional user-supplied context echoed back in results.
 * @param {Object} [opts]
 * @param {number} [opts.ratePerSecond=SEND_RATE_PER_SECOND]
 * @param {Function} [opts.onProgress] - called as (sent, total, lastResult)
 * @returns {Promise<Array<{ ok, messageId?, error?, to, meta? }>>}
 */
export async function sendBulkEmails(messages, opts = {}) {
    const ratePerSecond = opts.ratePerSecond || SEND_RATE_PER_SECOND;
    const results = [];

    for (let i = 0; i < messages.length; i += ratePerSecond) {
        const chunk = messages.slice(i, i + ratePerSecond);
        const t0 = Date.now();

        const chunkResults = await Promise.all(
            chunk.map(async msg => {
                const r = await sendEmail(msg);
                return { ...r, to: msg.to, meta: msg.meta };
            }),
        );

        results.push(...chunkResults);
        if (opts.onProgress) {
            opts.onProgress(results.length, messages.length, chunkResults);
        }

        // Wait out the remainder of this 1-second window before next chunk.
        const elapsed = Date.now() - t0;
        if (i + ratePerSecond < messages.length && elapsed < 1000) {
            await new Promise(r => setTimeout(r, 1000 - elapsed));
        }
    }

    return results;
}