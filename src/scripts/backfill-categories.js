/**
 * One-time backfill: sets Category on every job already in the DB.
 *
 * Run once after deploying the new code:
 *   node scripts/backfill-categories.js
 *
 * Safe to re-run — it just recomputes for every job. ~1500 jobs takes <5 seconds.
 * Also creates a MongoDB index on Category for fast filter queries.
 */
import { connectToDb } from '../db/connection.js';
import { categorizeJob, CATEGORY_LABELS } from '../core/categorize.js';

async function main() {
    const db = await connectToDb();
    const jobs = db.collection('jobs');

    console.log('[backfill] Loading all jobs...');
    const all = await jobs.find({}, {
        projection: {
            _id: 1, JobTitle: 1, Department: 1, SubDomain: 1, Domain: 1, Tags: 1,
        }
    }).toArray();
    console.log(`[backfill] Loaded ${all.length} jobs`);

    // Build bulk operations
    const ops = all.map(job => ({
        updateOne: {
            filter: { _id: job._id },
            update: { $set: { Category: categorizeJob(job) } },
        },
    }));

    if (ops.length === 0) {
        console.log('[backfill] Nothing to do.');
        process.exit(0);
    }

    // Run in batches of 500
    let done = 0;
    const batchSize = 500;
    while (done < ops.length) {
        const batch = ops.slice(done, done + batchSize);
        await jobs.bulkWrite(batch);
        done += batch.length;
        console.log(`[backfill] ${done}/${ops.length} updated`);
    }

    // Print final distribution
    const counts = await jobs.aggregate([
        { $match: { Status: 'active', GermanRequired: false } },
        { $group: { _id: '$Category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
    ]).toArray();
    console.log('\n[backfill] Active-job distribution by category:');
    for (const row of counts) {
        console.log(`  ${(CATEGORY_LABELS[row._id] || row._id).padEnd(28)} ${row.count}`);
    }

    // Create index for fast filter queries (skipped if it already exists)
    console.log('\n[backfill] Ensuring Category index...');
    await jobs.createIndex({ Category: 1, Status: 1, GermanRequired: 1 });
    console.log('[backfill] Index ready.');

    console.log('\n[backfill] Done.');
    process.exit(0);
}

main().catch(err => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
});