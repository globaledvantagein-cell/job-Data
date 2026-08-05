import {connectToDb} from '../db/connection.js';

// ── Remote jobs RAM cache ─────────────────────────────────────────────────
// A COMPLETELY independent twin of jobsCache.js:
//   jobsCache.js       → "jobs"       collection (German / niche product)
//   remoteJobsCache.js → "remoteJobs" collection (global remote, volume play)
//
// Separate Maps, separate inverted indexes, separate refresh cycle. Nothing is
// shared between the two — a refresh here never touches the German cache.
//
// Structure mirrors jobsCache.js exactly (see its comments for the rationale):
// remoteJobsMap for O(1) JobID lookup, remoteJobsArray as the integer-indexed
// companion, and inverted indexes storing array POSITIONS so filter queries are
// Set intersections.
const remoteJobsMap = new Map();
let remoteJobsArray = [];

// Reverse lookup JobID → array index (O(1) upsert/remove).
let remoteJobIdToArrayIndex = new Map();

// ── Inverted indexes: Map<facetValue, Set<arrayIndex>> ────────────────────
// visa/relocation are deliberately ABSENT — meaningless for fully remote roles.
// countryIndex is the one facet German jobs don't have (they're all DE).
let workplaceIndex = new Map();    // "remote"   → Set{0, 3, 17, ...}
let experienceIndex = new Map();   // "senior"   → Set{1, 5, 22, ...}
let employmentIndex = new Map();   // "fulltime" → Set{0, 1, 2, ...}
let salaryTierIndex = new Map();   // "ats"/"jd" → Set{...}
let categoryIndex = new Map();     // "software" → Set{0, 1, ...}
let companyIndex = new Map();      // "GitLab"   → Set{...}
let countryIndex = new Map();      // "US"       → Set{...}

// For salary range queries: { min, max, idx }, kept sorted by min ascending.
let salaryRangeArray = [];

let isReady = false;
let loadedAt = null;
let cacheVersion = 0;

// ── Index mutation helpers (private) ──────────────────────────────────────

function addToIndex(map, key, idx) {
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    set.add(idx);
}

// Remove `idx` from the Set at `key`; drop the key entirely once its Set empties
// so callers reading index keys (company names, country codes) see no dead buckets.
function removeFromIndex(map, key, idx) {
    const set = map.get(key);
    if (!set) return;
    set.delete(idx);
    if (set.size === 0) map.delete(key);
}

function hasSalaryRange(job) {
    return job.filterSalaryMin != null || job.filterSalaryMax != null;
}

// Country codes are compared upper-case so "us" and "US" bucket together.
function normalizeCountry(value) {
    const code = String(value || '').trim().toUpperCase();
    return code || '_null';
}

/**
 * Add one remote job at position `idx` to every inverted index. Private.
 */
function indexRemoteJob(idx, job) {
    addToIndex(workplaceIndex, job.filterWorkplace || '_null', idx);
    addToIndex(experienceIndex, job.filterExperience || '_null', idx);
    addToIndex(employmentIndex, job.filterEmployment || '_null', idx);

    if (job.filterSalaryTier) addToIndex(salaryTierIndex, job.filterSalaryTier, idx);

    addToIndex(categoryIndex, job.Category || '_null', idx);
    addToIndex(companyIndex, job.Company || '_null', idx);
    addToIndex(countryIndex, normalizeCountry(job.Country), idx);

    if (hasSalaryRange(job)) {
        salaryRangeArray.push({
            min: job.filterSalaryMin ?? 0,
            max: job.filterSalaryMax ?? Infinity,
            idx,
        });
    }
}

/**
 * Mirror of indexRemoteJob(). Private. Uses the OLD job object so facet keys
 * match what was indexed.
 */
function removeRemoteJobFromIndexes(idx, job) {
    removeFromIndex(workplaceIndex, job.filterWorkplace || '_null', idx);
    removeFromIndex(experienceIndex, job.filterExperience || '_null', idx);
    removeFromIndex(employmentIndex, job.filterEmployment || '_null', idx);

    if (job.filterSalaryTier) removeFromIndex(salaryTierIndex, job.filterSalaryTier, idx);

    removeFromIndex(categoryIndex, job.Category || '_null', idx);
    removeFromIndex(companyIndex, job.Company || '_null', idx);
    removeFromIndex(countryIndex, normalizeCountry(job.Country), idx);

    if (hasSalaryRange(job)) {
        salaryRangeArray = salaryRangeArray.filter(entry => entry.idx !== idx);
    }
}

function sortSalaryRange() {
    salaryRangeArray.sort((a, b) => a.min - b.min);
}

