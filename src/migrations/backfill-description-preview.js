// Backfill `descriptionPreview` — the first 200 characters of the plain-text
// Description — onto every active job in both `jobs` and `remoteJobs`.
// The preview is what the cache/teaser layer serves instead of loading the
// full 5–20KB Description into RAM.
//
//   node src/migrations/backfill-description-preview.js            # write
//   node src/migrations/backfill-description-preview.js --dry-run  # preview only
//
// BulkWrite in batches of 500.

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup dotenv to run standalone
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;
const PREVIEW_LENGTH = 200;

// Extract DB name from URI or fallback to default
let DB_NAME = 'job-scraper';
if (MONGO_URI) {
    try {
        const dbPath = new URL(MONGO_URI).pathname.replace(/^\//, '');
        if (dbPath) DB_NAME = dbPath;
    } catch {
        // ignore parse errors, use default
    }
}

/** First N chars of the Description as plain text (tags stripped, whitespace collapsed). */
function derivePreview(description) {
    return String(description || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_LENGTH);
}

async function backfillCollection(db, collectionName) {
    const collection = db.collection(collectionName);
    const cursor = collection.find(
        { Status: 'active' },
        { projection: { Description: 1 } },
    );

    let scanned = 0;
    let updated = 0;
    let operations = [];

    const flush = async () => {
        if (operations.length === 0) return;
        if (!DRY_RUN) {
            const result = await collection.bulkWrite(operations, { ordered: false });
            updated += result.modifiedCount || 0;
        } else {
            updated += operations.length;
        }
        operations = [];
    };

    for await (const job of cursor) {
        scanned++;
        operations.push({
            updateOne: {
                filter: { _id: job._id },
                update: { $set: { descriptionPreview: derivePreview(job.Description) } },
            },
        });
        if (operations.length >= BATCH_SIZE) {
            await flush();
            console.log(`[Backfill] ${collectionName}: ${scanned} scanned, ${updated} ${DRY_RUN ? 'would be ' : ''}updated`);
        }
    }
    await flush();

    console.log(`[Backfill] ${collectionName} done: ${scanned} active jobs scanned, ${updated} ${DRY_RUN ? 'would be ' : ''}updated`);
    return { scanned, updated };
}

async function run() {
    console.log(`🚀 descriptionPreview backfill${DRY_RUN ? ' (DRY RUN — nothing written)' : ''}...\n`);

    if (!MONGO_URI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    const jobsResult = await backfillCollection(db, 'jobs');
    const remoteResult = await backfillCollection(db, 'remoteJobs');

    console.log('\n========================================');
    console.log('🎉 Backfill complete!');
    console.log('========================================');
    console.log(`jobs:       ${jobsResult.scanned} scanned, ${jobsResult.updated} updated`);
    console.log(`remoteJobs: ${remoteResult.scanned} scanned, ${remoteResult.updated} updated`);
    console.log('========================================\n');

    await client.close();
    process.exit(0);
}

run().catch(async err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
