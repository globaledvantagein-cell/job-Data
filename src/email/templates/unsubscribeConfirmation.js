/**
 * Unsubscribe confirmation email — sent when a user unsubscribes from
 * the weekly digest (from profile, or via one-click email link).
 *
 * Returns { subject, html, text }
 */
import { escapeHtml, renderHeaderBanner } from './components.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

/**
 * @param {Object} args
 * @param {string} args.name   - User's display name
 * @param {string} args.email  - User's email
 */
export function renderUnsubscribeConfirmation({ name, email }) {
    const firstName = capitalizeFirst((name || 'there').split(' ')[0]);

    const subject = `You've been unsubscribed — English Jobs Germany`;

    const html = buildHtml({ firstName });
    const text = buildText({ firstName });

    return { subject, html, text };
}

function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── HTML version ──────────────────────────────────────────────────────────

function buildHtml({ firstName }) {
    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px 20px;">

    ${renderHeaderBanner()}

    <p style="font-size: 17px; line-height: 1.5; margin: 0 0 8px; color: #111827; font-weight: 600; letter-spacing: -0.2px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 24px; color: #4b5563;">
        You've been successfully unsubscribed from the weekly job digest. You won't receive any more weekly emails from us.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; border-collapse: collapse;">
        <tr>
            <td style="padding: 16px 20px; background: #fef2f2; border: 1px solid #fecaca; border-left: 3px solid #ef4444; border-radius: 8px;">
                <div style="font-size: 14px; color: #991b1b; font-weight: 700; margin-bottom: 6px;">Subscription cancelled</div>
                <div style="font-size: 13px; color: #6b7280; line-height: 1.5;">
                    You will no longer receive the Monday digest.
                </div>
            </td>
        </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; border-collapse: collapse;">
        <tr>
            <td style="padding: 14px 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                <div style="font-size: 13px; color: #4b5563; line-height: 1.6;">
                    Changed your mind? You can re-subscribe anytime from your 
                    <a href="${BASE_URL}/profile" style="color: #1F6FEB; text-decoration: none; font-weight: 600;">profile page</a> 
                    or the <a href="${BASE_URL}/alerts" style="color: #1F6FEB; text-decoration: none; font-weight: 600;">alerts page</a>.
                </div>
            </td>
        </tr>
    </table>

    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
        <a href="${BASE_URL}/jobs" style="display: inline-block; padding: 12px 28px; background: #1F6FEB; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 14px;">Browse Jobs</a>
    </p>

    <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 11px; color: #9ca3af; line-height: 1.5; margin: 0;">
            This is a confirmation of your unsubscribe request. You won't receive further weekly emails unless you re-subscribe.
        </p>
        <p style="font-size: 11px; color: #9ca3af; line-height: 1.5; margin: 8px 0 0;">
            Need help? Contact <a href="mailto:support@englishjobsgermany.com" style="color: #6C9CFF; text-decoration: none;">support@englishjobsgermany.com</a>
        </p>
    </div>

</div>`;
}

// ─── Plain text version ────────────────────────────────────────────────────

function buildText({ firstName }) {
    const lines = [];
    lines.push('English Jobs in Germany');
    lines.push('');
    lines.push(`Hi ${firstName},`);
    lines.push('');
    lines.push("You've been successfully unsubscribed from the weekly job digest. You won't receive any more weekly emails from us.");
    lines.push('');
    lines.push('Subscription cancelled');
    lines.push('You will no longer receive the Monday digest.');
    lines.push('');
    lines.push('Changed your mind? You can re-subscribe anytime:');
    lines.push(`  Profile: ${BASE_URL}/profile`);
    lines.push(`  Alerts: ${BASE_URL}/alerts`);
    lines.push('');
    lines.push(`Browse Jobs: ${BASE_URL}/jobs`);
    lines.push('');
    lines.push('---');
    lines.push('This is a confirmation of your unsubscribe request.');
    lines.push('Need help? Contact support@englishjobsgermany.com');

    return lines.join('\n');
}