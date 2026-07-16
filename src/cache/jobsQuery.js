import { getAllJobs } from './jobsCache.js';
import { ALL_CATEGORIES } from '../core/categorize.js';

// ────────────────────────────────────────────────────────────────────────
// Public list endpoint — main jobs feed (filtered, sorted, paginated).
// ────────────────────────────────────────────────────────────────────────
//
// Mirrors getJobsPaginated() from db/jobs/listQueries.js but runs in RAM.
//   filters  ← built by the route handler from req.query
//   returns  → { jobs: [...], totalJobs: N }  (same shape MongoDB returned)
export function getJobsPaginatedFromCache(page = 1, limit = 30, filters = {}) {

    // 1. Pull everything from the cache Map as an array
    let jobs = getAllJobs();

    // 2. Safety net (cache invariant says this is already true, but cheap to keep)
    jobs = jobs.filter(job => job.GermanRequired === false);

    // 3. Narrow with each filter the user requested
    jobs = applyCompanyFilter(jobs, filters.company);
    jobs = applyCategoryFilter(jobs, filters.category);
    jobs = applySearchFilter(jobs, filters.search);
    jobs = applyDateFilter(jobs, filters.date);

    // 4. Sort (returns a NEW array — cache untouched)
    jobs = sortJobs(jobs, filters.sort);

    // 5. Capture total BEFORE slicing (frontend uses this for pagination UI)
    const totalJobs = jobs.length;

    // 6. Slice to the requested page
    const skip = (page - 1) * limit;
    const pageJobs = jobs.slice(skip, skip + limit);

    // 7. Normalize applyClicks default to 0 (some old jobs lack the field)
    const normalizedJobs = pageJobs.map(job => ({
        ...job,
        applyClicks: job.applyClicks || 0,
    }));

    return { jobs: normalizedJobs, totalJobs };
}

// ────────────────────────────────────────────────────────────────────────
// Filter dropdown data — company names list.
// ────────────────────────────────────────────────────────────────────────
// Mirrors getCompanyNames() from db/jobs/listQueries.js.
// Returns alphabetically-sorted array of distinct Company values.
export function getCompanyNamesFromCache() {

    const jobs = getAllJobs();

    // Set automatically deduplicates as we add. Iterate once, O(n).
    const companies = new Set();
    for (const job of jobs) {
        if (job.GermanRequired === false && job.Company) {
            companies.add(job.Company);
        }
    }

    // Array.from converts the Set → array, then sort handles intl chars
    return Array.from(companies).sort((a, b) => a.localeCompare(b));
}

// ────────────────────────────────────────────────────────────────────────
// Filter dropdown data — category counts.
// ────────────────────────────────────────────────────────────────────────
// Mirrors getCategoryCounts() from db/jobs/listQueries.js.
// Returns map like { software: 533, data: 92, product_tech: 53, ... }
// Includes zero-count categories so the UI can show every option.
export function getCategoryCountsFromCache() {

    const jobs = getAllJobs();

    // Pre-fill with all categories at 0 — UI needs zero-count entries to
    // render empty buckets ("Data / AI (0)") instead of hiding them.
    const counts = {};
    for (const cat of ALL_CATEGORIES) counts[cat] = 0;

    // Single pass, increment per job. O(n).
    for (const job of jobs) {
        if (job.GermanRequired !== false) continue;
        const cat = job.Category;
        if (cat && Object.prototype.hasOwnProperty.call(counts, cat)) {
            counts[cat] += 1;
        }
    }

    return counts;
}

