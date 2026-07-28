/**
 * One-off campaign: send the premium early-access invite (with the beta
 * promo code) to EXISTING users. New users get the same block in their
 * welcome email automatically.
 *
 * Safe by default — DRY RUN unless --send is passed.
 *
 * Usage:
 *   node src/scripts/send-premium-invite.js                  # dry run: list recipients
 *   node src/scripts/send-premium-invite.js --to=me@x.com    # send ONE test email
 *   node src/scripts/send-premium-invite.js --send           # send to everyone eligible
 *
 * Skips:
 *   - users who are already premium (active premiumUntil)
 *   - users who already redeemed the beta code
 *   - users who were already sent this invite (premiumInviteSentAt set),
 *     so the script is safe to re-run after a partial failure
 */
import { connectToDb, client as mongoClient } from '../db/connection.js';
import { isPremium } from '../db/users/subscription.js';
import { renderPremiumInvite } from '../email/templates/premiumInvite.js';
import { sendBulkEmails } from '../email/sender.js';
import { BETA_PROMO_CODE } from '../env.js';

const doSend = process.argv.includes('--send');
const toArg = process.argv.find(a => a.startsWith('--to='));
const testEmail = toArg ? toArg.slice('--to='.length).toLowerCase() : null;

async function main() {
    const db = await connectToDb();

    // Users who already redeemed the beta code — no invite needed.
    const redeemedIds = new Set(
        (await db.collection('subscriptions')
            .find({ promoCode: BETA_PROMO_CODE }, { projection: { userId: 1 } })
            .toArray()
        ).map(s => String(s.userId)),
    );

    const query = testEmail ? { email: testEmail } : {};
    const users = await db.collection('users')
        .find(query, { projection: { email: 1, name: 1, isSubscribed: 1, premiumUntil: 1, premiumInviteSentAt: 1 } })
        .toArray();

    const eligible = users.filter(u =>
        u.email &&
        !isPremium(u) &&
        !redeemedIds.has(String(u._id)) &&
        (testEmail || !u.premiumInviteSentAt),
    );

    console.log(`Users total: ${users.length} · eligible: ${eligible.length} · already premium/redeemed/invited: ${users.length - eligible.length}`);

    if (!doSend && !testEmail) {
        console.log('\nDRY RUN — no emails sent. Recipients would be:');
        eligible.forEach(u => console.log(`  ${u.email} (${u.name || 'no name'})`));
        console.log('\nRe-run with --send to actually send, or --to=you@x.com for a single test.');
        return;
    }

    const messages = eligible.map(u => {
        const { subject, html, text } = renderPremiumInvite({
            name: u.name,
            email: u.email,
            promoCode: BETA_PROMO_CODE,
            isSubscribed: Boolean(u.isSubscribed),
        });
        return { to: u.email, subject, html, text, meta: { userId: u._id } };
    });

    const results = await sendBulkEmails(messages, {
        onProgress: (sent, total) => console.log(`  sent ${sent}/${total}`),
    });

    const okIds = results.filter(r => r.ok).map(r => r.meta.userId);
    const failed = results.filter(r => !r.ok);

    // Mark successful sends so a re-run only retries failures (skip in test mode).
    if (!testEmail && okIds.length > 0) {
        await db.collection('users').updateMany(
            { _id: { $in: okIds } },
            { $set: { premiumInviteSentAt: new Date() } },
        );
    }

    console.log(`\n✅ Sent: ${okIds.length} · ❌ Failed: ${failed.length}`);
    failed.forEach(f => console.log(`  FAILED ${f.to}: ${f.error}`));
}

main()
    .then(() => mongoClient.close())
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal:', err);
        mongoClient.close().finally(() => process.exit(1));
    });
