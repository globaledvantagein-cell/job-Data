// ─── Resume Matcher — Hard Filter ──────────────────────────────────────────────
//
// Step 2 of the pipeline: 0 AI calls, <50ms. Reads all active jobs straight from
// the RAM cache (getAllJobs) and narrows them with cheap hard filters before the
// expensive AI scoring passes.

import { getAllJobs } from '../cache/index.js';

// Broad domain → Category matching. A profile domain maps to several possible
// job Category substrings (matched case-insensitively via includes).
const DOMAIN_TO_CATEGORIES = {
    'Engineering': ['engineering', 'software', 'it', 'technical', 'product_tech'],
    'Marketing': ['marketing', 'communications', 'content'],
    'Sales': ['sales', 'business_development'],
    'Finance': ['finance', 'accounting', 'other_nontech'],
    'HR': ['hr', 'people', 'recruiting'],
    'Design': ['design', 'ux', 'ui', 'creative', 'product_tech'],
    'Data': ['data', 'analytics', 'data_science'],
    'Product': ['product', 'product_tech'],
    'Operations': ['operations', 'supply_chain', 'logistics', 'other_nontech'],
    'Legal': ['legal', 'compliance'],
    'Other': [], // Don't filter on category
};

const GERMAN_SUFFICIENT = ['fluent', 'native', 'professional'];
const MIN_RESULTS_BEFORE_BROADENING = 20;

/**
 * Applies hard filters to the cached active jobs based on the parsed profile.
 *
 * @param {object} profile - parsed resume profile
 * @returns {Array<object>} filtered job documents
 */
export function filterJobs(profile) {
    const allJobs = getAllJobs();

    // 1. German-language gate: if the candidate isn't sufficiently fluent in
    //    German, drop jobs that require German.
    const germanProficiency = profile.languages
        ?.find(l => l.language?.toLowerCase() === 'german')?.proficiency || 'none';
    const isGermanSufficient = GERMAN_SUFFICIENT.includes(germanProficiency);

    let filtered = allJobs;
    if (!isGermanSufficient) {
        filtered = filtered.filter(job => !job.GermanRequired);
    }

    // 2. Domain → category narrowing (broad matching).
    const matchingCategories = DOMAIN_TO_CATEGORIES[profile.domain] || [];
    if (matchingCategories.length > 0) {
        filtered = filtered.filter(job => {
            const jobCat = (job.Category || '').toLowerCase();
            return matchingCategories.some(cat => jobCat.includes(cat));
        });
    }

    // 3. If the category filter was too aggressive, broaden back to German-only.
    if (filtered.length < MIN_RESULTS_BEFORE_BROADENING) {
        filtered = allJobs;
        if (!isGermanSufficient) {
            filtered = filtered.filter(job => !job.GermanRequired);
        }
    }

    return filtered;
}
