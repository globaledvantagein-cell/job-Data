// ─── Backfill salary from Gemma requirements ──────────────────────────────
//
// One-time migration. Jobs whose parsedRequirements were extracted BEFORE the
// prompt gained salary fields have no salary_* keys, so this re-runs the Gemma
// extraction on them purely to recover salary.
//
// Targets: Status='active' AND parsedRequirements exists AND SalaryMin is null.
// Never overwrites an ATS-provided salary (buildSalaryUpdate enforces that).
//
// Only the Salary* fields are written — parsedRequirements is left as-is so a
// re-extraction can't silently change data the skill matcher already depends on.
//
// Usage:
//   node src/migrations/backfill-salary-from-requirements.js --dry-run
//   node src/migrations/backfill-salary-from-requirements.js --limit=50
//   node src/migrations/backfill-salary-from-requirements.js
//
// Flags:
//   --dry-run   report what would change; writes nothing
//   --limit=N   process at most N jobs (run in chunks — this costs 1 Gemma
//               call per job, and the full backlog is ~1,500 jobs)
import 'dotenv/config';
import { connectToDb, client } from '../db/connection.js';
import { extractRequirements } from '../gemma/extractRequirements.js';
import { buildSalaryUpdate } from '../gemma/backgroundExtractor.js';
import { refreshJobsCache } from '../cache/jobsCache.js';

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 3000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
    const isDryRun = argv.includes('--dry-run');
    const limitArg = argv.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
    return { isDryRun, limit: Number.isFinite(limit) && limit > 0 ? limit : null };
}

async function run() {
    const { isDryRun, limit } = parseArgs(process.argv.slice(2));

    console.log('─────────────────────────────────────────────');
    console.log('Backfill salary from Gemma requirements');
    console.log(`  mode : ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
    console.log(`  limit: ${limit ?? 'none (full backlog)'}`);
    console.log('─────────────────────────────────────────────');

    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const query = {
        Status: 'active',
        parsedRequirements: { $exists: true },
        $or: [{ SalaryMin: null }, { SalaryMin: { $exists: false } }],
    };

    const totalMatching = await jobsCollection.countDocuments(query);
    const cursor = jobsCollection.find(query, {
        projection: { JobTitle: 1, Company: 1, Description: 1, SalaryMin: 1 },
    });
    const jobs = limit ? await cursor.limit(limit).toArray() : await cursor.toArray();

    console.log(`Matching jobs: ${totalMatching}${limit ? ` — processing ${jobs.length}` : ''}`);
    if (jobs.length === 0) {
        console.log('Nothing to do.');
        return { processed: 0, updated: 0, noSalary: 0, failed: 0 };
    }
    console.log(`Gemma calls required: ${jobs.length}\n`);

    let processed = 0;
    let updated = 0;
    let noSalary = 0;
    let failed = 0;

    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const batch = jobs.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

        // Concurrent within a batch; the Gemma client handles its own key
        // rotation and 429 backoff.
        await Promise.all(batch.map(async (job) => {
            processed += 1;
            try {
                const result = await extractRequirements(job);
                if (!result) { failed += 1; return; }

                const salaryUpdate = buildSalaryUpdate(job, result);
                if (Object.keys(salaryUpdate).length === 0) { noSalary += 1; return; }

                if (!isDryRun) {
                    await jobsCollection.updateOne(
                        { _id: job._id },
                        { $set: { ...salaryUpdate, updatedAt: new Date() } },
                    );
                }
                updated += 1;
                console.log(
                    `  ${isDryRun ? '[dry] ' : ''}✓ ${salaryUpdate.SalaryMin ?? '?'}-${salaryUpdate.SalaryMax ?? '?'} ` +
                    `${salaryUpdate.SalaryCurrency}/${salaryUpdate.SalaryInterval} — ${job.JobTitle} @ ${job.Company}`,
                );
            } catch (error) {
                failed += 1;
                console.warn(`  ✗ ${job.JobTitle} @ ${job.Company}: ${error.message}`);
            }
        }));

        console.log(`[batch ${batchNumber}/${totalBatches}] processed ${processed}/${jobs.length} — ${updated} with salary`);

        if (i + BATCH_SIZE < jobs.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
    }

    console.log('\n─────────────────────────────────────────────');
    console.log(`Processed     : ${processed}`);
    console.log(`Salary found  : ${updated}${isDryRun ? ' (would update)' : ' (updated)'}`);
    console.log(`No salary in JD: ${noSalary}`);
    console.log(`Failed        : ${failed}`);
    if (limit && totalMatching > jobs.length) {
        console.log(`\nRemaining after this run: ${totalMatching - jobs.length}`);
    }
    console.log('─────────────────────────────────────────────');

    // Reload the RAM cache so the freshly-backfilled salaries show up in the
    // public /jobs list without waiting for the next scraper run. Only worth
    // doing when we actually wrote something (never on a dry run).
    if (!isDryRun && updated > 0) {
        console.log('Refreshing jobs cache...');
        await refreshJobsCache();
    }

    return { processed, updated, noSalary, failed };
}

run()
    .catch(error => {
        console.error('[backfill-salary] Fatal:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await client.close();
    });
