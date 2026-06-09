// Banned Roles (Noise Filter) - Keep this strict
/**
 * Normalizes a company name by stripping legal entity suffixes.
 * Used to detect that "Databricks GmbH" and "Databricks, Inc." are the same company.
 *
 * Examples:
 *   "Databricks GmbH"          → "databricks"
 *   "Databricks, Inc."         → "databricks"
 *   "Databricks B.V."          → "databricks"
 *   "Databricks U.K. Limited"  → "databricks u.k."  (close enough for matching)
 *   "Trade Republic"           → "trade republic"    (no suffix to strip)
 *
 * @param {string} company - Raw company name
 * @returns {string} Normalized lowercase company name
 */
export function normalizeCompanyName(company) {
    if (!company) return '';

    let normalized = String(company).trim().toLowerCase();

    // Remove common legal suffixes (order matters — longer patterns first)
    const suffixes = [
        // German
        'gesellschaft mit beschränkter haftung', 'gmbh & co. kg', 'gmbh & co kg',
        'gmbh & co.', 'gmbh & co', 'gmbh', 'ag & co. kgaa', 'ag & co kgaa', 'ag', 'e.v.', 'ohg', 'kg',
        // English
        'incorporated', 'corporation', 'limited liability company',
        'inc.', 'inc', 'corp.', 'corp', 'llc', 'llp', 'ltd.', 'ltd', 'limited', 'plc',
        // European
        'b.v.', 'bv', 'n.v.', 'nv',           // Dutch
        's.a.r.l.', 'sarl', 's.a.r.l', 'sàrl', // French/Luxembourg
        's.a.', 'sa',                            // French/Spanish
        's.r.l.', 'srl',                         // Italian/Romanian
        's.p.a.', 'spa',                         // Italian
        'a.s.', 'as',                            // Nordic
        'oy', 'oyj',                             // Finnish
        'ab',                                    // Swedish
        'a/s',                                   // Danish
        'aps',                                   // Danish
        'se',                                    // European Company
    ];

    for (const suffix of suffixes) {
        // Match suffix at end of string, possibly preceded by comma or space
        const pattern = new RegExp(`[,\s]+${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*$`, 'i');
        normalized = normalized.replace(pattern, '');
    }

    // Also try without preceding comma/space (e.g., "CompanyGmbH" — rare but possible)
    for (const suffix of suffixes) {
        if (normalized.endsWith(suffix)) {
            const before = normalized.slice(0, -suffix.length).trim();
            if (before.length > 1) {
                normalized = before;
                break; // Only strip one suffix
            }
        }
    }

    // Clean up remaining punctuation and extra spaces
    normalized = normalized.replace(/[,.\-]+$/, '').replace(/\s+/g, ' ').trim();

    return normalized;
}

/**
 * Generates a dedup key for cross-entity duplicate detection.
 * Combines normalized company name + job title + primary city.
 *
 * @param {string} title - Job title
 * @param {string} company - Company name (will be normalized)
 * @param {string} location - Location string (we extract the first city)
 * @returns {string} A dedup key like "databricks|staff software engineer - backend|berlin"
 */
export function generateCrossEntityKey(title, company, location) {
    const normalizedCompany = normalizeCompanyName(company);
    const normalizedTitle = String(title || '').toLowerCase().trim();

    // Extract first city from location (before comma, semicolon, pipe, or dash)
    const rawLocation = String(location || '').toLowerCase().trim();
    const primaryCity = rawLocation.split(/[,;|–—\-]/)[0].trim()
        // Remove common prefixes that aren't cities
        .replace(/^(remote\s*[-–—]?\s*)/i, '')
        .trim();

    return `${normalizedCompany}|${normalizedTitle}|${primaryCity}`;
}
