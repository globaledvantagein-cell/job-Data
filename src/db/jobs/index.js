// Barrel for all job-related queries.
// Split from the old monolithic db/jobQueries.js for readability.

export {
    loadAllExistingIDs,
    saveJobs,
    saveJobTestLog,
    findTestLogByFingerprint,
    addCuratedJob,
} from './saveQueries.js';

export {
    getAllJobs,
    getPublicBaitJobs,
    findJobById,
    findJobByIdOrJobID,
} from './findQueries.js';

export {
    getJobsPaginated,
    getCompanyNames,
    getCategoryCounts,
} from './listQueries.js';

export {
    getRejectedJobs,
    getJobsForReview,
    reviewJobDecision,
    getJobsEligibleForReanalysis,
    countManuallyReviewedJobs,
    updateJobAfterReanalysis,
    restoreRejectedJobToQueue,
} from './reviewQueries.js';

export {
    deleteOldJobs,
    deleteJobById,
    deleteJobsByCompany,
    cleanAllDescriptions,
} from './cleanupQueries.js';

export { getCompanyDirectoryStats } from './directoryQueries.js';
export { trackApplyClick, confirmApplied, getAppliedJobIds } from './trackingQueries.js';
export { getDigestJobs } from './digestQueries.js';