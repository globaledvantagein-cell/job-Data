import { connectToDb } from '../../db/connection.js';
import { renderWeeklyDigest } from '../../email/index.js';

/**
 * Persist a digest run summary to MongoDB for observability.
 * Collection: digestRuns. One doc per run. TTL index recommended (90 days).
 */
export async function logDigestRun(summary) {
    try {
        const db = await connectToDb();
        await db.collection('digestRuns').insertOne({
            ...summary,
            ranAt: new Date(),
        });
    } catch (err) {
        // Logging should never crash the digest
        console.error('[digest] Warning: failed to write run log:', err.message);
    }
}

/**
 * Parse CLI flags for the digest runner.
 * Supports: --dry-run, --user=<email>, --days=<n>.
 */
export function parseArgs() {
    const args = process.argv.slice(2);
    const flags = { dryRun: false, user: null, days: 7 };
    for (const a of args) {
        if (a === '--dry-run') flags.dryRun = true;
        else if (a.startsWith('--user=')) flags.user = a.slice('--user='.length);
        else if (a.startsWith('--days=')) flags.days = Number(a.slice('--days='.length)) || 7;
    }
    return flags;
}

/**
 * Build the per-user message list. Pure function — easy to unit test later.
 */
export function buildDigestMessages(users, jobsByCategory) {
    const messages = [];

    for (const user of users) {
        const cats = Array.isArray(user.desiredCategories) ? user.desiredCategories : [];
        if (cats.length === 0) continue;

        const userJobs = {};
        let total = 0;
        for (const cat of cats) {
            const jobs = jobsByCategory[cat] || [];
            if (jobs.length > 0) {
                userJobs[cat] = jobs;
                total += jobs.length;
            }
        }

        if (total === 0) continue;

        const { subject, html, text, unsubscribeUrl } = renderWeeklyDigest({
            user,
            jobsByCategory: userJobs,
            totalJobs: total,
        });

        messages.push({
            msg: { to: user.email, subject, html, text, unsubscribeUrl, meta: { userId: user._id?.toString() } },
            user,
            totalJobs: total,
        });
    }

    return messages;
}
