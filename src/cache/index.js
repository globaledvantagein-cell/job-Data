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
} from './jobsCache.js';

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
    getRemoteCacheStats,
} from './remoteJobsCache.js';

export {
    getRemoteJobsPaginatedFromCache,
    getRemoteFilterCountsFromCache,
    getRemoteCompanyNamesFromCache,
    getRemoteCategoryCountsFromCache,
    getRemotePublicBaitJobsFromCache,
} from './remoteJobsQuery.js';
