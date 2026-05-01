import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { connectToDb } from './connection.js';
import {
    FREE_VIEW_LIMIT,
    NEW_VISITOR_RATE_LIMIT_PER_HOUR,
    VISITOR_IP_SALT,
} from '../env.js';

// ── Hashing ───────────────────────────────────────────────────────────────
// We never store raw IPs. Salt + sha256 + truncate to 16 chars is enough
// for fingerprint-style matching while staying compliant.
export function hashIp(rawIp) {
    if (!rawIp) return null;
    return crypto
        .createHash('sha256')
        .update(rawIp + (VISITOR_IP_SALT || 'fallback-salt-change-me'))
        .digest('hex')
        .substring(0, 16);
}

// ── Index setup (idempotent) ──────────────────────────────────────────────
let indexesCreated = false;
async function ensureIndexes() {
    if (indexesCreated) return;
    const db = await connectToDb();

    await db.collection('visitors').createIndex({ vid: 1 }, { sparse: true }).catch(() => {});
    await db.collection('visitors').createIndex({ fingerprint: 1, ipHash: 1 }, { sparse: true }).catch(() => {});
    await db.collection('visitors').createIndex({ linkedUserId: 1 }, { sparse: true }).catch(() => {});

    // TTL: auto-delete visitor_creation_log entries after 1 hour
    await db.collection('visitor_creation_log').createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 3600 }
    ).catch(() => {});
    await db.collection('visitor_creation_log').createIndex({ ipHash: 1 }).catch(() => {});

    indexesCreated = true;
}

// ── Identity resolution ───────────────────────────────────────────────────
// Strategy: a visitor matches if ANY of these are true
//   1. vid cookie matches (simple case)
//   2. fingerprint + ipHash both match (cookie was cleared but device same)
// IP alone is NOT a match — too many people share IPs (corporate/Wi-Fi).
async function findExistingVisitor(db, { vid, fingerprint, ipHash }) {
    const conditions = [];
    if (vid) conditions.push({ vid });
    if (fingerprint && ipHash) conditions.push({ fingerprint, ipHash });
    if (conditions.length === 0) return null;

    return await db.collection('visitors').findOne({ $or: conditions });
}

// ── Rate-limit check ──────────────────────────────────────────────────────
// If this IP has spawned > NEW_VISITOR_RATE_LIMIT_PER_HOUR fresh visitors
// in the last hour, flag the new one. Flagged visitors get gated immediately.
async function checkRateLimit(db, ipHash) {
    if (!ipHash) return false;
    const count = await db.collection('visitor_creation_log').countDocuments({ ipHash });
    return count >= NEW_VISITOR_RATE_LIMIT_PER_HOUR;
}

// ── Main entry: get or create the visitor for this request ────────────────
export async function resolveVisitor({ vid, fingerprint, ip }) {
    await ensureIndexes();
    const db = await connectToDb();
    const ipHash = hashIp(ip);

    // 1. Try to find existing
    const existing = await findExistingVisitor(db, { vid, fingerprint, ipHash });
    if (existing) {
        // Update lastSeenAt + opportunistically backfill missing identity bits
        const update = { $set: { lastSeenAt: new Date() } };
        if (vid && !existing.vid) update.$set.vid = vid;
        if (fingerprint && !existing.fingerprint) update.$set.fingerprint = fingerprint;
        if (ipHash && !existing.ipHash) update.$set.ipHash = ipHash;
        await db.collection('visitors').updateOne({ _id: existing._id }, update);
        return { ...existing, ...update.$set };
    }

    // 2. Brand new visitor — check rate limit before creating
    const isFlagged = await checkRateLimit(db, ipHash);

    const newVisitor = {
        vid: vid || null,
        fingerprint: fingerprint || null,
        ipHash: ipHash || null,
        jobsViewedSet: [],
        viewCount: 0,
        isFlagged,
        linkedUserId: null,
        createdAt: new Date(),
        lastSeenAt: new Date(),
    };

    const result = await db.collection('visitors').insertOne(newVisitor);
    newVisitor._id = result.insertedId;

    // Log the creation event for rate-limit window
    if (ipHash) {
        await db.collection('visitor_creation_log').insertOne({
            ipHash,
            createdAt: new Date(),
        });
    }

    if (isFlagged) {
        console.warn(`[Gate] 🚩 Flagged visitor created — IP hash ${ipHash} hit rate limit`);
    }

    return newVisitor;
}

// ── Gate decision ─────────────────────────────────────────────────────────
// Returns true if this visitor should be gated for this job.
// Idempotent: viewing the SAME job again does not consume a view.
export function shouldGate(visitor, jobIdString) {
    if (!visitor) return true; // safe default
    if (visitor.linkedUserId) return false; // logged in → never gated
    if (visitor.isFlagged) return true; // rate-limited → instant gate

    // Already viewed this job → free, no count consumed
    const alreadyViewed = (visitor.jobsViewedSet || []).some(id => id === jobIdString);
    if (alreadyViewed) return false;

    // New job view → check if under limit
    return (visitor.viewCount || 0) >= FREE_VIEW_LIMIT;
}

// ── Record a successful (non-gated) view ──────────────────────────────────
// Idempotent — uses $addToSet so re-viewing doesn't double-count.
// viewCount is denormalized off jobsViewedSet.length for cheap gate checks.
export async function recordJobView(visitorId, jobIdString) {
    if (!visitorId || !jobIdString) return;
    const db = await connectToDb();

    await db.collection('visitors').updateOne(
        { _id: visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId) },
        [
            {
                $set: {
                    jobsViewedSet: {
                        $cond: [
                            { $in: [jobIdString, { $ifNull: ['$jobsViewedSet', []] }] },
                            '$jobsViewedSet',
                            { $concatArrays: [{ $ifNull: ['$jobsViewedSet', []] }, [jobIdString]] }
                        ]
                    },
                    lastSeenAt: new Date(),
                }
            },
            {
                $set: {
                    viewCount: { $size: '$jobsViewedSet' }
                }
            }
        ]
    );
}

// ── Link a visitor record to a user after signup/login ────────────────────
// Called after a successful auth so we know which anon was which user.
export async function linkVisitorToUser(visitorId, userId) {
    if (!visitorId || !userId) return;
    const db = await connectToDb();
    await db.collection('visitors').updateOne(
        { _id: visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId) },
        { $set: { linkedUserId: userId instanceof ObjectId ? userId : new ObjectId(userId) } }
    );
}
