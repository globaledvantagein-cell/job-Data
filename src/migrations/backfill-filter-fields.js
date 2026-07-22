// ─── Backfill canonical filter* fields ─────────────────────────────────────
//
// One-time migration. Chunk 1 introduced src/utils/filterNormalizer.js, which
// reconciles the ATS-scraped fields (WorkplaceType, ExperienceLevel, …) and the
// Gemma-extracted parsedRequirements into a single set of canonical, queryable
// filter* fields (filterWorkplace, filterExperience, …). Live approvals now
// write those fields, but every job that went active BEFORE that code shipped
// has none. This backfills them.
//
// Unlike backfill-salary-from-requirements, this makes NO Gemma calls — it's
// pure in-memory computation from fields already on each document. So it's fast:
// a lean projection + bulkWrite in batches, no rate limiting, no delay.
//
// Targets: Status='active' AND filterWorkplace does not yet exist.
//
// Idempotent: the query only matches un-backfilled docs, so re-running is safe.
//
// Usage:
//   node src/migrations/backfill-filter-fields.js --dry-run
//   node src/migrations/backfill-filter-fields.js --dry-run --limit=10
//   node src/migrations/backfill-filter-fields.js --limit=500
//   node src/migrations/backfill-filter-fields.js
//
// Flags:
//   --dry-run   report what would change; writes nothing
//   --limit=N   process at most N jobs
import 'dotenv/config';
import { connectToDb, client } from '../db/connection.js';
import { resolveAll } from '../utils/filterNormalizer.js';
import { refreshJobsCache } from '../cache/jobsCache.js';

const BATCH_SIZE = 500;

// Only the fields resolveAll() reads. Deliberately omits Description /
// DescriptionHtml so we don't pull megabytes of text into memory for 5k+ jobs.
const PROJECTION = {
    JobTitle: 1, Company: 1, Location: 1,
    WorkplaceType: 1, ExperienceLevel: 1, EmploymentType: 1,
    IsRemote: 1, isEntryLevel: 1,
    SalaryMin: 1, SalaryMax: 1, SalaryCurrency: 1, SalaryInterval: 1,
    parsedRequirements: 1,
};

function parseArgs(argv) {
    const isDryRun = argv.includes('--dry-run');
    const limitArg = argv.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
    return { isDryRun, limit: Number.isFinite(limit) && limit > 0 ? limit : null };
}

// Fresh tally objects so counts start clean each run.
function createFacetCounts() {
    return {
        workplace: { remote: 0, hybrid: 0, onsite: 0, null: 0 },
        experience: { entry: 0, mid: 0, senior: 0, lead: 0, executive: 0, null: 0 },
        employment: { fulltime: 0, parttime: 0, contract: 0, internship: 0, null: 0 },
        visa: { available: 0, null: 0 },
        relocation: { available: 0, null: 0 },
        salary: { ats: 0, jd: 0, null: 0 },
    };
}

// Bump the right bucket for one resolved filter object. `null` values land in
// the 'null' bucket (keys are stringified, so null → 'null').
function tallyFacets(counts, filterFields) {
    counts.workplace[filterFields.filterWorkplace ?? 'null'] += 1;
    counts.experience[filterFields.filterExperience ?? 'null'] += 1;
    counts.employment[filterFields.filterEmployment ?? 'null'] += 1;
    counts.visa[filterFields.filterVisa ?? 'null'] += 1;
    counts.relocation[filterFields.filterRelocation ?? 'null'] += 1;
    counts.salary[filterFields.filterSalaryTier ?? 'null'] += 1;
}

function printSummaryTable(counts) {
    console.log('\n─── Filter facet health check ─────────────────');
    for (const [facet, buckets] of Object.entries(counts)) {
        const parts = Object.entries(buckets).map(([label, n]) => `${label}: ${n}`);
        console.log(`  ${facet.padEnd(11)} ${parts.join(', ')}`);
    }
    console.log('───────────────────────────────────────────────');
}

async function run() {
    const { isDryRun, limit } = parseArgs(process.argv.slice(2));

    console.log('─────────────────────────────────────────────');
    console.log('Backfill canonical filter* fields');
    console.log(`  mode : ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
    console.log(`  limit: ${limit ?? 'none (all matching)'}`);
    console.log('─────────────────────────────────────────────');

    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const query = {
        Status: 'active',
        filterWorkplace: { $exists: false },
    };

    const totalMatching = await jobsCollection.countDocuments(query);
    const cursor = jobsCollection.find(query, { projection: PROJECTION });
    const jobs = limit ? await cursor.limit(limit).toArray() : await cursor.toArray();

    console.log(`Matching jobs: ${totalMatching}${limit ? ` — processing ${jobs.length}` : ''}`);
    if (jobs.length === 0) {
        console.log('Nothing to do.');
        return { processed: 0, updated: 0 };
    }

    const counts = createFacetCounts();
    let processed = 0;
    let updated = 0;

    const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const batch = jobs.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        const operations = [];
        for (const job of batch) {
            processed += 1;
            const filterFields = resolveAll(job);
            tallyFacets(counts, filterFields);

            operations.push({
                updateOne: {
                    filter: { _id: job._id },
                    update: { $set: { ...filterFields, filterBackfilledAt: new Date() } },
                },
            });
        }

        if (!isDryRun && operations.length > 0) {
            const result = await jobsCollection.bulkWrite(operations, { ordered: false });
            updated += result.modifiedCount;
        } else {
            // Dry run: count what we would have written.
            updated += operations.length;
        }

        // Running facet snapshot after each batch.
        const w = counts.workplace;
        const salaryWithData = counts.salary.ats + counts.salary.jd;
        console.log(
            `[batch ${batchNumber}/${totalBatches}] processed ${processed}/${jobs.length} — ` +
            `remote: ${w.remote}, hybrid: ${w.hybrid}, onsite: ${w.onsite}, salary: ${salaryWithData}`,
        );
    }

    console.log('\n─────────────────────────────────────────────');
    console.log(`Processed : ${processed}`);
    console.log(`${isDryRun ? 'Would update' : 'Updated'}   : ${updated}`);
    if (limit && totalMatching > jobs.length) {
        console.log(`\nRemaining after this run: ${totalMatching - jobs.length}`);
    }
    console.log('─────────────────────────────────────────────');

    printSummaryTable(counts);

    // Reload the RAM cache so the freshly-backfilled filter fields show up in
    // the public /jobs list immediately. Only when we actually wrote something.
    if (!isDryRun && updated > 0) {
        console.log('\nRefreshing jobs cache...');
        await refreshJobsCache();
    }

    return { processed, updated };
}

run()
    .catch(error => {
        console.error('[backfill-filter-fields] Fatal:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await client.close();
    });
