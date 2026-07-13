import { connectToDb } from '../db/connection.js';
import { SanitizeHtml } from '../utils/htmlUtils.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;

async function run() {
    console.log(`[migrate] Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    const db = await connectToDb();
    const col = db.collection('jobs');

    const total = await col.countDocuments({
        DescriptionHtml: { $exists: true, $ne: null, $ne: '' },
    });
    console.log(`[migrate] Found ${total} jobs with DescriptionHtml`);
    if (total === 0) { console.log('Nothing to do.'); process.exit(0); }

    const cursor = col.find(
        { DescriptionHtml: { $exists: true, $ne: null, $ne: '' } },
        { projection: { _id: 1, JobID: 1, DescriptionHtml: 1, Company: 1 } },
    );

    let processed = 0, changed = 0, skipped = 0, errors = 0;
    let batch = [];

    for await (const job of cursor) {
        try {
            const original = job.DescriptionHtml;
            const cleaned = SanitizeHtml(original);
            if (cleaned === original) { skipped++; }
            else {
                changed++;
                if (DRY_RUN) {
                    const diff = original.length - cleaned.length;
                    console.log(`  [would update] ${job.JobID} (${job.Company}) — ${diff > 0 ? '-' : '+'}${Math.abs(diff)} chars`);
                } else {
                    batch.push({ updateOne: { filter: { _id: job._id }, update: { $set: { DescriptionHtml: cleaned } } } });
                }
            }
        } catch (err) { errors++; console.error(`  [error] ${job.JobID}: ${err.message}`); }

        processed++;
        if (!DRY_RUN && batch.length >= BATCH_SIZE) {
            await col.bulkWrite(batch);
            batch = [];
            await new Promise(r => setTimeout(r, 50));
        }
        if (processed % 200 === 0) console.log(`[migrate] ${processed}/${total} (${changed} changed, ${skipped} unchanged)`);
    }

    if (!DRY_RUN && batch.length > 0) await col.bulkWrite(batch);

    console.log(`\n[migrate] Done — Total: ${processed}, Changed: ${changed}, Unchanged: ${skipped}, Errors: ${errors}`);
    process.exit(0);
}

run().catch(err => { console.error('[migrate] Fatal:', err); process.exit(1); });