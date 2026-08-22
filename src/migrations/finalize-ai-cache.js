// ─── Finalize the AI cache migration ───────────────────────────────────────────
//
// The last step of retiring jobTestLogs. Run ONCE, after
// backfill-ai-result-cache.js and after the new code is deployed and verified.
//
//   Step 1  fingerprint the legacy jobTestLogs docs that predate the fingerprint
//           feature, so their AI verdicts survive into aiResultCache
//   Step 2  copy Evidence onto the job documents that still need it, so the
//           review queue keeps working once jobTestLogs is gone
//   Step 3  drop jobTestLogs
//
// DESTRUCTIVE at step 3 — and jobTestLogs is the only copy of that data. Steps 1
// and 2 must both succeed, and a coverage check must pass, or the drop is
// skipped. Use --dry-run to see what would happen, or --skip-drop to run the
// backfills without dropping anything.
//
//   node src/migrations/finalize-ai-cache.js
//   node src/migrations/finalize-ai-cache.js --dry-run
//   node src/migrations/finalize-ai-cache.js --skip-drop

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
// Imported, NOT reimplemented: the fingerprint must be byte-identical to what
// the scraper computes at runtime, and the real function trims before taking
// the first 500 chars. Re-deriving it here would risk a subtly different hash
// that never matches a live lookup.
import { generateJobFingerprint } from '../utils/hashUtils.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'job-scraper';

const LOGS = 'jobTestLogs';
const CACHE = 'aiResultCache';
const JOBS = 'jobs';

const BATCH = 500; // bulkWrite chunk size

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_DROP = process.argv.includes('--skip-drop');

const mb = bytes => (bytes / 1048576).toFixed(2);

/** Split an array into fixed-size chunks. */
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

// ─── Step 1 ────────────────────────────────────────────────────────────────────
//
// Some jobTestLogs docs predate the fingerprint field. Their AI verdicts are
// still good — they just never got a cache key. Recompute one from the job
// content they DO carry, so those verdicts survive the drop.
async function step1GenerateMissingFingerprints(db) {
    const legacy = await db.collection(LOGS).find(
        {
            $and: [
                { $or: [{ fingerprint: null }, { fingerprint: { $exists: false } }] },
                { JobTitle: { $exists: true, $ne: null } },
                { Company: { $exists: true, $ne: null } },
                { Description: { $exists: true, $ne: null } },
            ],
        },
        {
            projection: {
                JobTitle: 1, Company: 1, Description: 1,
                GermanRequired: 1, ConfidenceScore: 1, Domain: 1, SubDomain: 1, createdAt: 1,
            },
        },
    ).toArray();

    if (legacy.length === 0) {
        console.log('[Migration] Step 1: no legacy docs need a fingerprint — nothing to do');
        return { scanned: 0, upserted: 0 };
    }

    // Collapse duplicates up front: two legacy docs can hash to the same
    // fingerprint, and MongoDB rejects a bulkWrite with two upserts on one key.
    const byFingerprint = new Map();
    for (const doc of legacy) {
        const fingerprint = generateJobFingerprint(doc.JobTitle, doc.Company, doc.Description);
        if (byFingerprint.has(fingerprint)) continue; // first wins, same as the $group backfill
        byFingerprint.set(fingerprint, {
            fingerprint,
            germanRequired: Boolean(doc.GermanRequired),
            confidence: doc.ConfidenceScore ?? 1,
            domain: doc.Domain || 'Unclear',
            subDomain: doc.SubDomain || 'Other',
            createdAt: doc.createdAt || new Date(),
        });
    }

    const entries = [...byFingerprint.values()];

    if (DRY_RUN) {
        console.log(`[Migration] Step 1 (dry run): would upsert ${entries.length} entries from ${legacy.length} legacy docs`);
        return { scanned: legacy.length, upserted: 0 };
    }

    // $setOnInsert only — never clobber an entry the live scraper already owns.
    let upserted = 0;
    for (const group of chunk(entries, BATCH)) {
        const res = await db.collection(CACHE).bulkWrite(
            group.map(entry => ({
                updateOne: {
                    filter: { fingerprint: entry.fingerprint },
                    update: { $setOnInsert: entry },
                    upsert: true,
                },
            })),
            { ordered: false },
        );
        upserted += res.upsertedCount || 0;
    }

    console.log(`[Migration] Step 1: Generated fingerprints for ${legacy.length} legacy docs, upserted ${upserted} new entries to ${CACHE}`);
    return { scanned: legacy.length, upserted };
}