// ────────────────────────────────────────────────────────────────────────
// Public bait jobs — 9 newest active jobs, lightweight projection.
// ────────────────────────────────────────────────────────────────────────
// Mirrors getPublicBaitJobs() from db/jobs/findQueries.js.
// Used on the homepage to show non-logged-in visitors a sample.
export function getPublicBaitJobsFromCache() {

    let jobs = getAllJobs();

    // Only keep public-safe jobs
    jobs = jobs.filter(job => job.GermanRequired === false);

    // Newest first (PostedDate desc, createdAt as tie-break)
    jobs = sortJobs(jobs, 'newest');

    // Take the first 9, project only the fields the bait section needs
    return jobs.slice(0, 9).map(job => ({
        _id: job._id,
        JobID: job.JobID,
        JobTitle: job.JobTitle,
        Company: job.Company,
        Location: job.Location,
        Department: job.Department,
        Category: job.Category,
        PostedDate: job.PostedDate,
        ApplicationURL: job.ApplicationURL,
        GermanRequired: job.GermanRequired,
        applyClicks: job.applyClicks || 0,
    }));
}

// ────────────────────────────────────────────────────────────────────────
// Filter helpers
// ────────────────────────────────────────────────────────────────────────

// Keep only jobs whose Company matches one of the selected names.
function applyCompanyFilter(jobs, companyList) {
    if (!companyList || companyList.length === 0) return jobs;
    const companySet = new Set(companyList);
    return jobs.filter(job => companySet.has(job.Company));
}

// Keep only jobs whose Category is in the user's selection.
// Silently drop unknown category strings so junk input doesn't match anything.
function applyCategoryFilter(jobs, categoryList) {
    if (!categoryList || categoryList.length === 0) return jobs;
    const validCategories = categoryList.filter(c => ALL_CATEGORIES.includes(c));
    if (validCategories.length === 0) return jobs;
    const categorySet = new Set(validCategories);
    return jobs.filter(job => categorySet.has(job.Category));
}

// Text search across title / company / location (case-insensitive).
// Regex special chars in user input are escaped so "C++" / "node.js" don't crash.
function applySearchFilter(jobs, search) {
    if (!search || !search.trim()) return jobs;
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    return jobs.filter(job =>
        regex.test(job.JobTitle || '') ||
        regex.test(job.Company || '') ||
        regex.test(job.Location || '')
    );
}

// Only jobs posted within last N days. Falls back to scrapedAt when
// PostedDate is missing (some old scraped jobs don't have it).
function applyDateFilter(jobs, dateFilter) {
    if (!dateFilter || dateFilter === 'All') return jobs;

    const daysMap = { 'Today': 1, 'This Week': 7, 'This Month': 30 };
    const days = daysMap[dateFilter];
    if (!days) return jobs;

    const msPerDay = 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - days * msPerDay);

    return jobs.filter(job => {
        const postedDate = job.PostedDate ? new Date(job.PostedDate) : null;
        if (postedDate && postedDate >= cutoff) return true;
        const scrapedAt = job.scrapedAt ? new Date(job.scrapedAt) : null;
        return scrapedAt && scrapedAt >= cutoff;
    });
}

// ────────────────────────────────────────────────────────────────────────
// Sort helpers
// ────────────────────────────────────────────────────────────────────────

// Sort the filtered list. Returns a NEW array (cache stays untouched).
//   'company' → A→Z, newest within each company
//   default   → newest first by PostedDate, createdAt tie-break
function sortJobs(jobs, sortMode) {
    const sorted = [...jobs]; // never sort the cache array directly

    if (sortMode === 'company') {
        sorted.sort((a, b) => {
            const companyCmp = (a.Company || '').localeCompare(b.Company || '');
            if (companyCmp !== 0) return companyCmp;
            return compareByDate(b.PostedDate, a.PostedDate);
        });
    } else {
        sorted.sort((a, b) => {
            const postedCmp = compareByDate(b.PostedDate, a.PostedDate);
            if (postedCmp !== 0) return postedCmp;
            return compareByDate(b.createdAt, a.createdAt);
        });
    }

    return sorted;
}

// Subtract two dates as numbers. Missing dates become epoch (0) so they
// sink to the bottom in newest-first ordering.
function compareByDate(a, b) {
    const aTime = a ? new Date(a).getTime() : 0;
    const bTime = b ? new Date(b).getTime() : 0;
    return aTime - bTime;
}
