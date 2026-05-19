/**
 * Reusable email components.
 *
 * Rules of engagement (non-negotiable):
 *   - Inline styles only. <style> tags are stripped by Gmail/Outlook.
 *   - Tables for layout, not flexbox/grid. Outlook desktop is from 2007.
 *   - Every field is OPTIONAL. Jobs from different scrapers have different
 *     fields available — we render gracefully when fields are missing.
 *   - Keep markup boring — marketing-heavy HTML lands in Promotions.
 */


import { CATEGORY_LABELS } from '../../core/categorize.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Escape user-supplied strings before injecting into HTML.
 * Job titles and company names can contain &, <, >, ", '.
 */
export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Format a Date / ISO string as "N days ago" / "today" / "yesterday".
 */
export function formatPostedDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}

/**
 * "FullTime" → "Full Time", "PartTime" → "Part Time".
 * Returns '' if unset.
 */
export function formatEmploymentType(raw) {
    if (!raw) return '';
    const cleaned = String(raw)
        .replace(/[_-]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/**
 * Format salary range. Handles partial data:
 *   both min+max     → "€60,000 – €80,000 / year"
 *   only min         → "from €60,000 / year"
 *   only max         → "up to €80,000 / year"
 *   neither          → ''
 */
export function formatSalary(job) {
    const { SalaryMin, SalaryMax, SalaryCurrency, SalaryInterval } = job || {};
    if (SalaryMin == null && SalaryMax == null) return '';

    const symbol = currencySymbol(SalaryCurrency);
    const fmt = n => `${symbol}${Number(n).toLocaleString('en-US')}`;
    const interval = formatInterval(SalaryInterval);

    let amount;
    if (SalaryMin != null && SalaryMax != null) {
        if (SalaryMin === SalaryMax) amount = fmt(SalaryMin);
        else amount = `${fmt(SalaryMin)} – ${fmt(SalaryMax)}`;
    } else if (SalaryMin != null) {
        amount = `from ${fmt(SalaryMin)}`;
    } else {
        amount = `up to ${fmt(SalaryMax)}`;
    }

    return interval ? `${amount} ${interval}` : amount;
}

function currencySymbol(code) {
    if (!code) return '';
    const map = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };
    return map[String(code).toUpperCase()] || `${code} `;
}

function formatInterval(interval) {
    if (!interval) return '';
    const i = String(interval).toLowerCase();
    if (i.includes('year') || i === 'annual') return '/ year';
    if (i.includes('month')) return '/ month';
    if (i.includes('hour')) return '/ hour';
    if (i.includes('day')) return '/ day';
    return '';
}

export function formatLocation(job) {
    return (job?.Location || 'Germany').trim() || 'Germany';
}

/** Returns "Remote" / "Hybrid" / null. */
export function workplaceLabel(job) {
    if (job?.IsRemote) return 'Remote';
    const wp = String(job?.WorkplaceType || '').toLowerCase();
    if (wp === 'remote') return 'Remote';
    if (wp === 'hybrid') return 'Hybrid';
    return null;
}

// ─── Company logo (deterministic colored initial avatar) ──────────────────

// Pleasant palette — picks one based on company name hash so the same
// company always gets the same color across emails.
const LOGO_COLORS = [
    { bg: '4f46e5', fg: 'ffffff' }, // indigo
    { bg: '0891b2', fg: 'ffffff' }, // cyan
    { bg: 'db2777', fg: 'ffffff' }, // pink
    { bg: '059669', fg: 'ffffff' }, // emerald
    { bg: 'd97706', fg: 'ffffff' }, // amber
    { bg: '7c3aed', fg: 'ffffff' }, // violet
    { bg: '0284c7', fg: 'ffffff' }, // sky
    { bg: 'be123c', fg: 'ffffff' }, // rose
];

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

/**
 * Returns a small letter-avatar URL via ui-avatars.com.
 * Always works — no need for company domain.
 * Color is deterministic per-company name (same company = same color).
 */
export function companyLogoUrl(companyName, size = 80) {
    const name = (companyName || 'Company').trim();
    const palette = LOGO_COLORS[hashString(name) % LOGO_COLORS.length];
    const params = new URLSearchParams({
        name,
        size: String(size),
        background: palette.bg,
        color: palette.fg,
        rounded: 'true',
        bold: 'true',
        'font-size': '0.45',
    });
    return `https://ui-avatars.com/api/?${params.toString()}`;
}

// ─── Render helpers ───────────────────────────────────────────────────────

function pill(text, { color = '#374151', bg = '#f3f4f6', border = '#e5e7eb' } = {}) {
    return `<span style="display: inline-block; padding: 3px 9px; font-size: 10px; font-weight: 700; color: ${color}; background: ${bg}; border: 1px solid ${border}; border-radius: 12px; margin-right: 4px; letter-spacing: 0.3px; text-transform: uppercase;">${escapeHtml(text)}</span>`;
}

/**
 * Job row with two-column layout:
 *   [logo 48px] | [title, company, salary, meta]
 *
 * Uses an outer table for the row layout (email-safe) and nested table for
 * the right column. Everything is optional except title and company.
 */
export function renderJobCard(job, baseUrl) {
    const title = escapeHtml(job.JobTitle);
    const company = escapeHtml(job.Company);
    const location = escapeHtml(formatLocation(job));
    const jobUrl = `${baseUrl}/jobs?id=${encodeURIComponent(job._id?.toString?.() || job.JobID)}`;
    const logo = companyLogoUrl(job.Company, 96);

    // Optional pieces
    const employment = formatEmploymentType(job.EmploymentType);
    const posted = formatPostedDate(job.PostedDate);
    const salary = formatSalary(job);
    const workplace = workplaceLabel(job);

    const workplacePill = workplace
        ? pill(workplace, { color: '#065f46', bg: '#d1fae5', border: '#a7f3d0' })
        : '';

    // Salary line — only if we have data
    const salaryLine = salary
        ? `<div style="font-size: 13px; color: #059669; font-weight: 700; margin-top: 6px; letter-spacing: -0.1px;">${escapeHtml(salary)}</div>`
        : '';

    // Meta line — employment · posted-date
    const metaParts = [];
    if (employment) metaParts.push(escapeHtml(employment));
    if (posted) metaParts.push(escapeHtml(posted));
    const metaLine = metaParts.length
        ? `<div style="font-size: 11px; color: #9ca3af; margin-top: 8px; font-weight: 500; letter-spacing: 0.2px; text-transform: uppercase;">${metaParts.join(' · ')}</div>`
        : '';

    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 12px; border-collapse: collapse;">
    <tr>
        <td style="padding: 16px 18px; border: 1px solid #e5e7eb; border-radius: 10px; background: #ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                <tr>
                    <td width="60" valign="top" style="padding-right: 14px;">
                        <img src="${logo}" alt="${company}" width="48" height="48" style="display: block; border-radius: 10px; width: 48px; height: 48px;" />
                    </td>
                    <td valign="top">
                        <a href="${jobUrl}" style="font-size: 15px; font-weight: 700; color: #111827; text-decoration: none; line-height: 1.35; letter-spacing: -0.1px;">${title}</a>
                        ${workplacePill ? `<div style="margin-top: 8px;">${workplacePill}</div>` : ''}
                        <div style="font-size: 13px; color: #4b5563; margin-top: 7px; line-height: 1.5;">
                            <span style="font-weight: 600; color: #1f2937;">${company}</span>
                            <span style="color: #9ca3af;"> · </span>
                            <span style="font-weight: 500; color: #374151;">${location}</span>
                        </div>
                        ${salaryLine}
                        ${metaLine}
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>`;
}

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
 * Branded header — solid colors only (gradients don't render on iOS Mail / mobile Gmail).
 * Uses a refined dark navy palette with an accent strip below for premium feel.
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