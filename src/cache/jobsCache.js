import {connectToDb} from '../db/connection.js';

// ── Primary store ─────────────────────────────────────────────────────────
// jobsMap  : JobID → job, O(1) lookup by JobID.
// jobsArray: integer-indexed companion to jobsMap. The inverted indexes below
//            store array POSITIONS (not JobIDs) so filter queries become Set
//            intersections. jobsMap and jobsArray always hold the same jobs.
const jobsMap = new Map();
let jobsArray = [];

// Reverse lookup JobID → array index, so upsert/remove are O(1) instead of an
// O(n) scan of jobsArray.
let jobIdToArrayIndex = new Map();

// ── Inverted indexes: Map<facetValue, Set<arrayIndex>> ────────────────────
// Built once in initJobsCache(), maintained incrementally in upsertJob() /
// removeJob(). Null/absent facet values bucket under '_null' where a bucket is
// useful (workplace/experience/employment/category/company); binary facets
// (visa/relocation/salaryTier) only index the positive value.
let workplaceIndex = new Map();    // "remote"    → Set{0, 3, 17, ...}
let experienceIndex = new Map();   // "senior"    → Set{1, 5, 22, ...}
let employmentIndex = new Map();   // "fulltime"  → Set{0, 1, 2, ...}
let visaIndex = new Map();         // "available" → Set{4, 9, ...}
let relocationIndex = new Map();   // "available" → Set{4, ...}
let salaryTierIndex = new Map();   // "ats"/"jd"  → Set{...}
let categoryIndex = new Map();     // "software"  → Set{0, 1, ...}
let companyIndex = new Map();      // "SAP"       → Set{...}

// For salary range queries: { min, max, idx }, kept sorted by min ascending.
// (Range predicates can't use a value-keyed inverted index.)
let salaryRangeArray = [];

let isReady = false;
let loadedAt = null;
let cacheVersion = 0;

// ── Index mutation helpers (private) ──────────────────────────────────────

// Add `idx` to the Set stored at `key` in `map`, creating the Set on demand.
function addToIndex(map, key, idx) {
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(idx);
}

// Remove `idx` from the Set at `key`; drop the key entirely once its Set empties
// so callers reading index keys (e.g. company names) never see dead buckets.
function removeFromIndex(map, key, idx) {
    const set = map.get(key);
    if (!set) return;
    set.delete(idx);
    if (set.size === 0) map.delete(key);
}

// True when a job carries a salary bound worth putting in salaryRangeArray.
function hasSalaryRange(job) {
    return job.filterSalaryMin != null || job.filterSalaryMax != null;
}

/**
 * Add one job at position `idx` to every inverted index. Private.
 */
function indexJob(idx, job) {
    addToIndex(workplaceIndex, job.filterWorkplace || '_null', idx);
    addToIndex(experienceIndex, job.filterExperience || '_null', idx);
    addToIndex(employmentIndex, job.filterEmployment || '_null', idx);

    if (job.filterVisa === 'available') addToIndex(visaIndex, 'available', idx);
    if (job.filterRelocation === 'available') addToIndex(relocationIndex, 'available', idx);
    if (job.filterSalaryTier) addToIndex(salaryTierIndex, job.filterSalaryTier, idx);

    addToIndex(categoryIndex, job.Category || '_null', idx);
    addToIndex(companyIndex, job.Company || '_null', idx);

    if (hasSalaryRange(job)) {
        salaryRangeArray.push({
            min: job.filterSalaryMin ?? 0,
            max: job.filterSalaryMax ?? Infinity,
            idx,
        });
    }
}

/**
 * Remove one job at position `idx` from every inverted index. Mirror of
 * indexJob(). Private. Uses the OLD job object so facet keys match what was
 * indexed. salaryRangeArray is filtered by idx.
 */
function removeJobFromIndexes(idx, job) {
    removeFromIndex(workplaceIndex, job.filterWorkplace || '_null', idx);
    removeFromIndex(experienceIndex, job.filterExperience || '_null', idx);
    removeFromIndex(employmentIndex, job.filterEmployment || '_null', idx);

    if (job.filterVisa === 'available') removeFromIndex(visaIndex, 'available', idx);
    if (job.filterRelocation === 'available') removeFromIndex(relocationIndex, 'available', idx);
    if (job.filterSalaryTier) removeFromIndex(salaryTierIndex, job.filterSalaryTier, idx);

    removeFromIndex(categoryIndex, job.Category || '_null', idx);
    removeFromIndex(companyIndex, job.Company || '_null', idx);

    if (hasSalaryRange(job)) {
        salaryRangeArray = salaryRangeArray.filter(entry => entry.idx !== idx);
    }
}

