import fetch from 'node-fetch';
import { connectToDb, deleteJobById } from '../db/index.js';

let isValidating = false;

/**
 * Check if a URL is still live.
 * Returns the HTTP status code, or a synthetic code on error.
 */
async function checkUrlStatus(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
        });
        return response.status;
    } catch (error) {
        if (error.name === 'AbortError') {
            return 504;
        }
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return 502;
        }
        return 500;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Validates job URLs.
 * ONLY checks active jobs — these are the ones shown to real users.
 * Deletes jobs with dead URLs (404 or 410).
 */
export async function runValidator() {
    if (isValidating) {
        console.log('Validator is already running. Skipping this scheduled run.');
        return;
    }
    isValidating = true;
    console.log("🏃‍♂️ Starting the Job Validator task...");

    try {
        const db = await connectToDb();
        const jobsCollection = db.collection('jobs');

        const activeJobs = await jobsCollection.find(
            { Status: 'active' },
            { projection: { _id: 1, ApplicationURL: 1, JobTitle: 1, Company: 1 } }
        ).toArray();

        console.log(`[Validator] Checking ${activeJobs.length} active jobs (skipping pending/rejected)...`);

        let deletedCount = 0;
        let checkedCount = 0;
        let errorCount = 0;

        for (const job of activeJobs) {
            checkedCount++;

            if (!job.ApplicationURL) {
                console.log(`[Validator] ⚠️ No URL for "${job.JobTitle}" — skipping`);
                continue;
            }

            const status = await checkUrlStatus(job.ApplicationURL);

            if (status === 404 || status === 410) {
                console.log(`[Validator] ❌ Dead (${status}): "${job.JobTitle}" at ${job.Company} — deleting`);
                await deleteJobById(job._id);
                deletedCount++;
            } else if (status === 403) {
                errorCount++;
            } else if (status >= 500) {
                console.warn(`[Validator] ⚠️ Server error (${status}): "${job.JobTitle}" — keeping`);
                errorCount++;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n[Validator] ✅ Complete:`);
        console.log(`  Checked: ${checkedCount} active jobs`);
        console.log(`  Deleted: ${deletedCount} dead jobs`);
        console.log(`  Errors/Skipped: ${errorCount}`);

    } catch (error) {
        console.error("An error occurred during the validation task:", error);
    } finally {
        isValidating = false;
        console.log("Validation task finished.");
    }
}

export async function findJobByUrl(applicationUrl) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    return await jobsCollection.findOne({ ApplicationURL: applicationUrl });
}
