/**
 * Visual branding helpers: deterministic letter-avatar URLs per company.
 * Same company name always gets the same color across emails.
 */

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
 * Letter-avatar URL via ui-avatars.com. Always works (no company domain needed).
 * Color is deterministic per-company name.
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
