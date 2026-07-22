import {
    getAllJobs, getJobsArray,
    getWorkplaceIndex, getExperienceIndex, getEmploymentIndex,
    getVisaIndex, getRelocationIndex, getSalaryTierIndex,
    getCategoryIndex, getCompanyIndex,
} from './jobsCache.js';
import { ALL_CATEGORIES } from '../core/categorize.js';

// ────────────────────────────────────────────────────────────────────────
// Set algebra helpers
// ────────────────────────────────────────────────────────────────────────

// Intersect any number of Sets. Iterates the SMALLEST set and probes the rest
// with .has() — the single most important optimization here. Short-circuits to
// empty the moment the running result is empty.
function intersectSets(sets) {
    if (sets.length === 0) return new Set();
    const sorted = [...sets].sort((a, b) => a.size - b.size);
    let result = new Set(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
        const check = sorted[i];
        for (const idx of result) {
            if (!check.has(idx)) result.delete(idx);
        }
        if (result.size === 0) return result;
    }
    return result;
}

// Union any number of Sets into a fresh Set. Used when one facet has multiple
// selected values (workplace=remote,hybrid) before intersecting with others.
function unionSets(sets) {
    const result = new Set();
    for (const s of sets) {
        for (const idx of s) result.add(idx);
    }
    return result;
}

// For a multi-value facet: union the index Set of each selected value. A value
// with no bucket contributes nothing. Returns null when the facet is inactive
// (no/empty selection) so the caller can skip intersecting it.
function facetUnion(index, values, isValid) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const chosen = isValid ? values.filter(isValid) : values;
    if (chosen.length === 0) return new Set(); // active but nothing valid → empties result
    return unionSets(chosen.map(v => index.get(v) || new Set()));
}

// ────────────────────────────────────────────────────────────────────────
// Core filter pipeline (shared by list + facet counts)
// ────────────────────────────────────────────────────────────────────────
//
// Returns { resultSet, jobsArr } where resultSet holds the array indexes of all
// jobs matching EVERY active filter. Index-backed facets are resolved by Set
// intersection; range/text/date predicates then prune the surviving set.
function computeFilteredIndexSet(filters = {}) {
    const jobsArr = getJobsArray();

    // Universe: live (non-tombstone), public (GermanRequired === false) jobs.
    const universe = new Set();
    for (let i = 0; i < jobsArr.length; i++) {
        const job = jobsArr[i];
        if (job !== null && job.GermanRequired === false) universe.add(i);
    }

    // Collect the index-backed facet sets to intersect with the universe.
    const facetSets = [];

    const companySet = facetUnion(getCompanyIndex(), filters.company);
    if (companySet) facetSets.push(companySet);

    const categorySet = facetUnion(
        getCategoryIndex(), filters.category, c => ALL_CATEGORIES.includes(c),
    );
    if (categorySet) facetSets.push(categorySet);

    const workplaceSet = facetUnion(getWorkplaceIndex(), filters.workplace);
    if (workplaceSet) facetSets.push(workplaceSet);

    const experienceSet = facetUnion(getExperienceIndex(), filters.experience);
    if (experienceSet) facetSets.push(experienceSet);

    const employmentSet = facetUnion(getEmploymentIndex(), filters.employment);
    if (employmentSet) facetSets.push(employmentSet);

    if (filters.visa === true) {
        facetSets.push(getVisaIndex().get('available') || new Set());
    }
    if (filters.relocation === true) {
        facetSets.push(getRelocationIndex().get('available') || new Set());
    }
    if (filters.hasSalary === true) {
        facetSets.push(unionSets(Array.from(getSalaryTierIndex().values())));
    }

    // Intersect universe with every active facet set. With no facets this is
    // just a copy of the universe — same cost as the old getAllJobs().filter.
    let resultSet = intersectSets([universe, ...facetSets]);

    // Predicates that can't be pre-indexed run only over the surviving set.
    applySalaryRangeToSet(resultSet, jobsArr, filters.salaryMin, filters.salaryMax);
    applySearchToSet(resultSet, jobsArr, filters.search);
    applyDateToSet(resultSet, jobsArr, filters.date);

    return { resultSet, jobsArr };
}

