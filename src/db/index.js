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
    saveJob,
    unsaveJob,
    getSavedJobIds,
    getSavedJobsWithDetails,
    getCompanyDirectoryStats,
    updateCompanyDescription,
    getCompanyProfile,
    getAllCompanyProfiles,
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
    saveMatchProfile,
    getMatchProfile,
    updateJobPreferences,
} from './userQueries.js';

// ── Career Guide Queries ──
export {
    CAREER_GUIDE_CATEGORIES,
    CAREER_GUIDE_CATEGORY_LABELS,
    slugify,
    createArticle,
    updateArticle,
    deleteArticle,
    getArticleBySlug,
    getArticleById,
    getArticlesByCategory,
    getAllPublishedArticles,
    getAllArticlesAdmin,
    publishArticle,
    unpublishArticle,
    getCategories,
} from './careerGuide.js';

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