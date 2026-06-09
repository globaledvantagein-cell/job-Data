import { ObjectId } from 'mongodb';
import { connectToDb } from '../../db/connection.js';
import { FREE_VIEW_LIMIT } from '../../env.js';

/**
 * Returns true if this visitor should be GATED for this job.
 *
 * Priority (first match wins):
 *   1. No visitor record → gate (safe default)
 *   2. linkedUserId present → never gate (signed up)
 *   3. isFlagged → gate immediately (rate-limit bypass attempt)
 *   4. Job already viewed → never gate (idempotent)
 *   5. viewCount >= FREE_VIEW_LIMIT → gate
 */
export function shouldGate(visitor, jobIdString) {
    if (!visitor) return true;
    if (visitor.linkedUserId) return false;
    if (visitor.isFlagged) return true;

    const alreadyViewed = (visitor.jobsViewedSet || []).some(id => id === jobIdString);
    if (alreadyViewed) return false;

    return (visitor.viewCount || 0) >= FREE_VIEW_LIMIT;
}

/**
 * Record a successful (non-gated) view.
 * Idempotent — uses an aggregation pipeline to add to set only if missing.
 * viewCount is denormalized off jobsViewedSet.length for cheap gate checks.
 */
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

/**
 * Link a visitor record to a user (called after successful authentication).
 * Once linked, shouldGate() always returns false for that visitor.
 */
export async function linkVisitorToUser(visitorId, userId) {
    if (!visitorId || !userId) return;
    const db = await connectToDb();
    await db.collection('visitors').updateOne(
        { _id: visitorId instanceof ObjectId ? visitorId : new ObjectId(visitorId) },
        { $set: { linkedUserId: userId instanceof ObjectId ? userId : new ObjectId(userId) } }
    );
}