// ────────────────────────────────────────────────────────────────────────
// Public list endpoint — main jobs feed (filtered, sorted, paginated).
// ────────────────────────────────────────────────────────────────────────
//
//   filters  ← built by the route handler from req.query
//   returns  → { jobs: [...], totalJobs: N }  (same shape MongoDB returned)
export function getJobsPaginatedFromCache(page = 1, limit = 30, filters = {}) {

    const { resultSet, jobsArr } = computeFilteredIndexSet(filters);

    // Materialize the surviving jobs, then sort (never touches cache arrays).
    const resultJobs = [];
    for (const idx of resultSet) resultJobs.push(jobsArr[idx]);
    const sorted = sortJobs(resultJobs, filters.sort);

    // Total BEFORE slicing (frontend uses this for pagination UI).
    const totalJobs = sorted.length;

    const skip = (page - 1) * limit;
    const pageJobs = sorted.slice(skip, skip + limit);

    const normalizedJobs = pageJobs.map(job => ({
        ...job,
        applyClicks: job.applyClicks || 0,
    }));

    return { jobs: normalizedJobs, totalJobs };
}

// ────────────────────────────────────────────────────────────────────────
// Facet counts — powers the "(42)" badges next to filter options.
// ────────────────────────────────────────────────────────────────────────
//
// V1 (Indeed-style): counts reflect the CURRENT result set with ALL filters
// applied — "of these results, how many are remote / senior / …". The
// "exclude-self" (LinkedIn-style) variant can be layered on later.
export function getFilterCountsFromCache(filters = {}) {

    const { resultSet, jobsArr } = computeFilteredIndexSet(filters);

    const counts = {
        workplace: { remote: 0, hybrid: 0, onsite: 0 },
        experience: { entry: 0, mid: 0, senior: 0, lead: 0, executive: 0 },
        employment: { fulltime: 0, parttime: 0, contract: 0, internship: 0 },
        visa: { available: 0 },
        relocation: { available: 0 },
        hasSalary: { count: 0 },
        category: {},
        totalJobs: resultSet.size,
    };
    for (const cat of ALL_CATEGORIES) counts.category[cat] = 0;

    for (const idx of resultSet) {
        const job = jobsArr[idx];

        if (job.filterWorkplace && counts.workplace[job.filterWorkplace] !== undefined) {
            counts.workplace[job.filterWorkplace] += 1;
        }
        if (job.filterExperience && counts.experience[job.filterExperience] !== undefined) {
            counts.experience[job.filterExperience] += 1;
        }
        if (job.filterEmployment && counts.employment[job.filterEmployment] !== undefined) {
            counts.employment[job.filterEmployment] += 1;
        }
        if (job.filterVisa === 'available') counts.visa.available += 1;
        if (job.filterRelocation === 'available') counts.relocation.available += 1;
        if (job.filterSalaryTier) counts.hasSalary.count += 1;
        if (job.Category && counts.category[job.Category] !== undefined) {
            counts.category[job.Category] += 1;
        }
    }

    return counts;
}

// ────────────────────────────────────────────────────────────────────────
// Filter dropdown data — company names list.
// ────────────────────────────────────────────────────────────────────────
// Distinct Company values straight off the inverted index keys (no scan).
export function getCompanyNamesFromCache() {
    const companies = [];
    for (const name of getCompanyIndex().keys()) {
        if (name !== '_null') companies.push(name);
    }
    return companies.sort((a, b) => a.localeCompare(b));
}

// ────────────────────────────────────────────────────────────────────────
// Filter dropdown data — category counts.
// ────────────────────────────────────────────────────────────────────────
// Returns map like { software: 533, data: 92, ... }, including zero-count
// categories so the UI can render every bucket. Reads Set sizes off the index;
// tombstones are already excluded from the index, so .size is accurate.
export function getCategoryCountsFromCache() {
    const categoryIndex = getCategoryIndex();
    const counts = {};
    for (const cat of ALL_CATEGORIES) {
        counts[cat] = categoryIndex.get(cat)?.size ?? 0;
    }
    return counts;
}

