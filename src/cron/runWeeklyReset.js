/**
 * Weekly usage-counter reset.
 *
 * Runs every Monday 00:00 UTC (scheduled in server.js alongside the scraper,
 * validator and digest jobs). It:
 *   1. Zeroes jdViewsThisWeek + applyClicksThisWeek on every user and stamps
 *      weekResetAt = now (gives free users a fresh weekly allowance).
 *   2. Zeroes the anonymous-visitor view trackers (viewCount + jobsViewedSet)
 *      so the signup gate also resets weekly.
 *   3. Marks any subscriptions past their expiresAt as 'expired'.
 *   4. Logs a structured summary.
 *
 * Usage:
 *   node src/cron/runWeeklyReset.js
 */
import { connectToDb, client as mongoClient } from '../db/connection.js';
import { expireOldSubscriptions } from '../db/promoCodeQueries.js';

export async function runWeeklyReset() {
    const startTime = Date.now();
    console.log('--- Weekly Reset: zeroing usage counters ---');

    const db = await connectToDb();
    const now = new Date();

    // 1. Reset per-user weekly usage counters.
    const usersResult = await db.collection('users').updateMany(
        {},
        {
            $set: {
                jdViewsThisWeek: 0,
                applyClicksThisWeek: 0,
                weekResetAt: now,
                updatedAt: now,
            },
        },
    );

    // 2. Reset anonymous-visitor JD view trackers. The visitor schema tracks
    //    JD views via viewCount (denormalized) + jobsViewedSet; clearing both
    //    hands anonymous visitors a fresh weekly gate allowance.
    const visitorsResult = await db.collection('visitors').updateMany(
        {},
        {
            $set: {
                viewCount: 0,
                jobsViewedSet: [],
                lastSeenAt: now,
            },
        },
    );

    // 3. Expire subscriptions whose term has ended.
    const expiredCount = await expireOldSubscriptions();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = {
        usersReset: usersResult.modifiedCount || 0,
        visitorsReset: visitorsResult.modifiedCount || 0,
        subscriptionsExpired: expiredCount,
        duration: `${elapsed}s`,
    };

    console.log(
        `[weekly-reset] Reset ${summary.usersReset} user(s) and ${summary.visitorsReset} visitor(s); ` +
        `expired ${summary.subscriptionsExpired} subscription(s) in ${summary.duration}`,
    );

    return summary;
}

// ─── Allow running directly: `node src/cron/runWeeklyReset.js` ──────────────
// On Windows, process.argv[1] uses backslashes but import.meta.url uses forward
// slashes, so a simple === check fails. Normalize both (same as runWeeklyDigest).
const thisFile = new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
const entryFile = process.argv[1]?.replace(/\\/g, '/');
const isCli = thisFile === entryFile || thisFile === '/' + entryFile;

if (isCli) {
    runWeeklyReset()
        .then(() => mongoClient.close())
        .then(() => process.exit(0))
        .catch(err => {
            console.error('[weekly-reset] Fatal error:', err);
            mongoClient.close().finally(() => process.exit(1));
        });
}
