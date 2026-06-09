import { connectToDb } from '../../db/connection.js';
import { NEW_VISITOR_RATE_LIMIT_PER_HOUR } from '../../env.js';
import {
    hashIp,
    extractIp,
    extractFingerprint,
    extractCookieVid,
} from './identity.js';

// ─── Index setup (idempotent) ────────────────────────────────────────────
let indexesCreated = false;
async function ensureIndexes(db) {
    if (indexesCreated) return;
    await db.collection('visitors').createIndex({ vid: 1 }, { sparse: true }).catch(() => {});
    await db.collection('visitors').createIndex({ fingerprint: 1 }, { sparse: true }).catch(() => {});
    await db.collection('visitors').createIndex({ ipHash: 1 }, { sparse: true }).catch(() => {});
    await db.collection('visitors').createIndex({ linkedUserId: 1 }, { sparse: true }).catch(() => {});
    await db.collection('visitor_creation_log').createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 3600 }
    ).catch(() => {});
    await db.collection('visitor_creation_log').createIndex({ ipHash: 1 }).catch(() => {});
    indexesCreated = true;
}

// ─── Identity matching ───────────────────────────────────────────────────
// Composite identity check. Matches an existing record if ANY 2-of-3
// signals (vid cookie, ipHash, fingerprint) line up. Bypassing requires
// changing 2 signals at once. Falls back to cookie-only if nothing scores 2+.
async function findExistingVisitor(db, { vid, ipHash, fingerprint }) {
    const conditions = [];
    if (vid) conditions.push({ vid });
    if (ipHash) conditions.push({ ipHash });
    if (fingerprint) conditions.push({ fingerprint });
    if (conditions.length === 0) return null;

    const candidates = await db.collection('visitors')
        .find({ $or: conditions })
        .sort({ lastSeenAt: -1 })
        .limit(20)
        .toArray();

    for (const candidate of candidates) {
        let matches = 0;
        if (vid && candidate.vid === vid) matches += 1;
        if (ipHash && candidate.ipHash === ipHash) matches += 1;
        if (fingerprint && candidate.fingerprint === fingerprint) matches += 1;
        if (matches >= 2) return candidate;
    }

    // Fallback: cookie-only match (most reliable single signal)
    if (vid) {
        const byVid = candidates.find(c => c.vid === vid);
        if (byVid) return byVid;
    }
    return null;
}

// ─── Rate limit check ────────────────────────────────────────────────────
async function isRateLimited(db, ipHash) {
    if (!ipHash) return false;
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await db.collection('visitor_creation_log')
        .countDocuments({ ipHash, createdAt: { $gte: since } });
    return recentCount >= NEW_VISITOR_RATE_LIMIT_PER_HOUR;
}

// ─── Resolve (find or create) the visitor for this request ───────────────
export async function resolveVisitor(req) {
    const db = await connectToDb();
    await ensureIndexes(db);

    const vid = extractCookieVid(req);
    const fingerprint = extractFingerprint(req);
    const ipHash = hashIp(extractIp(req));

    // Try to find existing
    const existing = await findExistingVisitor(db, { vid, ipHash, fingerprint });
    if (existing) {
        // Backfill missing identity bits + bump lastSeenAt
        const set = { lastSeenAt: new Date() };
        if (vid && !existing.vid) set.vid = vid;
        if (fingerprint && !existing.fingerprint) set.fingerprint = fingerprint;
        if (ipHash && !existing.ipHash) set.ipHash = ipHash;
        await db.collection('visitors').updateOne({ _id: existing._id }, { $set: set });
        return { ...existing, ...set };
    }

    // Brand new — check rate limit before creating
    const flagged = await isRateLimited(db, ipHash);

    const newVisitor = {
        vid: vid || null,
        fingerprint: fingerprint || null,
        ipHash: ipHash || null,
        jobsViewedSet: [],
        viewCount: 0,
        isFlagged: flagged,
        linkedUserId: null,
        createdAt: new Date(),
        lastSeenAt: new Date(),
    };
    const result = await db.collection('visitors').insertOne(newVisitor);
    newVisitor._id = result.insertedId;

    if (ipHash) {
        await db.collection('visitor_creation_log').insertOne({
            ipHash,
            createdAt: new Date(),
        });
    }

    if (flagged) {
        console.warn(`[Gate] 🚩 Flagged visitor created — IP hash ${ipHash} hit rate limit`);
    }

    return newVisitor;
}
