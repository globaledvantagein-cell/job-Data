import { CATEGORY_LABELS } from '../../../core/categorize.js';
import { escapeHtml } from './formatters.js';

/**
 * Section heading for a category bucket.
 */
export function renderCategoryHeading(categoryId, jobCount) {
    const label = escapeHtml(CATEGORY_LABELS[categoryId] || 'Other');
    const noun = jobCount === 1 ? 'role' : 'roles';
    return `
<p style="font-size: 11px; font-weight: 800; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin: 28px 0 14px;">
    ${label} <span style="color: #d1d5db; font-weight: 600;">·</span> <span style="color: #9ca3af; font-weight: 600;">${jobCount} ${noun}</span>
</p>`;
}

/**
 * Top-of-email summary block.
 */
export function renderSummary({ totalJobs, categoryCount }) {
    if (totalJobs <= 0) return '';
    const jobNoun = totalJobs === 1 ? 'role' : 'roles';
    const catNoun = categoryCount === 1 ? 'category' : 'categories';
    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px; border-collapse: collapse;">
    <tr>
        <td style="padding: 16px 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-left: 3px solid #6C9CFF; border-radius: 8px;">
            <div style="font-size: 14px; color: #374151; line-height: 1.5;">
                <strong style="color: #111827;">${totalJobs}</strong> new ${jobNoun} across <strong style="color: #111827;">${categoryCount}</strong> ${catNoun} you follow
            </div>
        </td>
    </tr>
</table>`;
}

/**
 * Branded header — solid colors only (gradients don't render on iOS Mail).
 */
export function renderHeaderBanner() {
    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px; border-collapse: collapse;">
    <tr>
        <td style="padding: 32px 24px 28px; background-color: #0f1620; border-radius: 12px 12px 0 0; text-align: center;">
            <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; line-height: 1;">
                English <span style="color: #6C9CFF; font-style: italic;">Jobs</span>
            </div>
            <div style="font-size: 10px; color: #8a94a6; text-transform: uppercase; letter-spacing: 3px; margin-top: 8px; font-weight: 600;">
                in Germany
            </div>
        </td>
    </tr>
    <tr>
        <td style="height: 3px; background-color: #6C9CFF; border-radius: 0 0 12px 12px; line-height: 3px; font-size: 1px;">&nbsp;</td>
    </tr>
</table>`;
}

/**
 * Footer with support contact + unsubscribe link.
 */
export function renderFooter(unsubscribeUrl) {
    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 36px 0 0; border-collapse: collapse;">
    <tr><td style="height: 1px; background: #e5e7eb; line-height: 1px; font-size: 1px;">&nbsp;</td></tr>
</table>
<div style="padding-top: 18px; font-size: 12px; color: #9ca3af; line-height: 1.7;">
    <p style="margin: 0 0 6px;">You are receiving this because you subscribed to weekly job alerts on <strong style="color: #6b7280;">English Jobs in Germany</strong>.</p>
    <p style="margin: 0 0 6px;">Need help? Reply to this email or reach us at <a href="mailto:support@englishjobsgermany.com" style="color: #6C9CFF; text-decoration: none;">support@englishjobsgermany.com</a></p>
    <p style="margin: 0;"><a href="${unsubscribeUrl}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe from this digest</a></p>
</div>`;
}
