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
