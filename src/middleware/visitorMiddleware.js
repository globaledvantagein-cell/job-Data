import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { connectToDb } from '../db/connection.js';
import { FREE_VIEW_LIMIT, NEW_VISITOR_RATE_LIMIT_PER_HOUR, VISITOR_IP_SALT } from '../env.js';

// ─── Identity hashing ────────────────────────────────────────────────────
// We never store raw IPs. Salt + sha256 + truncate is enough for matching
// while staying compliant with privacy expectations.
function hashIp(ip) {
    if (!ip) return null;
    return crypto
        .createHash('sha256')
        .update(`${ip}|${VISITOR_IP_SALT || 'fallback-salt-change-me'}`)
        .digest('hex')
        .substring(0, 24);
}

function extractIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (Array.isArray(forwarded)) return forwarded[0];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || null;
}

function extractFingerprint(req) {
    const fp = req.headers['x-fingerprint'];
    if (typeof fp !== 'string' || fp.length < 8 || fp.length > 128) return null;
    return fp;
}

function extractCookieVid(req) {
    // Read from cookie-parser if available, else parse manually
    if (req.cookies?.vid) return req.cookies.vid;
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)vid=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

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
//
// Composite identity check. A visitor matches an existing record if ANY
// 2-of-3 signals (vid cookie, ipHash, fingerprint) match. Bypassing
// requires changing 2 signals at once — clearing cookies alone, switching
// browsers alone, or VPN alone all fail.
//
// Falls back to single-cookie match if nothing scores 2+.
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
async function resolveVisitor(req) {
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

// ─── Gate decision ───────────────────────────────────────────────────────
//
// Returns true if this visitor should be GATED for this job.
// Idempotent: re-viewing a job already in jobsViewedSet does NOT consume
// a view and never gates.
//
// Priority:
//   1. No visitor record → gate (safe default)
//   2. linkedUserId present → never gate (signed up)
//   3. isFlagged → gate immediately (rate-limit bypass attempt)
//   4. Job already viewed → never gate (idempotent)
//   5. viewCount >= FREE_VIEW_LIMIT → gate
export function shouldGate(visitor, jobIdString) {
    if (!visitor) return true;
    if (visitor.linkedUserId) return false;
    if (visitor.isFlagged) return true;

    const alreadyViewed = (visitor.jobsViewedSet || []).some(id => id === jobIdString);
    if (alreadyViewed) return false;

    return (visitor.viewCount || 0) >= FREE_VIEW_LIMIT;
}

// ─── Record a successful (non-gated) view ────────────────────────────────
//
// Idempotent — uses an aggregation pipeline to add to set only if missing.
// viewCount is denormalized off jobsViewedSet.length for cheap gate checks.
export async function recordJobView(visitorId, jobIdString) {
    if (!visitorId || !jobIdString) return;
    const db = await connectToDb();
    const _id = visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId);

    await db.collection('visitors').updateOne({ _id }, [
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
            $set: { viewCount: { $size: '$jobsViewedSet' } }
        }
    ]);
}

// ─── Link a visitor to a user (called after successful auth) ─────────────
export async function linkVisitorToUser(visitorId, userId) {
    if (!visitorId || !userId) return;
    const db = await connectToDb();
    await db.collection('visitors').updateOne(
        { _id: visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId) },
        { $set: { linkedUserId: userId instanceof ObjectId ? userId : new ObjectId(userId) } }
    );
}

// ─── Express middleware: lazy req.resolveVisitor() ───────────────────────
//
// We don't resolve eagerly because most requests (list, health check, etc.)
// don't need the visitor record. Only routes that gate content actually
// call `await req.resolveVisitor()`.
export function attachVisitor(req, res, next) {
    let cached = null;
    req.resolveVisitor = async () => {
        if (cached) return cached;
        cached = await resolveVisitor(req);
        return cached;
    };
    next();
}