function sortSalaryRange() {
    salaryRangeArray.sort((a, b) => a.min - b.min);
}

// Reset every index structure to empty. Private.
function clearIndexes() {
    jobIdToArrayIndex = new Map();
    workplaceIndex = new Map();
    experienceIndex = new Map();
    employmentIndex = new Map();
    visaIndex = new Map();
    relocationIndex = new Map();
    salaryTierIndex = new Map();
    categoryIndex = new Map();
    companyIndex = new Map();
    salaryRangeArray = [];
}

// How many jobs to accumulate before flushing a batch into the live structures.
const LOAD_BATCH_SIZE = 200;

// Guards against two loads running at once. refreshJobsCache() now returns as
// soon as the first batch is live, so a scrape finishing while a previous
// refresh is still streaming would otherwise interleave two writers over the
// same jobsArray/index state.
let loadInFlight = null;        // resolves when the full stream finishes
let firstBatchInFlight = null;  // resolves when the first batch is queryable

/**
 * Load active jobs into RAM, streaming in batches.
 *
 * Returns as soon as the FIRST batch is live — the API can start serving with
 * partial data instead of blocking the whole boot on a full 5k-job read. The
 * remaining batches continue in the background; each one bumps cacheVersion, so
 * memoized query results invalidate and the next request sees the larger set.
 *
 * @returns {Promise<void>} resolves after the first batch is queryable
 */
export function initJobsCache(){
    // Coalesce: a refresh arriving mid-stream joins the running load rather
    // than starting a second writer over the same structures.
    if (loadInFlight) {
        console.log('[jobsCache] Load already in progress — joining it');
        return firstBatchInFlight;
    }

    console.log('[jobsCache] Loading jobs into RAM...');
    const startTime = Date.now();

    let resolveFirstBatch;
    let rejectFirstBatch;
    const firstBatchReady = new Promise((resolve, reject) => {
        resolveFirstBatch = resolve;
        rejectFirstBatch = reject;
    });

    let settled = false;
    const markLive = (count) => {
        if (settled) return;
        settled = true;
        isReady = true;
        loadedAt = new Date();
        console.log(`[Cache] First batch ready — ${count} jobs live, streaming remainder in background`);
        resolveFirstBatch();
    };

    // Apply one accumulated batch to the live structures.
    const flush = (batch) => {
        for (const job of batch) upsertJob(job);
        // indexJob() appends to salaryRangeArray; range scans need it ordered.
        sortSalaryRange();
        // Invalidate memoized query results so the next request sees this batch.
        cacheVersion++;
    };

    const stream = async () => {
        const db = await connectToDb();
        // Heavy fields excluded — 5-20KB each per job and never read from the
        // cache (list responses use descriptionPreview; the detail endpoint reads
        // MongoDB directly). parsedRequirements stays IN: it's a small structured
        // object and the skill-matcher (Today's Matches) scans the whole cache by
        // it — excluding it made every job skip and matches come back empty.
        const cursor = db.collection('jobs').find(
            { Status: 'active' },
            { projection: { Description: 0, DescriptionHtml: 0 } },
        );

        // Start from a clean slate; upsertJob() rebuilds both the array and
        // every index incrementally as batches arrive.
        jobsMap.clear();
        jobsArray = [];
        clearIndexes();

        let loadedCount = 0;
        let batch = [];

        for await (const job of cursor) {
            batch.push(job);
            loadedCount++;

            if (batch.length >= LOAD_BATCH_SIZE) {
                flush(batch);
                batch = [];
                markLive(loadedCount);
            }
        }

        // Trailing partial batch.
        if (batch.length > 0) {
            flush(batch);
            markLive(loadedCount);
        }

        // An empty collection still has to unblock the server.
        markLive(loadedCount);

        const elapsedMs = Date.now() - startTime;
        console.log(`[Cache] Fully loaded — ${loadedCount} jobs in ${elapsedMs}ms`);
    };

    firstBatchInFlight = firstBatchReady;
    loadInFlight = stream()
        .catch(err => {
            // Before the first batch there is nothing to serve, so the caller
            // (server boot) must hear about it. After that the cache is already
            // usable and a mid-stream failure only means fewer jobs than expected.
            if (!settled) {
                rejectFirstBatch(err);
            } else {
                console.warn(`[Cache] Background load stopped early: ${err.message}`);
            }
        })
        .finally(() => { loadInFlight = null; firstBatchInFlight = null; });

    return firstBatchReady;
}

