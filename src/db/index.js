// ── Database Connection ──
export { client, connectToDb } from './connection.js';

// ── Job Queries ──
export {
    loadAllExistingIDs,
    saveJobs,
    saveJobTestLog,
    findTestLogByFingerprint,
    deleteOldJobs,
    deleteJobById,
    addCuratedJob,
    getAllJobs,
    getPublicBaitJobs,
    getJobsPaginated,
    getCompanyNames,
    getCategoryCounts,
    getRejectedJobs,
    getJobsForReview,
    reviewJobDecision,
    trackApplyClick,
    getCompanyDirectoryStats,
    findJobById,
    findJobByIdOrJobID,
    getJobsEligibleForReanalysis,
    countManuallyReviewedJobs,
    updateJobAfterReanalysis,
    restoreRejectedJobToQueue,
    deleteJobsByCompany,
    cleanAllDescriptions,
} from './jobQueries.js';

// ── User Queries ──
export {
    registerUser,
    loginUser,
    getUserProfile,
    addSubscriber,
    getSubscribedUsers,
    findMatchingJobs,
    updateUserAfterEmail,
    findOrCreateGoogleUser,
} from './userQueries.js';

// ── Feedback Queries ──
export {
    saveFeedback,
    getAllFeedback,
    updateFeedbackStatus,
    deleteFeedback,
    getFeedbackStats,
} from './feedbackQueries.js';

// ── Visitor / Gate helpers (live in middleware/visitorMiddleware.js) ──
export {
    shouldGate,
    recordJobView,
    linkVisitorToUser,
    attachVisitor,
} from '../middleware/visitorMiddleware.js';