/**
 * Quick digest test script.
 *
 * Sends a real weekly digest to ONE specific email. Useful for previewing
 * the template, debugging job matching, or sanity-checking before the
 * weekly cron fires.
 *
 * Usage:
 *   node src/scripts/test-digest.js your-email@gmail.com
 *   node src/scripts/test-digest.js your-email@gmail.com --dry-run
 *   node src/scripts/test-digest.js your-email@gmail.com --days=30
 *
 * The target email must:
 *   - Have a user document with isSubscribed: true
 *   - Have a non-empty desiredCategories array
 *
 * In SES sandbox mode, the email must also be verified in SES Identities.
 */
import { runWeeklyDigest } from '../cron/runWeeklyDigest.js';
import { client as mongoClient } from '../db/connection.js';

const email = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const daysArg = process.argv.find(a => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice('--days='.length)) : 7;

if (!email) {
    console.error('Usage: node src/scripts/test-digest.js your-email@gmail.com [--dry-run] [--days=N]');
    process.exit(1);
}

runWeeklyDigest({ user: email, dryRun, days })
    .then(() => mongoClient.close())
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal:', err);
        mongoClient.close().finally(() => process.exit(1));
    });
