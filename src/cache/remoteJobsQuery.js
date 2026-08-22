// Query layer over the REMOTE jobs cache. Twin of jobsQuery.js.
//
// Two deliberate differences from the German pipeline:
//   1. No `GermanRequired === false` universe filter — remote jobs don't carry
//      that field and it is irrelevant to the vertical.
//   2. A `country` facet (US / GB / CA / …), backed by the remote cache's
//      country inverted index. German jobs are all DE, so they have no such filter.
import {
    getAllRemoteJobs, getRemoteJobsArray, getRemoteCacheStats,
    getRemoteWorkplaceIndex, getRemoteExperienceIndex, getRemoteEmploymentIndex,
    getRemoteSalaryTierIndex, getRemoteCategoryIndex, getRemoteCompanyIndex,
    getRemoteCountryIndex,
} from './remoteJobsCache.js';
import { ALL_CATEGORIES } from '../core/categorize.js';

// ────────────────────────────────────────────────────────────────────────
// Set algebra helpers (identical semantics to jobsQuery.js)
// ────────────────────────────────────────────────────────────────────────

// Intersect any number of Sets. Iterates the SMALLEST set and probes the rest
// with .has(). Short-circuits to empty the moment the running result is empty.
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

function unionSets(sets) {
    const result = new Set();
    for (const s of sets) {
        for (const idx of s) result.add(idx);
    }
    return result;
}

// For a multi-value facet: union the index Set of each selected value. Returns
// null when the facet is inactive so the caller can skip intersecting it.
function facetUnion(index, values, isValid) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const chosen = isValid ? values.filter(isValid) : values;
    if (chosen.length === 0) return new Set(); // active but nothing valid → empties result
    return unionSets(chosen.map(v => index.get(v) || new Set()));
}

// ────────────────────────────────────────────────────────────────────────
// Core filter pipeline (shared by list + facet counts)
// ────────────────────────────────────────────────────────────────────────
function computeFilteredIndexSet(filters = {}) {
    const jobsArr = getRemoteJobsArray();

    // Universe: every live (non-tombstone) job. No GermanRequired gate here.
    const universe = new Set();
    for (let i = 0; i < jobsArr.length; i++) {
        if (jobsArr[i] !== null) universe.add(i);
    }

    const facetSets = [];

    const companySet = facetUnion(getRemoteCompanyIndex(), filters.company);
    if (companySet) facetSets.push(companySet);

    const categorySet = facetUnion(
        getRemoteCategoryIndex(), filters.category, c => ALL_CATEGORIES.includes(c),
    );
    if (categorySet) facetSets.push(categorySet);

    // The remote-only facet. Values are normalized to upper case at index time.
    const countrySet = facetUnion(
        getRemoteCountryIndex(),
        Array.isArray(filters.country) ? filters.country.map(c => String(c).toUpperCase()) : filters.country,
    );
    if (countrySet) facetSets.push(countrySet);

    const workplaceSet = facetUnion(getRemoteWorkplaceIndex(), filters.workplace);
    if (workplaceSet) facetSets.push(workplaceSet);

    const experienceSet = facetUnion(getRemoteExperienceIndex(), filters.experience);
    if (experienceSet) facetSets.push(experienceSet);

    const employmentSet = facetUnion(getRemoteEmploymentIndex(), filters.employment);
    if (employmentSet) facetSets.push(employmentSet);

    if (filters.hasSalary === true) {
        facetSets.push(unionSets(Array.from(getRemoteSalaryTierIndex().values())));
    }

    let resultSet = intersectSets([universe, ...facetSets]);

    // Predicates that can't be pre-indexed run only over the surviving set.
    applySalaryRangeToSet(resultSet, jobsArr, filters.salaryMin, filters.salaryMax);
    applySearchToSet(resultSet, jobsArr, filters.search);
    applyDateToSet(resultSet, jobsArr, filters.date);

    return { resultSet, jobsArr };
}

// ────────────────────────────────────────────────────────────────────────
// Public list endpoint — /api/remote-jobs (filtered, shuffled, paginated).
// ────────────────────────────────────────────────────────────────────────
// Memoized full-list order for the no-filter request. Keyed by cacheVersion +
// the UTC date; any upsert/remove/refresh bumps cacheVersion, and the date
// rolls the shuffle at UTC midnight.
let sortedAllMemo = { version: -1, dateKey: null, jobs: null };

function isUnfiltered(filters) {
    return (!filters.company || filters.company.length === 0)
        && (!filters.category || filters.category.length === 0)
        && (!filters.country || filters.country.length === 0)
        && (!filters.workplace || filters.workplace.length === 0)
        && (!filters.experience || filters.experience.length === 0)
        && (!filters.employment || filters.employment.length === 0)
        && filters.hasSalary !== true
        && filters.salaryMin == null && filters.salaryMax == null
        && (!filters.search || !filters.search.trim())
        && (!filters.date || filters.date === 'All');
}

