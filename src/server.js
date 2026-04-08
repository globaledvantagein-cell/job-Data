import 'dotenv/config'; // Make sure to load environment variables first
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { client, connectToDb } from './db/index.js';
import { runScraper } from './cron/runScraper.js';
import { runValidator } from './cron/runValidator.js';
import { runMatcher } from './cron/runMatcher.js';
import { jobsApiRouter } from './api/jobs.routes.js';
import { usersApiRouter } from './api/users.routes.js';
import { authRouter } from './api/auth.routes.js';
import { analyticsRouter } from './api/analytics.routes.js';
import { feedbackRouter } from './api/feedback.routes.js';

// --- Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors()); // Allow your React app (on a different port) to make requests
app.use(express.json()); // Allow the server to understand JSON request bodies

// --- API Routes ---
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsApiRouter); // All job-related routes are in a separate file
app.use('/api/users', usersApiRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/feedback', feedbackRouter);
// --- Health Check Endpoint ---
app.get('/', (req, res) => {
    res.send('Job Scraper Backend is running and healthy.');
});

// --- Start Server & Schedule Tasks ---
app.listen(PORT, async () => {
    try {
        await connectToDb(); // Connect to MongoDB once when the server starts
        console.log(`✅ API Server is running on http://localhost:${PORT}`);
        console.log("Setting up scheduled tasks...");

        // --- Scheduled Cron Jobs ---

        // ✅ UPDATED: Run the scraper every day at 6:00 AM
        cron.schedule('0 6 * * *', () => {
            console.log('--- Cron Job: Running Scraper ---');
            runScraper();
        });

        // Run the validator script once per day at 2:00 AM (No Change)
        cron.schedule('0 2 * * *', () => {
            console.log('--- Cron Job: Running Validator ---');
            runValidator();
        });

        // ✅ UPDATED: Run the email matcher script every two days at 8:00 AM
        cron.schedule('0 8 */2 * *', () => {
            console.log('--- Cron Job: Running Matcher ---');
            runMatcher();
        });

        console.log("✅ Cron tasks are scheduled.");

        // --- FOR TESTING ONLY --- 
        // ✅ UPDATED: This block is now UNCOMMENTED.
        // This will run the scraper ONCE every time the server starts.
        console.log('--- Running initial scrape on start... ---');
        runScraper();
        // runMatcher();



    } catch (err) {
        console.error("Failed to start server or connect to DB", err);
        process.exit(1);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server and database connection...');
    await client.close();
    process.exit(0);
});