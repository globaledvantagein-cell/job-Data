import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { client, connectToDb } from './db/index.js';
import { runScraper } from './cron/runScraper.js';
import { runValidator } from './cron/runValidator.js';
import { runWeeklyDigest } from './cron/runWeeklyDigest.js';
import { runWeeklyReset } from './cron/runWeeklyReset.js';
import { jobsApiRouter } from './api/jobs.routes.js';
import { remoteJobsRouter } from './api/jobs/remoteRead.routes.js';
import { authRouter } from './api/auth.routes.js';
import { analyticsRouter } from './api/analytics.routes.js';
import { feedbackRouter } from './api/feedback.routes.js';
import { careerGuideRouter } from './api/careerGuide.routes.js';
import { adminCareerGuideRouter } from './api/admin/careerGuide.routes.js';
import { adminCompanyProfilesRouter } from './api/admin/companyProfiles.routes.js';
import { adminHealthRouter } from './api/admin/health.routes.js';
import { cohortWaitlistAdminRouter } from './api/auth/cohortWaitlist.routes.js';
import { attachVisitor } from './middleware/visitorMiddleware.js';
import { FRONTEND_ORIGIN } from './env.js';
import { initJobsCache, initRemoteJobsCache, startRemoteJobsWatcher, isJobsCacheReady } from './cache/index.js';

// --- Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy so x-forwarded-for resolves to the real client IP behind
// any reverse proxy (Render, Fly, Railway, nginx). REQUIRED for the
// visitor IP-hash component of the gate.
app.set('trust proxy', 1);

// --- Middleware ---
// CORS must allow credentials so the vid cookie + Authorization header
// flow correctly between frontend and backend. Set FRONTEND_ORIGIN in .env.
app.use(cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(attachVisitor); // adds lazy req.resolveVisitor() to every request

// Warm-up guard. app.listen() accepts connections IMMEDIATELY, while the boot
// callback below still needs ~90s to load 4k+ jobs into RAM. Without this,
// every cache-backed route (job list, Smart Match, Today's Matches) threw
// "[jobsCache] cache is not initialized yet" and surfaced as a generic 500 for
// the first minute-and-a-half after every deploy/restart. A 503 + Retry-After
// is the honest answer: the server is up, this route just isn't ready yet.
const requireCacheReady = (req, res, next) => {
    if (isJobsCacheReady()) return next();
    res.set('Retry-After', '30');
    return res.status(503).json({
        error: 'Server is starting up — job data is still loading. Please retry in a moment.',
        code: 'CACHE_WARMING_UP',
    });
};

// --- API Routes ---
app.use('/api/auth', authRouter);
app.use('/api/jobs', requireCacheReady, jobsApiRouter);
app.use('/api/remote-jobs', remoteJobsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/career-guide', careerGuideRouter);
app.use('/api/admin/career-guide', adminCareerGuideRouter);
app.use('/api/admin/company-profiles', adminCompanyProfilesRouter);
app.use('/api/admin/health', adminHealthRouter);
app.use('/api/admin/cohort-waitlist', cohortWaitlistAdminRouter);

// NOTE: All public HTML pages — the /city/*, /category/*, /sitemap.xml SEO
// landing pages and the /career-guide/* pages — are now served by the Next.js
// frontend (App Router). Express is API-only; it renders no HTML.

// --- Health Check ---
app.get('/', (req, res) => {
    res.send('Job Scraper Backend is running and healthy.');
});

// --- Start Server & Schedule Tasks ---
app.listen(PORT, async () => {
    try {
        await connectToDb();

        // const { initJobsCache } = await import('./cache/index.js');
        // await initJobsCache();
            // runScraper();


        // const {initJobsCache}=await import('./cache/index.js');
        await initJobsCache()
        // The remote vertical loads its own independent cache from the
        // "remoteJobs" collection. A failure here must not take down the
        // German product, so it's warned-and-continued rather than fatal.
        try {
            await initRemoteJobsCache();

            // The remote scraper writes to Mongo out-of-process, so the cache
            // would otherwise never see anything after this initial load. The
            // watcher subscribes to the collection's change stream and applies
            // each write as it commits. It never throws — if it cannot start,
            // the cache simply behaves as it did before.
            const mode = await startRemoteJobsWatcher();
            console.log(`[remoteJobsWatcher] live invalidation active (mode: ${mode})`);
        } catch (remoteErr) {
            console.warn('[remoteJobsCache] init failed:', remoteErr.message);
        }
        console.log(`✅ API Server is running on http://localhost:${PORT}`);
        console.log("Setting up scheduled tasks...");

        cron.schedule('0 6 * * *', () => {
            console.log('--- Cron Job: Running Scraper ---');
            runScraper();
        });

        cron.schedule('0 2 * * *', () => {
            console.log('--- Cron Job: Running Validator ---');
            runValidator();
        });

        // Weekly digest — daily at 8:00 AM UTC during testing.
        // Change back to '0 8 * * 1' (Monday only) when ready for production.
         cron.schedule('0 8 * * 1', () => {
            console.log('--- Cron Job: Running Weekly Digest ---');
            runWeeklyDigest().catch(err => console.error('[digest] Failed:', err));
        });

        // Weekly usage-counter reset — every Monday at 00:00 UTC.
        cron.schedule('0 0 * * 1', () => {
            console.log('--- Cron Job: Running Weekly Reset ---');
            runWeeklyReset().catch(err => console.error('[weekly-reset] Failed:', err));
        }, { timezone: 'UTC' });

        console.log("✅ Cron tasks are scheduled.");
        console.log('--- Running initial scrape on start... ---');
        // runScraper();

    } catch (err) {
        console.error("Failed to start server or connect to DB", err);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('Shutting down server and database connection...');
    await client.close();
    process.exit(0);
});