// ────────────────────────────────────────────────────────────────────────
// Public bait jobs — 9 newest active jobs, lightweight projection.
// ────────────────────────────────────────────────────────────────────────
export function getPublicBaitJobsFromCache() {

    let jobs = getAllJobs();
    jobs = jobs.filter(job => job.GermanRequired === false);
    jobs = sortJobs(jobs, 'newest');

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
// Set-based predicate filters (prune the surviving index Set in place)
// ────────────────────────────────────────────────────────────────────────

// Salary range. Setting a range means "show me jobs with salary data in this
// window", so jobs with NO salary at all (both bounds null) are excluded — most
// jobs lack salary, and keeping them would make the filter return nearly
// everything. A job with a known salary is dropped only when its range does not
// overlap the requested window. (Users who want to include no-salary jobs simply
// leave the salary inputs empty; the independent hasSalary toggle is unaffected.)
function applySalaryRangeToSet(resultSet, jobsArr, salaryMin, salaryMax) {
    const hasMin = salaryMin != null;
    const hasMax = salaryMax != null;
    if (!hasMin && !hasMax) return;

    for (const idx of resultSet) {
        const job = jobsArr[idx];
        const min = job.filterSalaryMin ?? null;
        const max = job.filterSalaryMax ?? null;

        // No salary data at all → can't satisfy a range filter. Drop it.
        if (min === null && max === null) {
            resultSet.delete(idx);
            continue;
        }

        let remove = false;

        if (hasMin && min !== null && min < salaryMin) {
            // Below the floor — keep only if the upper bound reaches into range.
            remove = !(max !== null && max >= salaryMin);
        }
        if (!remove && hasMax && max !== null && max > salaryMax) {
            // Above the ceiling — keep only if the lower bound sits within range.
            remove = !(min !== null && min <= salaryMax);
        }

        if (remove) resultSet.delete(idx);
    }
}

// Text search across title / company / location (case-insensitive).
// Regex specials in user input are escaped so "C++" / "node.js" don't crash.
function applySearchToSet(resultSet, jobsArr, search) {
    if (!search || !search.trim()) return;
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    for (const idx of resultSet) {
        const job = jobsArr[idx];
        if (!regex.test(job.JobTitle || '') &&
            !regex.test(job.Company || '') &&
            !regex.test(job.Location || '')) {
            resultSet.delete(idx);
        }
    }
}

// Only jobs posted within the last N days. Falls back to scrapedAt when
// PostedDate is missing (some old scraped jobs lack it).
function applyDateToSet(resultSet, jobsArr, dateFilter) {
    if (!dateFilter || dateFilter === 'All') return;

    const daysMap = { 'Today': 1, 'This Week': 7, 'This Month': 30 };
    const days = daysMap[dateFilter];
    if (!days) return;

    const msPerDay = 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - days * msPerDay);

    for (const idx of resultSet) {
        const job = jobsArr[idx];
        const postedDate = job.PostedDate ? new Date(job.PostedDate) : null;
        if (postedDate && postedDate >= cutoff) continue;
        const scrapedAt = job.scrapedAt ? new Date(job.scrapedAt) : null;
        if (!(scrapedAt && scrapedAt >= cutoff)) resultSet.delete(idx);
    }
}

// ────────────────────────────────────────────────────────────────────────
// Sort helpers
// ────────────────────────────────────────────────────────────────────────

// Sort the filtered list. Returns a NEW array (cache stays untouched).
//   'company' → A→Z, newest within each company
//   'salary'  → highest pay first, null-salary sinks to the bottom
//   default   → newest first by PostedDate, createdAt tie-break
function sortJobs(jobs, sortMode) {
    const sorted = [...jobs]; // never sort a cache array directly

    if (sortMode === 'company') {
        sorted.sort((a, b) => {
            const companyCmp = (a.Company || '').localeCompare(b.Company || '');
            if (companyCmp !== 0) return companyCmp;
            return compareByDate(b.PostedDate, a.PostedDate);
        });
    } else if (sortMode === 'salary') {
        sorted.sort((a, b) => {
            const aMax = a.filterSalaryMax ?? a.filterSalaryMin ?? -1;
            const bMax = b.filterSalaryMax ?? b.filterSalaryMin ?? -1;
            if (aMax !== bMax) return bMax - aMax; // highest first
            return compareByDate(b.PostedDate, a.PostedDate); // tie-break: newest
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

// Subtract two dates as numbers. Missing dates become epoch (0) so they sink to
// the bottom in newest-first ordering.
function compareByDate(a, b) {
    const aTime = a ? new Date(a).getTime() : 0;
    const bTime = b ? new Date(b).getTime() : 0;
    return aTime - bTime;
}