function clearIndexes() {
    remoteJobIdToArrayIndex = new Map();
    workplaceIndex = new Map();
    experienceIndex = new Map();
    employmentIndex = new Map();
    salaryTierIndex = new Map();
    categoryIndex = new Map();
    companyIndex = new Map();
    countryIndex = new Map();
    salaryRangeArray = [];
}

export async function initRemoteJobsCache(){
    console.log('[remoteJobsCache] Loading remote jobs into RAM...');
    const startTime = Date.now();

    const db = await connectToDb();
    const cursor = db.collection('remoteJobs').find({ Status: 'active' });

    remoteJobsMap.clear();

    let loadedCount = 0;
    for await(const job of cursor){
        remoteJobsMap.set(job.JobID, job);
        loadedCount++;
    }

    remoteJobsArray = Array.from(remoteJobsMap.values());
    clearIndexes();

    for (let i = 0; i < remoteJobsArray.length; i++) {
        remoteJobIdToArrayIndex.set(remoteJobsArray[i].JobID, i);
        indexRemoteJob(i, remoteJobsArray[i]);
    }
    sortSalaryRange();

    isReady = true;
    loadedAt = new Date();
    cacheVersion++;

    const elapsedMs = Date.now() - startTime;
    console.log(`[remoteJobsCache] ✅ Loaded ${loadedCount} jobs in ${elapsedMs}ms`);
}

// Returns live jobs only — tombstones (null slots left by removals) are skipped.
export function getAllRemoteJobs(){
    if(!isReady) throw new Error('[remoteJobsCache] cache is not initialized yet');
    return remoteJobsArray.filter(job => job !== null);
}

export function getRemoteJobById(jobId){
    if(!isReady) throw new Error('[remoteJobsCache] cache is not initialized yet');
    return remoteJobsMap.get(jobId) || null;
}

// Drop a job from the map + all indexes, leaving a tombstone (null) in
// remoteJobsArray so existing indexes stay valid.
function evictRemoteJob(jobId){
    const existing = remoteJobsMap.get(jobId);
    if (existing === undefined) return;
    const idx = remoteJobIdToArrayIndex.get(jobId);
    if (idx !== undefined) {
        removeRemoteJobFromIndexes(idx, existing);
        remoteJobsArray[idx] = null; // tombstone — never splice (would shift indexes)
        remoteJobIdToArrayIndex.delete(jobId);
    }
    remoteJobsMap.delete(jobId);
}

export function upsertRemoteJob(job){
    if(!job?.JobID) return;

    if(job.Status !== 'active'){
        evictRemoteJob(job.JobID);
        cacheVersion++;
        return;
    }

    const existing = remoteJobsMap.get(job.JobID);
    let salaryDirty = false;

    if(existing !== undefined){
        const idx = remoteJobIdToArrayIndex.get(job.JobID);
        salaryDirty = hasSalaryRange(existing) || hasSalaryRange(job);
        removeRemoteJobFromIndexes(idx, existing);
        remoteJobsArray[idx] = job;
        remoteJobsMap.set(job.JobID, job);
        indexRemoteJob(idx, job);
    } else {
        const idx = remoteJobsArray.length;
        remoteJobsArray.push(job);
        remoteJobIdToArrayIndex.set(job.JobID, idx);
        remoteJobsMap.set(job.JobID, job);
        indexRemoteJob(idx, job);
        salaryDirty = hasSalaryRange(job);
    }

    if (salaryDirty) sortSalaryRange();

    cacheVersion++;
}

export function removeRemoteJob(jobId){
    evictRemoteJob(jobId);
    cacheVersion++;
}

export async function refreshRemoteJobsCache(){
    await initRemoteJobsCache();
}

// ── Index accessors (used by remoteJobsQuery.js; NOT re-exported from the barrel) ──
export function getRemoteJobsArray() { return remoteJobsArray; }
export function getRemoteWorkplaceIndex() { return workplaceIndex; }
export function getRemoteExperienceIndex() { return experienceIndex; }
export function getRemoteEmploymentIndex() { return employmentIndex; }
export function getRemoteSalaryTierIndex() { return salaryTierIndex; }
export function getRemoteCategoryIndex() { return categoryIndex; }
export function getRemoteCompanyIndex() { return companyIndex; }
export function getRemoteCountryIndex() { return countryIndex; }
export function getRemoteSalaryRangeArray() { return salaryRangeArray; }

export function getRemoteCacheStats(){
    return {
        isReady,
        size: remoteJobsMap.size,
        loadedAt,
        cacheVersion,
        indexes: {
            workplace: workplaceIndex.size,
            experience: experienceIndex.size,
            employment: employmentIndex.size,
            country: countryIndex.size,
            salaryTier: salaryTierIndex.size,
            salaryRange: salaryRangeArray.length,
        },
    };
}
