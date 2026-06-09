/**
 * Text/data formatters used across email templates.
 * All functions return strings (possibly empty) — never undefined.
 */

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
 *   both min+max → "€60,000 – €80,000 / year"
 *   only min     → "from €60,000 / year"
 *   only max     → "up to €80,000 / year"
 *   neither      → ''
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
