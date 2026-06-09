import crypto from 'crypto';

/**
 * Generates a fingerprint hash for a job based on its core content.
 * Used to detect if we've already analyzed this exact job before.
 * 
 * We use title + company + first 500 chars of description.
 * Why first 500? Because the full description might have tiny formatting changes
 * between scrapes (extra spaces, updated dates), but the first 500 chars of the
 * actual job content stays the same.
 * 
 * @param {string} title - Job title
 * @param {string} company - Company name
 * @param {string} description - Job description
 * @returns {string} A 32-character hex hash
 */
export function generateJobFingerprint(title, company, description) {
    const normalizedTitle = String(title || '').toLowerCase().trim();
    const normalizedCompany = String(company || '').toLowerCase().trim();
    const normalizedDesc = String(description || '').toLowerCase().trim().substring(0, 500);

    const raw = `${normalizedTitle}|${normalizedCompany}|${normalizedDesc}`;
    return crypto.createHash('md5').update(raw).digest('hex');
}
