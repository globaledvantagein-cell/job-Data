/**
 * Create (or verify) the shared beta promo code for the premium fake-door
 * test. Idempotent — running twice will not create a duplicate.
 *
 * Usage:
 *   node src/scripts/create-beta-promo.js
 *   node src/scripts/create-beta-promo.js --expires=2026-12-31
 *
 * The code is 100% off, unlimited total uses (per-user single redemption is
 * enforced in premium.routes.js via subscription history).
 */
import { connectToDb, client as mongoClient } from '../db/connection.js';
import { createPromoCode } from '../db/promoCodeQueries.js';
import { BETA_PROMO_CODE } from '../env.js';

const expiresArg = process.argv.find(a => a.startsWith('--expires='));
const expiresAt = expiresArg ? new Date(expiresArg.slice('--expires='.length)) : null;

async function main() {
    const db = await connectToDb();
    const existing = await db.collection('promoCodes').findOne({ code: BETA_PROMO_CODE });

    if (existing) {
        console.log(`✅ Promo code ${BETA_PROMO_CODE} already exists:`);
        console.log(`   discount: ${existing.discountPercent}% · used: ${existing.usedCount} · expires: ${existing.expiresAt || 'never'}`);
        return;
    }

    const doc = await createPromoCode(BETA_PROMO_CODE, 100, null, expiresAt);
    console.log(`✅ Created promo code ${doc.code} (100% off, unlimited uses, expires: ${doc.expiresAt || 'never'})`);
}

main()
    .then(() => mongoClient.close())
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal:', err);
        mongoClient.close().finally(() => process.exit(1));
    });
