/**
 * One-time migration: extract structured requirements for every active job.
 *
 * For each active job missing a `parsedRequirements` field, sends its description
 * to Gemma 4 31B (via src/gemma) and stores the structured result back on the job.
 *
 * RESUMABLE: the query only matches jobs without `parsedRequirements`, so if the
 * script crashes at job 500 you can simply re-run it and it picks up from 501.
 *
 *   node src/scripts/migrate-requirements.js --dry-run   # first 3 jobs, no writes
 *   node src/scripts/migrate-requirements.js             # full migration
 *
 * NOTE: connection.js exports connectToDb() and jobModel.js does NOT export a
 * Mongoose model — so this script uses the native `jobs` collection, matching the
 * existing backfill-categories.js pattern.
 */

// env.js must load dotenv before anything else reads process.env.
import '../env.js';

import { connectToDb } from '../db/connection.js';
import { extractRequirements } from '../gemma/extractRequirements.js';
import { getKeyCount } from '../gemma/keyManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// Calls take 25-40s each — natural pace is ~2 RPM, well under the 15 RPM limit.
// No artificial delay needed.
const DELAY_BETWEEN_CALLS_MS = 0;
const DRY_RUN_LIMIT = 6;
const PROGRESS_EVERY = 10;
const CONCURRENCY = 6;  // number of parallel workers (1 per API key is safe)

const QUERY = { Status: 'active', parsedRequirements: { $exists: false } };

const isDryRun = process.argv.includes('--dry-run');

// Shared progress state so the SIGINT handler can report it.
const progress = {
    total: 0,
    processed: 0,
    successCount: 0,
    failCount: 0,
    failures: [],
    startedAt: null,
};

let isShuttingDown = false;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

/**
 * Logs a one-line progress update with an ETA derived from the ACTUAL average
 * time per job so far (not the static 4.5s estimate).
 */
function logProgress() {
    const { total, processed, successCount, failCount, startedAt } = progress;
    const elapsedMs = Date.now() - startedAt;
    const avgMsPerJob = processed > 0 ? elapsedMs / processed : DELAY_BETWEEN_CALLS_MS;
    const remaining = total - processed;
    const etaMs = remaining * avgMsPerJob;
    const etaMin = Math.round(etaMs / 60_000);
    const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : '0.0';

    console.log(
        `Progress: ${processed}/${total} (${pct}%) | ` +
        `Success: ${successCount} | Failed: ${failCount} | ETA: ${etaMin} min`
    );
}

/**
 * Prints the final summary and exits (0 = clean, 1 = had failures).
 */
function finish() {
    const { total, processed, successCount, failCount, failures, startedAt } = progress;
    const elapsedMs = Date.now() - startedAt;

    console.log('\n──────────────────────────────────────────────');
    console.log('[migrate-requirements] DONE');
    console.log(`  Matched:    ${total}`);
    console.log(`  Processed:  ${processed}`);
    console.log(`  Success:    ${successCount}`);
    console.log(`  Failed:     ${failCount}`);
    console.log(`  Total time: ${formatDuration(elapsedMs)}`);

    if (failures.length > 0) {
        console.log(`\n  Failed job IDs (retry manually):`);
        for (const id of failures) {
            console.log(`    ${id}`);
        }
    }
    console.log('──────────────────────────────────────────────');

    process.exit(failCount > 0 ? 1 : 0);
}

async function main() {
    console.log(`[migrate-requirements] Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'FULL MIGRATION'}`);

    // ── Connect ──────────────────────────────────────────────────────────────
    let db;
    try {
        db = await connectToDb();
    } catch (err) {
        console.error('[migrate-requirements] MongoDB connection FAILED:', err);
        process.exit(1);
    }

    const jobs = db.collection('jobs');

    // ── Find work ────────────────────────────────────────────────────────────
    const allMatching = await jobs
        .find(QUERY, {
            projection: {
                _id: 1, Description: 1, JobTitle: 1, Company: 1,
                ExperienceLevel: 1, EmploymentType: 1, Category: 1,
            },
        })
        .toArray();

    const jobsToProcess = isDryRun ? allMatching.slice(0, DRY_RUN_LIMIT) : allMatching;

    progress.total = jobsToProcess.length;
    progress.startedAt = Date.now();

    const keyCount = getKeyCount();
    const estTotalMs = jobsToProcess.length * DELAY_BETWEEN_CALLS_MS;

    console.log(`[migrate-requirements] Jobs to process: ${jobsToProcess.length}`);
    console.log(`[migrate-requirements] API keys available: ${keyCount}`);
    console.log(`[migrate-requirements] Estimated time: ${formatDuration(estTotalMs)} ` +
        `(@ ${DELAY_BETWEEN_CALLS_MS / 1000}s/job)`);

    if (jobsToProcess.length === 0) {
        console.log('[migrate-requirements] Nothing to do — all active jobs already processed.');
        process.exit(0);
    }

    // ── Process with parallel workers ─────────────────────────────────────────
    let cursor = 0;

    async function processJob(job, index) {
        const result = await extractRequirements(job);

        progress.processed++;

        if (result) {
            if (isDryRun) {
                console.log(`\n[dry-run] Job ${index + 1}/${jobsToProcess.length} — ` +
                    `${job.JobTitle} @ ${job.Company} (${job._id})`);
                console.log(JSON.stringify(result, null, 2));
            } else {
                await jobs.updateOne(
                    { _id: job._id },
                    { $set: { parsedRequirements: result } }
                );
            }
            progress.successCount++;
        } else {
            console.warn(`[migrate-requirements] EXTRACTION FAILED — ` +
                `${job._id} | ${job.JobTitle}`);
            progress.failures.push(job._id);
            progress.failCount++;
        }

        if (!isDryRun && progress.processed % PROGRESS_EVERY === 0) {
            logProgress();
        }
    }

    // Each worker grabs the next job from the shared cursor.
    // JS is single-threaded so cursor++ is safe — no race conditions.
    async function worker() {
        while (!isShuttingDown) {
            const idx = cursor++;
            if (idx >= jobsToProcess.length) break;
            await processJob(jobsToProcess[idx], idx);
            if (DELAY_BETWEEN_CALLS_MS > 0) await sleep(DELAY_BETWEEN_CALLS_MS);
        }
    }

    const workerCount = Math.min(CONCURRENCY, jobsToProcess.length);
    console.log(`[migrate-requirements] Workers: ${workerCount} parallel`);

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (isDryRun) {
        console.log(`\n[dry-run] Processed ${progress.processed} job(s) — ` +
            `${progress.successCount} ok, ${progress.failCount} failed. No DB writes made.`);
        process.exit(0);
    }

    finish();
}

// ── Graceful Ctrl+C ──────────────────────────────────────────────────────────
process.on('SIGINT', () => {
    if (isShuttingDown) return; // second Ctrl+C — let it force-quit
    isShuttingDown = true;
    console.log('\n[migrate-requirements] SIGINT received — stopping after current job...');
    logProgress();
    finish();
});

main().catch(err => {
    console.error('[migrate-requirements] FATAL:', err);
    process.exit(1);
});