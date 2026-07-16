import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { client, connectToDb } from './db/index.js';
import { runScraper } from './cron/runScraper.js';
import { runValidator } from './cron/runValidator.js';
import { runWeeklyDigest } from './cron/runWeeklyDigest.js';
import { jobsApiRouter } from './api/jobs.routes.js';
import { authRouter } from './api/auth.routes.js';
import { analyticsRouter } from './api/analytics.routes.js';
import { feedbackRouter } from './api/feedback.routes.js';
import { adminCareerGuideRouter } from './api/admin/careerGuide.routes.js';
import { adminCompanyProfilesRouter } from './api/admin/companyProfiles.routes.js';
import { attachVisitor } from './middleware/visitorMiddleware.js';
import { FRONTEND_ORIGIN } from './env.js';
import { initJobsCache } from './cache/index.js';

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

// --- API Routes ---
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsApiRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/admin/career-guide', adminCareerGuideRouter);
app.use('/api/admin/company-profiles', adminCompanyProfilesRouter);

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


        // const {initJobsCache}=await import('./cache/index.js');
        await initJobsCache()
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