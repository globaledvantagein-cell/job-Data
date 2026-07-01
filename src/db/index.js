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
    confirmApplied,
    getAppliedJobIds,
    getAppliedJobsWithDetails,
    getCompanyDirectoryStats,
    findJobById,
    findJobByIdOrJobID,
    getJobsEligibleForReanalysis,
    countManuallyReviewedJobs,
    updateJobAfterReanalysis,
    restoreRejectedJobToQueue,
    deleteJobsByCompany,
    cleanAllDescriptions,
    getDigestJobs,
} from './jobQueries.js';

// ── User Queries ──
export {
    registerUser,
    loginUser,
    getUserProfile,
    getSubscribedUsers,
    findOrCreateGoogleUser,
    updateLastEmailSent,
    unsubscribeUser,
    updateUserPreferences,
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