export function getRemoteJobsPaginatedFromCache(page = 1, limit = 30, filters = {}) {
    const dateKey = todayKey();

    let sorted;
    if (isUnfiltered(filters)) {
        const version = getRemoteCacheStats().cacheVersion;
        if (sortedAllMemo.version !== version || sortedAllMemo.dateKey !== dateKey) {
            const all = getRemoteJobsArray().filter(job => job !== null);
            sortedAllMemo = { version, dateKey, jobs: shuffleJobsDaily(all, dateKey) };
        }
        sorted = sortedAllMemo.jobs;
    } else {
        const { resultSet, jobsArr } = computeFilteredIndexSet(filters);

        const resultJobs = [];
        for (const idx of resultSet) resultJobs.push(jobsArr[idx]);
        sorted = shuffleJobsDaily(resultJobs, dateKey);
    }

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
let countsMemo = { version: -1, counts: null };

export function getRemoteFilterCountsFromCache(filters = {}) {

    const unfiltered = isUnfiltered(filters);
    if (unfiltered) {
        const version = getRemoteCacheStats().cacheVersion;
        if (countsMemo.version === version && countsMemo.counts) return countsMemo.counts;
    }

    const { resultSet, jobsArr } = computeFilteredIndexSet(filters);

    const counts = {
        workplace: { remote: 0, hybrid: 0, onsite: 0 },
        experience: { entry: 0, mid: 0, senior: 0, lead: 0, executive: 0 },
        employment: { fulltime: 0, parttime: 0, contract: 0, internship: 0 },
        hasSalary: { count: 0 },
        category: {},
        country: {},
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
        if (job.filterSalaryTier) counts.hasSalary.count += 1;
        if (job.Category && counts.category[job.Category] !== undefined) {
            counts.category[job.Category] += 1;
        }
        // Country buckets are discovered from the data (not a fixed whitelist)
        // so a newly scraped country shows up without a code change.
        const code = String(job.Country || '').trim().toUpperCase();
        if (code) counts.country[code] = (counts.country[code] || 0) + 1;
    }

    if (unfiltered) countsMemo = { version: getRemoteCacheStats().cacheVersion, counts };
    return counts;
}

// ────────────────────────────────────────────────────────────────────────
// Filter dropdown data — company names list.
// ────────────────────────────────────────────────────────────────────────
export function getRemoteCompanyNamesFromCache() {
    const companies = [];
    for (const name of getRemoteCompanyIndex().keys()) {
        if (name !== '_null') companies.push(name);
    }
    return companies.sort((a, b) => a.localeCompare(b));
}

// ────────────────────────────────────────────────────────────────────────
// Filter dropdown data — category counts.
// ────────────────────────────────────────────────────────────────────────
export function getRemoteCategoryCountsFromCache() {
    const categoryIndex = getRemoteCategoryIndex();
    const counts = {};
    for (const cat of ALL_CATEGORIES) {
        counts[cat] = categoryIndex.get(cat)?.size ?? 0;
    }
    return counts;
}

// ────────────────────────────────────────────────────────────────────────
// Public bait jobs — 9 newest remote jobs, lightweight projection.
// ────────────────────────────────────────────────────────────────────────
export function getRemotePublicBaitJobsFromCache() {

    // Deliberately NOT the daily shuffle — curated "9 newest" teaser.
    const jobs = sortByNewest(getAllRemoteJobs());

    return jobs.slice(0, 9).map(job => ({
        _id: job._id,
        JobID: job.JobID,
        JobTitle: job.JobTitle,
        Company: job.Company,
        Location: job.Location,
        Country: job.Country,
        Department: job.Department,
        Category: job.Category,
        PostedDate: job.PostedDate,
        ApplicationURL: job.ApplicationURL,
        applyClicks: job.applyClicks || 0,
    }));
}

// ────────────────────────────────────────────────────────────────────────
// Set-based predicate filters (prune the surviving index Set in place)
// ────────────────────────────────────────────────────────────────────────

// Salary range. Setting a range means "show me jobs with salary data in this
// window", so jobs with NO salary at all are excluded.
function applySalaryRangeToSet(resultSet, jobsArr, salaryMin, salaryMax) {
    const hasMin = salaryMin != null;
    const hasMax = salaryMax != null;
    if (!hasMin && !hasMax) return;

    for (const idx of resultSet) {
        const job = jobsArr[idx];
        const min = job.filterSalaryMin ?? null;
        const max = job.filterSalaryMax ?? null;

        if (min === null && max === null) {
            resultSet.delete(idx);
            continue;
        }

        let remove = false;

        if (hasMin && min !== null && min < salaryMin) {
            remove = !(max !== null && max >= salaryMin);
        }
        if (!remove && hasMax && max !== null && max > salaryMax) {
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
// PostedDate is missing.
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
// Ordering — daily shuffle, same contract as the German list.
// ────────────────────────────────────────────────────────────────────────

/** Today's date in UTC as YYYY-MM-DD — the shuffle seed and memo key. */
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// FNV-1a — deterministic string -> int.
function hashCode(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// Mulberry32 — small seeded PRNG. Math.random() can't be seeded, and the order
// has to be reproducible for a given day.
function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministic daily shuffle. Returns a NEW array (cache stays untouched).
 * Same order for every visitor all UTC day, so pagination stays coherent;
 * reshuffles at UTC midnight.
 */
function shuffleJobsDaily(jobs, dateKey = todayKey()) {
    const shuffled = [...jobs]; // never shuffle a cache array directly
    const rand = seededRandom(hashCode(dateKey));

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

// Newest-first. Retained ONLY for /public-bait (curated homepage teaser).
function sortByNewest(jobs) {
    return [...jobs].sort((a, b) => {
        const postedCmp = compareByDate(b.PostedDate, a.PostedDate);
        if (postedCmp !== 0) return postedCmp;
        return compareByDate(b.createdAt, a.createdAt);
    });
}

// Missing dates become epoch (0) so they sink to the bottom in newest-first.
function compareByDate(a, b) {
    const aTime = a ? new Date(a).getTime() : 0;
    const bTime = b ? new Date(b).getTime() : 0;
    return aTime - bTime;
}
