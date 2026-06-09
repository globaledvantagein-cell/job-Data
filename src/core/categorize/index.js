/**
 * Job category classifier — 6 buckets total.
 *
 * Top-level:    Technical | Non-Technical
 * Sub-buckets:
 *   Technical:     software | data | product_tech | other_tech
 *   Non-Technical: product_nontech | other_nontech
 *
 * Cascade order (first match wins):
 *   1. OVERRIDES — manual patches for known leaks
 *   2. TITLE keywords — strongest signal (Non-Tech/Marketing first, then Data,
 *      then Software, then Product)
 *   3. SUBDOMAIN keywords — backup when title is vague
 *   4. DOMAIN field — coarse fallback
 *   5. PRODUCT split — if a job lands in Product, split into product_tech vs
 *      product_nontech using Domain + SubDomain + Tags
 *
 * Pure function. Run once at scrape time, store result in MongoDB Category field.
 */
import {
    NONTECH_TITLE_KW,
    DATA_TITLE_KW,
    SOFTWARE_TITLE_KW,
    PRODUCT_TITLE_KW,
    DATA_SUBDOMAIN_KW,
    SOFTWARE_SUBDOMAIN_KW,
    PRODUCT_SUBDOMAIN_KW,
    OVERRIDES,
} from './keywords.js';

export const CATEGORY_LABELS = {
    software:        'Software Engineering',
    data:            'Data / AI',
    product_tech:    'Product (Tech)',
    other_tech:      'Other Technical',
    product_nontech: 'Product (Non-Tech)',
    other_nontech:   'Other Non-Technical',
};

export const CATEGORY_ORDER = [
    'software',
    'data',
    'product_tech',
    'other_tech',
    'product_nontech',
    'other_nontech',
];

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

// ─── Helpers ───────────────────────────────────────────────────────────

function lower(s) {
    return (s ?? '').toString().toLowerCase();
}

function pad(s) {
    return ` ${s} `;
}

function anyMatch(haystack, keywords) {
    for (const kw of keywords) {
        if (haystack.includes(kw)) return true;
    }
    return false;
}

/**
 * Classify one job into one of the 6 Category buckets.
 *
 * Expected fields (all optional except domain hint):
 *   JobTitle, Department, SubDomain, Domain ('Technical'|'Non-Technical'), Tags
 *
 * Returns one of CATEGORY_ORDER values, never null/undefined.
 */
export function categorizeJob(job) {
    if (!job) return 'other_nontech';

    const title = pad(lower(job.JobTitle));
    const subdomain = pad(lower(job.SubDomain));
    const department = pad(lower(job.Department));

    // LAYER 1: Manual overrides
    for (const ov of OVERRIDES) {
        if (title.includes(ov.pattern.toLowerCase())) {
            return ov.category;
        }
    }

    // LAYER 2: Title keywords
    if (anyMatch(title, NONTECH_TITLE_KW)) return 'other_nontech';
    if (anyMatch(title, DATA_TITLE_KW))    return 'data';
    if (anyMatch(title, SOFTWARE_TITLE_KW)) return 'software';
    if (anyMatch(title, PRODUCT_TITLE_KW)) return splitProduct(job);

    // LAYER 3: SubDomain keywords
    if (anyMatch(subdomain, DATA_SUBDOMAIN_KW))     return 'data';
    if (anyMatch(subdomain, SOFTWARE_SUBDOMAIN_KW)) return 'software';
    if (anyMatch(subdomain, PRODUCT_SUBDOMAIN_KW))  return splitProduct(job);

    // Also try Department field as a last keyword check
    if (anyMatch(department, SOFTWARE_SUBDOMAIN_KW)) return 'software';
    if (anyMatch(department, DATA_SUBDOMAIN_KW))     return 'data';

    // LAYER 4: Domain fallback
    return job.Domain === 'Technical' ? 'other_tech' : 'other_nontech';
}

/**
 * Decide if a Product role is Tech-PM or Non-Tech-PM.
 */
function splitProduct(job) {
    if (job.Domain === 'Technical')     return 'product_tech';
    if (job.Domain === 'Non-Technical') return 'product_nontech';

    // Domain missing — check SubDomain for tech hints
    const subdomain = lower(job.SubDomain);
    if (anyMatch(subdomain, SOFTWARE_SUBDOMAIN_KW.concat(DATA_SUBDOMAIN_KW))) {
        return 'product_tech';
    }

    // Last resort — check tags
    const tagsStr = (Array.isArray(job.Tags) ? job.Tags : []).join(' ').toLowerCase();
    if (anyMatch(tagsStr, ['engineering', 'software', 'cloud', 'platform', 'data', 'ai'])) {
        return 'product_tech';
    }

    return 'product_nontech';
}
