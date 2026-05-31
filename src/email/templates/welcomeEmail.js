/**
 * Welcome email — sent once after a user's FIRST Google sign-in.
 *
 * Deliberately plain and personal. No marketing fluff, no giant hero
 * images. Lands in Primary inbox, not Promotions.
 *
 * Returns { subject, html, text }
 */
import { escapeHtml, renderHeaderBanner, renderFooter } from './components.js';
import { buildUnsubscribeUrl } from '../unsubscribe.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

/**
 * @param {Object} args
 * @param {string} args.name     - User's display name from Google
 * @param {string} args.email    - User's email
 * @param {boolean} args.isSubscribed - Whether they opted into the weekly digest
 * @param {string[]} args.categories  - Category IDs they picked (may be empty)
 */
export function renderWelcomeEmail({ name, email, isSubscribed = false, categories = [] }) {
    const firstName = capitalizeFirst((name || 'there').split(' ')[0]);
    const unsubscribeUrl = buildUnsubscribeUrl(email, BASE_URL);

    const subject = `Welcome to English Jobs in Germany`;

    const html = buildHtml({ firstName, email, isSubscribed, categories, unsubscribeUrl });
    const text = buildText({ firstName, email, isSubscribed, categories, unsubscribeUrl });

    return { subject, html, text };
}

function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── HTML version ──────────────────────────────────────────────────────────

function buildHtml({ firstName, email, isSubscribed, categories, unsubscribeUrl }) {
    const digestSection = isSubscribed
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; border-collapse: collapse;">
                <tr>
                    <td style="padding: 16px 20px; background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 3px solid #22c55e; border-radius: 8px;">
                        <div style="font-size: 14px; color: #166534; font-weight: 600; margin-bottom: 4px;">✓ Weekly digest activated</div>
                        <div style="font-size: 13px; color: #4b5563; line-height: 1.5;">
                            You'll receive a curated email every Monday with new English-speaking roles matching your preferences.
                            ${categories.length > 0 ? `<br/>Your categories: <strong style="color: #111827;">${escapeHtml(categories.join(', '))}</strong>` : ''}
                        </div>
                    </td>
                </tr>
            </table>`
        : `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; border-collapse: collapse;">
                <tr>
                    <td style="padding: 16px 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-left: 3px solid #6C9CFF; border-radius: 8px;">
                        <div style="font-size: 13px; color: #4b5563; line-height: 1.5;">
                            Want weekly job alerts? You can subscribe anytime from your
                            <a href="${BASE_URL}/alerts" style="color: #6C9CFF; text-decoration: none; font-weight: 600;">alerts page</a>
                            or <a href="${BASE_URL}/profile" style="color: #6C9CFF; text-decoration: none; font-weight: 600;">profile</a>.
                        </div>
                    </td>
                </tr>
            </table>`;

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px 20px;">

    ${renderHeaderBanner()}

    <p style="font-size: 17px; line-height: 1.5; margin: 0 0 8px; color: #111827; font-weight: 600; letter-spacing: -0.2px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 6px; color: #4b5563;">
        Welcome to English Jobs in Germany! Your account is set up and ready to go.
    </p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 24px; color: #4b5563;">
        You now have full access to every English-speaking role we track across Germany — complete descriptions, salary details, and direct apply links.
    </p>

    ${digestSection}

    <p style="font-size: 14px; line-height: 1.6; margin: 24px 0 0;">
        <a href="${BASE_URL}/jobs" style="display: inline-block; padding: 12px 28px; background: #1F6FEB; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 14px;">Browse Jobs Now</a>
    </p>

    <p style="font-size: 13px; color: #9ca3af; margin: 28px 0 0; line-height: 1.6;">
        This is a one-time welcome email. You won't receive this again.
    </p>

    ${isSubscribed ? renderFooter(unsubscribeUrl) : renderSimpleFooter()}

</div>`;
}

function renderSimpleFooter() {
    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 36px 0 0; border-collapse: collapse;">
    <tr><td style="height: 1px; background: #e5e7eb; line-height: 1px; font-size: 1px;">&nbsp;</td></tr>
</table>
<div style="padding-top: 18px; font-size: 12px; color: #9ca3af; line-height: 1.7;">
    <p style="margin: 0 0 6px;">Questions? Reply to this email or reach us at <a href="mailto:support@englishjobsgermany.com" style="color: #6C9CFF; text-decoration: none;">support@englishjobsgermany.com</a></p>
    <p style="margin: 0;">English Jobs in Germany</p>
</div>`;
}

// ─── Plain text version ────────────────────────────────────────────────────

function buildText({ firstName, email, isSubscribed, categories, unsubscribeUrl }) {
    const lines = [];
    lines.push('English Jobs in Germany');
    lines.push('');
    lines.push(`Hi ${firstName},`);
    lines.push('');
    lines.push('Welcome to English Jobs in Germany! Your account is set up and ready to go.');
    lines.push('');
    lines.push('You now have full access to every English-speaking role we track across Germany — complete descriptions, salary details, and direct apply links.');
    lines.push('');

    if (isSubscribed) {
        lines.push('✓ Weekly digest activated');
        lines.push("You'll receive a curated email every Monday with new English-speaking roles matching your preferences.");
        if (categories.length > 0) {
            lines.push(`Your categories: ${categories.join(', ')}`);
        }
    } else {
        lines.push('Want weekly job alerts? Subscribe anytime:');
        lines.push(`${BASE_URL}/alerts`);
    }

    lines.push('');
    lines.push(`Browse Jobs: ${BASE_URL}/jobs`);
    lines.push('');
    lines.push('---');
    lines.push('This is a one-time welcome email. You will not receive this again.');
    lines.push('Questions? Contact support@englishjobsgermany.com');
    if (isSubscribed) {
        lines.push(`Unsubscribe from digest: ${unsubscribeUrl}`);
    }

    return lines.join('\n');
}
