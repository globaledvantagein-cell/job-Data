/**
 * Weekly digest runner.
 *
 * One job, runs Monday 8am UTC. For every subscribed user, builds a
 * personalized digest from the past week's jobs in their chosen categories
 * and sends it.
 *
 * Flow:
 *   1. Fetch all subscribed users (one DB query)
 *   2. Fetch all active jobs from last 7 days, grouped by category (one DB query)
 *   3. Per-user in-memory filter + render
 *   4. Bulk-send with rate limiting
 *   5. Update lastEmailSent on successful recipients
 *   6. Log structured summary
 *
 * CLI flags (for testing):
 *   --dry-run               Don't send. Just log what would happen.
 *   --user=<email>          Send only to this single user.
 *   --days=<n>              Look-back window (default 7).
 *
 * Usage:
 *   node src/cron/runWeeklyDigest.js
 *   node src/cron/runWeeklyDigest.js --dry-run
 *   node src/cron/runWeeklyDigest.js --user=someone@example.com --dry-run
 */
import { getSubscribedUsers, updateLastEmailSent, getDigestJobs } from '../db/index.js';
import { sendBulkEmails } from '../email/index.js';
import { client as mongoClient } from '../db/connection.js';
import {
    logDigestRun,
    parseArgs,
    buildDigestMessages,
} from './weeklyDigest/helpers.js';

// Re-export so existing imports of buildDigestMessages from this file keep working.
export { buildDigestMessages } from './weeklyDigest/helpers.js';

export async function runWeeklyDigest(opts = {}) {
    const startTime = Date.now();
    const { dryRun = false, user: targetEmail = null, days = 7 } = opts;

    console.log('═══════════════════════════════════════════════════════');
    console.log('Weekly Digest Run');
    console.log(`  Mode:      ${dryRun ? 'DRY RUN (no emails sent)' : 'LIVE'}`);
    console.log(`  Look-back: ${days} days`);
    if (targetEmail) console.log(`  Target:    single user = ${targetEmail}`);
    console.log('═══════════════════════════════════════════════════════\n');

    // 1. Fetch subscribers
    let users = await getSubscribedUsers();
    if (targetEmail) {
        users = users.filter(u => u.email === targetEmail);
        if (users.length === 0) {
            console.log(`[digest] No subscribed user found with email ${targetEmail}`);
            console.log(`         (Is isSubscribed: true on their user doc?)`);
            return { sent: 0, skipped: 0, failed: 0 };
        }
    }

    // ENV-based whitelist: DIGEST_WHITELIST=email1,email2 limits sends during testing.
    const whitelist = process.env.DIGEST_WHITELIST;
    if (whitelist && !targetEmail) {
        const allowed = whitelist.split(',').map(e => e.trim().toLowerCase());
        const before = users.length;
        users = users.filter(u => allowed.includes(u.email.toLowerCase()));
        console.log(`[digest] Whitelist active: ${allowed.join(', ')}`);
        console.log(`[digest] Filtered ${before} → ${users.length} user(s)`);
    }

    console.log(`[digest] Loaded ${users.length} subscribed user(s)`);

    // 2. Fetch jobs
    const { byCategory: jobsByCategory, total: totalJobs } = await getDigestJobs(days);
    const catSummary = Object.entries(jobsByCategory)
        .map(([cat, arr]) => `${cat}=${arr.length}`)
        .join(', ');
    console.log(`[digest] Loaded ${totalJobs} active job(s) from last ${days} days`);
    console.log(`[digest]   By category: ${catSummary || '(empty)'}\n`);

    if (totalJobs === 0) {
        console.log('[digest] No jobs to send. Exiting.');
        const summary = {
            mode: dryRun ? 'dry-run' : 'live',
            subscribersLoaded: users.length, jobsAvailable: 0,
            sent: 0, skipped: users.length, failed: 0,
            duration: '0s', lookBackDays: days,
        };
        if (!dryRun) await logDigestRun(summary);
        return summary;
    }

    // 3. Build per-user messages
    const messages = buildDigestMessages(users, jobsByCategory);
    const skippedNoMatch = users.length - messages.length;
    console.log(`[digest] Built ${messages.length} message(s); ${skippedNoMatch} user(s) skipped (no matching jobs)\n`);

    if (messages.length === 0) {
        console.log('[digest] Nothing to send. Exiting.');
        const summary = {
            mode: dryRun ? 'dry-run' : 'live',
            subscribersLoaded: users.length, jobsAvailable: totalJobs,
            sent: 0, skipped: users.length, failed: 0,
            duration: '0s', lookBackDays: days,
        };
        if (!dryRun) await logDigestRun(summary);
        return summary;
    }

    // 4. Send (or dry-run)
    if (dryRun) {
        console.log('[digest] DRY RUN — these messages WOULD be sent:\n');
        for (const { msg, user, totalJobs: t } of messages) {
            console.log(`  → ${user.email.padEnd(40)} | ${t} job(s) | "${msg.subject}"`);
        }
        console.log(`\n[digest] DRY RUN complete. No emails sent.\n`);
        return { sent: 0, skipped: skippedNoMatch, failed: 0, dryRun: true };
    }

    console.log(`[digest] Sending ${messages.length} email(s)...\n`);
    const results = await sendBulkEmails(
        messages.map(m => m.msg),
        { onProgress: (sent, total) => console.log(`  ...sent ${sent}/${total}`) },
    );

    // 5. Tally + update lastEmailSent
    const successful = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    if (successful.length > 0) {
        const successfulEmails = successful.map(r => r.to);
        await updateLastEmailSent(successfulEmails);
    }

    // 6. Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('Summary');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Subscribers loaded:        ${users.length}`);
    console.log(`  Skipped (no matching job): ${skippedNoMatch}`);
    console.log(`  Sent successfully:         ${successful.length}`);
    console.log(`  Failed:                    ${failed.length}`);
    console.log(`  Total time:                ${elapsed}s`);
    console.log('═══════════════════════════════════════════════════════');

    if (failed.length > 0) {
        console.log('\nFailed sends:');
        for (const f of failed) console.log(`  ${f.to}: ${f.error}`);
    }

    const summary = {
        mode: 'live',
        subscribersLoaded: users.length,
        jobsAvailable: totalJobs,
        sent: successful.length,
        skipped: skippedNoMatch,
        failed: failed.length,
        failedEmails: failed.map(f => ({ email: f.to, error: f.error })),
        duration: elapsed,
        lookBackDays: days,
    };
    await logDigestRun(summary);

    return summary;
}

// ─── Allow running directly: `node src/cron/runWeeklyDigest.js` ──────────
// On Windows, process.argv[1] uses backslashes but import.meta.url uses
// forward slashes, so a simple === check fails. Normalize both.
const thisFile = new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
const entryFile = process.argv[1]?.replace(/\\/g, '/');
const isCli = thisFile === entryFile || thisFile === '/' + entryFile;

if (isCli) {
    const flags = parseArgs();
    runWeeklyDigest(flags)
        .then(() => mongoClient.close())
        .then(() => process.exit(0))
        .catch(err => {
            console.error('[digest] Fatal error:', err);
            mongoClient.close().finally(() => process.exit(1));
        });
}