// ─── Step 2 ────────────────────────────────────────────────────────────────────
//
// The review queue renders the AI's reasoning from Evidence, which today lives
// only on the test log. Copy it onto the job itself so the screen keeps working
// after the drop. Only jobs an admin can still act on need it.
async function step2BackfillEvidence(db) {
    const needing = await db.collection(JOBS).find(
        {
            Status: { $in: ['pending_review', 'active'] },
            Evidence: { $exists: false },
        },
        { projection: { JobID: 1, sourceSite: 1 } },
    ).toArray();

    if (needing.length === 0) {
        console.log('[Migration] Step 2: every reviewable job already has Evidence — nothing to do');
        return { candidates: 0, updated: 0 };
    }

    // One query per site rather than per job: pull every relevant log doc in
    // bulk and match in memory on the same (JobID, sourceSite) pair the logs
    // were keyed by.
    const evidenceByKey = new Map();
    for (const group of chunk(needing, BATCH)) {
        const logs = await db.collection(LOGS).find(
            { JobID: { $in: group.map(j => j.JobID) } },
            { projection: { JobID: 1, sourceSite: 1, Evidence: 1 } },
        ).toArray();
        for (const log of logs) {
            if (!log.Evidence) continue;
            evidenceByKey.set(`${log.JobID}|${log.sourceSite}`, log.Evidence);
        }
    }

    const updates = [];
    for (const job of needing) {
        const evidence = evidenceByKey.get(`${job.JobID}|${job.sourceSite}`);
        if (!evidence) continue; // no log, or the log had no Evidence
        updates.push({
            updateOne: {
                filter: { _id: job._id },
                update: { $set: { Evidence: evidence } },
            },
        });
    }

    if (DRY_RUN) {
        console.log(`[Migration] Step 2 (dry run): would set Evidence on ${updates.length} of ${needing.length} candidate jobs`);
        return { candidates: needing.length, updated: 0 };
    }

    let updated = 0;
    for (const group of chunk(updates, BATCH)) {
        const res = await db.collection(JOBS).bulkWrite(group, { ordered: false });
        updated += res.modifiedCount || 0;
    }

    console.log(`[Migration] Step 2: Backfilled Evidence on ${updated} job documents`);
    if (updated < needing.length) {
        console.log(`[Migration]   (${needing.length - updated} of ${needing.length} candidates had no matching log Evidence — left as-is)`);
    }
    return { candidates: needing.length, updated };
}

// ─── Coverage check ────────────────────────────────────────────────────────────
//
// The drop is irreversible and jobTestLogs is the only copy. Refuse it unless
// every fingerprint the logs know about is already in the cache — otherwise a
// half-finished backfill would silently cost verdicts we can never rebuild.
async function verifyCoverage(db) {
    const logFingerprints = await db.collection(LOGS).distinct('fingerprint', { fingerprint: { $ne: null } });
    const cacheCount = await db.collection(CACHE).countDocuments();

    const missing = [];
    for (const group of chunk(logFingerprints, 1000)) {
        const present = await db.collection(CACHE).distinct('fingerprint', { fingerprint: { $in: group } });
        const presentSet = new Set(present);
        for (const fp of group) if (!presentSet.has(fp)) missing.push(fp);
    }

    console.log(`[Migration] Coverage: ${logFingerprints.length} distinct fingerprints in ${LOGS}, ${cacheCount} entries in ${CACHE}`);
    if (missing.length > 0) {
        console.error(`[Migration] ❌ ${missing.length} fingerprints are NOT in ${CACHE} — e.g. ${missing.slice(0, 3).join(', ')}`);
        return false;
    }
    console.log('[Migration] ✅ Every log fingerprint is present in the cache');
    return true;
}

// ─── Step 3 ────────────────────────────────────────────────────────────────────
async function step3DropLogs(db, stats) {
    if (SKIP_DROP) {
        console.log(`[Migration] Step 3: skipped (--skip-drop). ${LOGS} left in place.`);
        return false;
    }
    if (DRY_RUN) {
        console.log(`[Migration] Step 3 (dry run): would drop ${LOGS} (${mb(stats.size)}MB, ${stats.count} docs)`);
        return false;
    }

    await db.collection(LOGS).drop();
    console.log(`[Migration] Step 3: Dropped ${LOGS} collection (was ${mb(stats.size)}MB, ${stats.count} docs)`);
    return true;
}

async function run() {
    console.log('🚀 Finalizing the AI cache migration...');
    if (DRY_RUN) console.log('   (DRY RUN — no writes, nothing dropped)\n');
    else if (SKIP_DROP) console.log('   (--skip-drop — steps 1 and 2 only)\n');
    else console.log('');

    if (!MONGO_URI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();

    try {
        const db = client.db(DB_NAME);

        const collections = (await db.listCollections().toArray()).map(c => c.name);
        if (!collections.includes(LOGS)) {
            console.log(`[Migration] ${LOGS} does not exist — already finalized. Nothing to do.`);
            const count = await db.collection(CACHE).countDocuments();
            const st = await db.command({ collStats: CACHE });
            console.log(`[Migration] Complete. ${CACHE}: ${count} fingerprints, ${mb(st.size)}MB. ${LOGS}: gone.`);
            return;
        }

        // Captured before the drop — collStats is gone once the collection is.
        const logStats = await db.command({ collStats: LOGS });
        console.log(`[Migration] ${LOGS}: ${logStats.count} docs, ${mb(logStats.size)}MB`);
        console.log(`[Migration] ${CACHE}: ${await db.collection(CACHE).countDocuments()} entries\n`);

        await step1GenerateMissingFingerprints(db);
        await step2BackfillEvidence(db);

        console.log('');
        const safe = await verifyCoverage(db);
        if (!safe) {
            // Steps 1 and 2 have already committed; only the drop is withheld.
            throw new Error(`Coverage check failed — refusing to drop ${LOGS}. Re-run backfill-ai-result-cache.js first.`);
        }

        console.log('');
        const dropped = await step3DropLogs(db, logStats);

        const finalCount = await db.collection(CACHE).countDocuments();
        const finalStats = await db.command({ collStats: CACHE });
        console.log(
            `\n[Migration] Complete. ${CACHE}: ${finalCount} fingerprints, ${mb(finalStats.size)}MB. ` +
            `${LOGS}: ${dropped ? 'gone' : 'still present'}.`
        );
    } finally {
        await client.close();
    }
}

run()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('\n❌ Migration failed:', error.message);
        console.error(`   ${LOGS} was NOT dropped.`);
        process.exit(1);
    });
