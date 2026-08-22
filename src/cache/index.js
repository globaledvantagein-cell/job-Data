// Public API for the cache module.
//
//   getJobsPaginatedFromCache → /api/jobs main list endpoint
//   getCompanyNamesFromCache  → /api/jobs/company-names
//   getCategoryCountsFromCache → /api/jobs/category-counts
//   getPublicBaitJobsFromCache → /api/jobs/public-bait
//
//   getJobById   → single job lookup, used by /:id/full when caller has JobID
//   upsertJob    → admin write hook (approve/edit)
//   removeJob    → admin write hook (reject/delete)
//   refreshJobsCache → wipe + reload (called after scraper finishes)
export {
    initJobsCache,
    refreshJobsCache,
    getAllJobs,
    getJobById,
    upsertJob,
    removeJob,
    getCacheStats,
    isJobsCacheReady,
} from './jobsCache.js';

// ── Scraper fingerprint cache ──────────────────────────────────────────────
// Maps a job fingerprint to the AI verdict already recorded for it, so a
// re-scrape of an unchanged posting skips the API call.
export {
    initAiResultCache,
    lookupFingerprint,
    saveAiResult,
    getCacheSize as getAiResultCacheSize,
    isAiResultCacheReady,
} from './aiResultCache.js';

export {
    getJobsPaginatedFromCache,
    getFilterCountsFromCache,
    getCompanyNamesFromCache,
    getCategoryCountsFromCache,
    getPublicBaitJobsFromCache,
} from './jobsQuery.js';

// ── Remote jobs vertical (/api/remote-jobs) ────────────────────────────────
// A fully independent cache over the "remoteJobs" collection: separate Map,
// separate inverted indexes, separate refresh cycle. Nothing here touches the
// German cache above.
export {
    initRemoteJobsCache,
    refreshRemoteJobsCache,
    getAllRemoteJobs,
    getRemoteJobById,
    upsertRemoteJob,
    removeRemoteJob,
    applyRemoteJobChanges,
    getRemoteCacheStats,
} from './remoteJobsCache.js';

// Real-time cache invalidation over the remoteJobs collection. The scraper
// writes straight to Mongo, so without this the API only sees its own boot-time
// snapshot.
export {
    startRemoteJobsWatcher,
    stopRemoteJobsWatcher,
    getRemoteJobsWatcherStats,
} from './remoteJobsWatcher.js';

export {
    getRemoteJobsPaginatedFromCache,
    getRemoteFilterCountsFromCache,
    getRemoteCompanyNamesFromCache,
    getRemoteCategoryCountsFromCache,
    getRemotePublicBaitJobsFromCache,
} from './remoteJobsQuery.js';
