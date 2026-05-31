/**
 * Subscription confirmation email — sent when a user subscribes to
 * the weekly digest (either from the /alerts page or during signup).
 *
 * Returns { subject, html, text }
 */
import { escapeHtml, renderHeaderBanner, renderFooter } from './components.js';
import { buildUnsubscribeUrl } from '../unsubscribe.js';
import { CATEGORY_LABELS } from '../../core/categorize.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

/**
 * @param {Object} args
 * @param {string} args.name       - User's display name
 * @param {string} args.email      - User's email
 * @param {string[]} args.categories - Category IDs they subscribed to
 */
export function renderSubscriptionConfirmation({ name, email, categories = [] }) {
    const firstName = capitalizeFirst((name || 'there').split(' ')[0]);
    const unsubscribeUrl = buildUnsubscribeUrl(email, BASE_URL);

    const subject = `You're subscribed — weekly job alerts activated`;

    const html = buildHtml({ firstName, email, categories, unsubscribeUrl });
    const text = buildText({ firstName, email, categories, unsubscribeUrl });

    return { subject, html, text };
}

function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function categoryLabel(id) {
    return CATEGORY_LABELS[id] || id;
}

// ─── HTML version ──────────────────────────────────────────────────────────

function buildHtml({ firstName, email, categories, unsubscribeUrl }) {
    const categoryList = categories.length > 0
        ? categories.map(c =>
            `<li style="font-size: 13px; color: #1f2937; padding: 4px 0;">${escapeHtml(categoryLabel(c))}</li>`
        ).join('')
        : '<li style="font-size: 13px; color: #6b7280; padding: 4px 0; font-style: italic;">All categories (none specifically selected)</li>';

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px 20px;">

    ${renderHeaderBanner()}

    <p style="font-size: 17px; line-height: 1.5; margin: 0 0 8px; color: #111827; font-weight: 600; letter-spacing: -0.2px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 24px; color: #4b5563;">
        You're all set! You'll receive a weekly digest every Monday with fresh English-speaking roles in Germany that match your preferences.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; border-collapse: collapse;">
        <tr>
            <td style="padding: 16px 20px; background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 3px solid #22c55e; border-radius: 8px;">
                <div style="font-size: 14px; color: #166534; font-weight: 700; margin-bottom: 10px;">✓ Subscription confirmed</div>
                <div style="font-size: 12px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Your categories:</div>
                <ul style="margin: 0; padding: 0 0 0 18px; list-style-type: disc;">
                    ${categoryList}
                </ul>
            </td>
        </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; border-collapse: collapse;">
        <tr>
            <td style="padding: 14px 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                <div style="font-size: 11px; color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">What to expect</div>
                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                    <tr>
                        <td style="padding: 3px 0; font-size: 13px; color: #4b5563; line-height: 1.5;">
                            <strong style="color: #111827;">When:</strong> Every Monday morning
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 3px 0; font-size: 13px; color: #4b5563; line-height: 1.5;">
                            <strong style="color: #111827;">What:</strong> Up to 8 curated roles matching your categories
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 3px 0; font-size: 13px; color: #4b5563; line-height: 1.5;">
                            <strong style="color: #111827;">From:</strong> Only verified English-speaking positions
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
        <a href="${BASE_URL}/jobs" style="display: inline-block; padding: 12px 28px; background: #1F6FEB; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 14px;">Browse Jobs Now</a>
    </p>
    <p style="font-size: 13px; color: #9ca3af; margin: 4px 0 0; line-height: 1.5;">
        You can update your preferences or unsubscribe anytime from your <a href="${BASE_URL}/profile" style="color: #6C9CFF; text-decoration: none;">profile</a>.
    </p>

    ${renderFooter(unsubscribeUrl)}

</div>`;
}

// ─── Plain text version ────────────────────────────────────────────────────

function buildText({ firstName, email, categories, unsubscribeUrl }) {
    const lines = [];
    lines.push('English Jobs in Germany');
    lines.push('');
    lines.push(`Hi ${firstName},`);
    lines.push('');
    lines.push("You're all set! You'll receive a weekly digest every Monday with fresh English-speaking roles in Germany that match your preferences.");
    lines.push('');
    lines.push('✓ Subscription confirmed');
    lines.push('');
    lines.push('Your categories:');
    if (categories.length > 0) {
        categories.forEach(c => lines.push(`  • ${categoryLabel(c)}`));
    } else {
        lines.push('  • All categories');
    }
    lines.push('');
    lines.push('What to expect:');
    lines.push('  When: Every Monday morning');
    lines.push('  What: Up to 8 curated roles matching your categories');
    lines.push('  From: Only verified English-speaking positions');
    lines.push('');
    lines.push(`Browse Jobs: ${BASE_URL}/jobs`);
    lines.push('');
    lines.push('You can update your preferences or unsubscribe anytime from your profile.');
    lines.push(`Profile: ${BASE_URL}/profile`);
    lines.push('');
    lines.push('---');
    lines.push('You are receiving this because you subscribed to weekly job alerts on English Jobs in Germany.');
    lines.push('Need help? Contact support@englishjobsgermany.com');
    lines.push(`Unsubscribe: ${unsubscribeUrl}`);

    return lines.join('\n');
}
