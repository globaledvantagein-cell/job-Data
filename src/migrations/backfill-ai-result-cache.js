// ─── Backfill: jobTestLogs → aiResultCache ─────────────────────────────────────
//
// One-time migration. Run ONCE before deploying the lean-cache code.
//
// The scraper's fingerprint cache used to live in jobTestLogs, which stored a
// full copy of every job it had ever seen (91MB / ~15K docs) so that five
// fields could be read back. aiResultCache keeps only those five fields plus
// the fingerprint, at roughly 200 bytes a row.
//
// Without this backfill the new cache boots empty, every previously-analyzed
// job looks brand new, and the next scrape re-sends all ~15K of them to Gemini
// — which the per-model daily caps would stop partway through.
//
// Idempotent: $merge uses whenMatched 'keepExisting', so re-running never
// overwrites an entry the live scraper has already written. jobTestLogs is
// only ever read.
//
//   node src/migrations/backfill-ai-result-cache.js

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'job-scraper';

const SOURCE = 'jobTestLogs';
const TARGET = 'aiResultCache';

async function run() {
    console.log('🚀 Backfilling the AI result cache from jobTestLogs...\n');

    if (!MONGO_URI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();

    try {
        const db = client.db(DB_NAME);

        // Bail out clearly rather than reporting a successful backfill of zero.
        const collections = (await db.listCollections().toArray()).map(c => c.name);
        if (!collections.includes(SOURCE)) {
            console.log(`[Migration] Source collection "${SOURCE}" does not exist — nothing to backfill.`);
            return;
        }

        const sourceCount = await db.collection(SOURCE).countDocuments();
        const targetBefore = collections.includes(TARGET)
            ? await db.collection(TARGET).countDocuments()
            : 0;

        console.log(`[Migration] ${SOURCE}: ${sourceCount} docs`);
        console.log(`[Migration] ${TARGET}: ${targetBefore} docs before backfill\n`);

        // $merge matches on `fingerprint`, which requires a unique index on the
        // target. The model declares one, but this script may run before the app
        // has ever booted — so make sure it exists.
        await db.collection(TARGET).createIndex({ fingerprint: 1 }, { unique: true });

        console.log('[Migration] Running aggregation...');
        await db.collection(SOURCE).aggregate([
            { $match: { fingerprint: { $ne: null } } },
            // One job can have several log entries across re-scrapes; the
            // fingerprint is the identity, so collapse to the first of each.
            { $group: { _id: '$fingerprint', d: { $first: '$$ROOT' } } },
            {
                $project: {
                    _id: 0,
                    fingerprint: '$_id',
                    germanRequired: '$d.GermanRequired',
                    confidence: '$d.ConfidenceScore',
                    domain: '$d.Domain',
                    subDomain: '$d.SubDomain',
                    createdAt: '$d.createdAt',
                },
            },
            {
                $merge: {
                    into: TARGET,
                    on: 'fingerprint',
                    whenMatched: 'keepExisting',
                    whenNotMatched: 'insert',
                },
            },
        ]).toArray(); // $merge writes as the pipeline drains; this awaits completion

        const targetAfter = await db.collection(TARGET).countDocuments();
        const inserted = targetAfter - targetBefore;

        console.log(`\n[Migration] Backfilled ${inserted} fingerprints from ${SOURCE} → ${TARGET}`);
        console.log(`[Migration] ${TARGET} now holds ${targetAfter} entries`);

        // A row the old collection never filled leaves the cache unable to
        // reconstruct a verdict, so surface it rather than letting the scraper
        // hit it as a silent bad hit.
        const incomplete = await db.collection(TARGET).countDocuments({
            $or: [
                { germanRequired: { $exists: false } },
                { germanRequired: null },
                { confidence: { $exists: false } },
                { confidence: null },
            ],
        });
        if (incomplete > 0) {
            console.warn(`[Migration] ⚠️  ${incomplete} entries have a null germanRequired/confidence — these came from incomplete test logs and will be re-analyzed.`);
        }

        console.log(`[Migration] Old ${SOURCE} collection (${sourceCount} docs, untouched) can be dropped manually after verifying the new cache works`);
    } finally {
        await client.close();
    }
}

run()
    .then(() => {
        console.log('\n✅ Migration complete.');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    });