/**
 * True once initJobsCache() has finished. Express starts accepting connections
 * before the boot callback finishes loading the cache (~90s for 4k jobs), so
 * every cache-backed route must gate on this or it throws a confusing 500
 * during the warm-up window. See requireCacheReady in server.js.
 */
export function isJobsCacheReady(){ return isReady; }

// Returns live jobs only — tombstones (null slots left by removals) are skipped.
export function getAllJobs(){
    if(!isReady) throw new Error('[jobsCache] cache is not initialized yet');
    return jobsArray.filter(job => job !== null);
}

export function getJobById(jobId){
    if(!isReady) throw new Error('[jobsCache] cache is not initialized yet');
    return jobsMap.get(jobId) || null;
}

// Drop a job from jobsMap and all indexes, leaving a tombstone (null) in
// jobsArray so existing indexes stay valid. Private core used by both the
// non-active branch of upsertJob() and removeJob().
function evictJob(jobId){
    const existing = jobsMap.get(jobId);
    if (existing === undefined) return;
    const idx = jobIdToArrayIndex.get(jobId);
    if (idx !== undefined) {
        removeJobFromIndexes(idx, existing);
        jobsArray[idx] = null; // tombstone — never splice (would shift indexes)
        jobIdToArrayIndex.delete(jobId);
    }
    jobsMap.delete(jobId);
}

export function upsertJob(job){
    if(!job?.JobID) return;

    // A non-active job leaving the public set behaves exactly like a removal.
    if(job.Status !== 'active'){
        evictJob(job.JobID);
        cacheVersion++;
        return;
    }

    const existing = jobsMap.get(job.JobID);
    let salaryDirty = false;

    if(existing !== undefined){
        // In-place update: re-index at the same slot so no other index shifts.
        const idx = jobIdToArrayIndex.get(job.JobID);
        salaryDirty = hasSalaryRange(existing) || hasSalaryRange(job);
        removeJobFromIndexes(idx, existing);
        jobsArray[idx] = job;
        jobsMap.set(job.JobID, job);
        indexJob(idx, job);
    } else {
        // New job: append and index at the tail.
        const idx = jobsArray.length;
        jobsArray.push(job);
        jobIdToArrayIndex.set(job.JobID, idx);
        jobsMap.set(job.JobID, job);
        indexJob(idx, job);
        salaryDirty = hasSalaryRange(job);
    }

    // salaryRangeArray must stay sorted for range scans. indexJob() appended to
    // the tail, and a value may have changed on an update — re-sort when a
    // salary bound was involved.
    if (salaryDirty) sortSalaryRange();

    cacheVersion++;
}

export function removeJob(jobId){
    evictJob(jobId);
    cacheVersion++;
}

export async function refreshJobsCache(){
    await initJobsCache();
}

// ── Index accessors (used by jobsQuery.js; NOT re-exported from the barrel) ──
export function getJobsArray() { return jobsArray; }
export function getWorkplaceIndex() { return workplaceIndex; }
export function getExperienceIndex() { return experienceIndex; }
export function getEmploymentIndex() { return employmentIndex; }
export function getVisaIndex() { return visaIndex; }
export function getRelocationIndex() { return relocationIndex; }
export function getSalaryTierIndex() { return salaryTierIndex; }
export function getCategoryIndex() { return categoryIndex; }
export function getCompanyIndex() { return companyIndex; }
export function getSalaryRangeArray() { return salaryRangeArray; }

export function getCacheStats(){
    return {
        isReady,
        size: jobsMap.size,
        loadedAt,
        cacheVersion,
        indexes: {
            workplace: workplaceIndex.size,
            experience: experienceIndex.size,
            employment: employmentIndex.size,
            visa: visaIndex.get('available')?.size ?? 0,
            relocation: relocationIndex.get('available')?.size ?? 0,
            salaryTier: salaryTierIndex.size,
            salaryRange: salaryRangeArray.length,
        },
    };
}
