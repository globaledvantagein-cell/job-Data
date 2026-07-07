import { Router } from 'express';
import { attachPublicReadRoutes } from './jobs/publicRead.routes.js';
import { attachAdminReviewRoutes } from './jobs/adminReview.routes.js';
import { attachApplyClickRoute } from './jobs/applyClick.routes.js';
import { attachAdminReanalysisRoutes } from './jobs/adminReanalysis.routes.js';
import { attachAdminCuratedRoutes } from './jobs/adminCurated.routes.js';
import { attachTestLogsRoute } from './jobs/testLogs.routes.js';
import { attachAdminMaintenanceRoutes } from './jobs/adminMaintenance.routes.js';
import { attachCacheDebugRoute } from './jobs/cacheDebug.routes.js';
import { attachResumeMatchRoutes } from './admin/resumeMatch.routes.js';
import { attachSkillMatchRoutes } from './jobs/skillMatch.routes.js';

/**
 * The main jobs router. Each section lives in its own file under ./jobs/.
 * Registration order matters: static paths (/public-bait, /company-names) must
 * be attached before catch-all (:id) patterns to avoid conflicts.
 */
export const jobsApiRouter = Router();

attachPublicReadRoutes(jobsApiRouter);     // /public-bait, /, /:id/full, /company-names, /category-counts, /directory
attachSkillMatchRoutes(jobsApiRouter);    // GET /skill-matches (must be before :id catch-all)
attachAdminReviewRoutes(jobsApiRouter);    // /admin/review, /admin/decision/:id, /rejected, /admin/restore/:id
attachApplyClickRoute(jobsApiRouter);      // POST /:id/apply-click
attachAdminReanalysisRoutes(jobsApiRouter);// /admin/reanalyze-all, /admin/reanalyze/:id, /:id/analyze
attachAdminCuratedRoutes(jobsApiRouter);   // POST /, DELETE /:id, DELETE /company
attachTestLogsRoute(jobsApiRouter);        // GET /test-logs
attachAdminMaintenanceRoutes(jobsApiRouter);// clean-descriptions, fix-salaries, backfill-experience, update/:id
attachCacheDebugRoute(jobsApiRouter);      // GET /_cache/stats
attachResumeMatchRoutes(jobsApiRouter);    // POST /admin/resume-match