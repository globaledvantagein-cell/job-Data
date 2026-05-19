/**
 * One-off migration to clean up the `users` collection after switching
 * from the old (domain + desiredDomains + desiredRoles + sentJobIds)
 * subscription model to the new desiredCategories model.
 *
 * What this does:
 *   1. Backfills desiredCategories for existing subscribers based on the
 *      old `domain` field (Tech / Non-Tech). Skips anyone who already has
 *      a non-empty desiredCategories array (their explicit choice wins).
 *   2. Removes the dead fields from every user document:
 *        - domain
 *        - desiredRoles
 *        - desiredDomains
 *        - sentJobIds
 *
 * Run once with:   node src/migrations/cleanup-user-fields.js
 * Safe to re-run (idempotent). Safe to delete this file once executed
 * against your production DB.
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'job-scraper';

const TECH_CATEGORIES = ['software', 'data', 'product_tech', 'other_tech'];
const NONTECH_CATEGORIES = ['product_nontech', 'other_nontech'];

async function run() {
    console.log('🚀 Starting user-fields cleanup migration...\n');

    if (!MONGO_URI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const usersCollection = db.collection('users');

    // ── Step 1: Backfill desiredCategories from legacy `domain` field ─────
    console.log('--- Step 1: Backfill desiredCategories from old `domain` field ---');

    // Tech users whose desiredCategories is missing or empty
    const techBackfill = await usersCollection.updateMany(
        {
            domain: 'Tech',
            $or: [
                { desiredCategories: { $exists: false } },
                { desiredCategories: { $size: 0 } },
            ],
        },
        { $set: { desiredCategories: TECH_CATEGORIES, updatedAt: new Date() } },
    );
    console.log(`✅ Backfilled ${techBackfill.modifiedCount} Tech subscribers with all 4 tech categories`);

    // Non-Tech users whose desiredCategories is missing or empty
    const nonTechBackfill = await usersCollection.updateMany(
        {
            domain: 'Non-Tech',
            $or: [
                { desiredCategories: { $exists: false } },
                { desiredCategories: { $size: 0 } },
            ],
        },
        { $set: { desiredCategories: NONTECH_CATEGORIES, updatedAt: new Date() } },
    );
    console.log(`✅ Backfilled ${nonTechBackfill.modifiedCount} Non-Tech subscribers with both non-tech categories\n`);

    // ── Step 2: Ensure desiredCategories exists on EVERY user (as []) ─────
    // Google-only users who never subscribed will end up with [] which is
    // the correct default. Safe no-op for anyone who already has the field.
    console.log('--- Step 2: Initialize desiredCategories: [] on remaining users ---');
    const initResult = await usersCollection.updateMany(
        { desiredCategories: { $exists: false } },
        { $set: { desiredCategories: [] } },
    );
    console.log(`✅ Initialized desiredCategories on ${initResult.modifiedCount} users\n`);

    // ── Step 3: Remove the dead legacy fields from EVERY user ─────────────
    console.log('--- Step 3: Remove legacy fields (domain, desiredRoles, desiredDomains, sentJobIds) ---');
    const unsetResult = await usersCollection.updateMany(
        {
            $or: [
                { domain: { $exists: true } },
                { desiredRoles: { $exists: true } },
                { desiredDomains: { $exists: true } },
                { sentJobIds: { $exists: true } },
            ],
        },
        {
            $unset: {
                domain: '',
                desiredRoles: '',
                desiredDomains: '',
                sentJobIds: '',
            },
        },
    );
    console.log(`✅ Removed dead fields from ${unsetResult.modifiedCount} user documents\n`);

    // ── Summary ────────────────────────────────────────────────────────────
    const totalUsers = await usersCollection.countDocuments({});
    const subscribed = await usersCollection.countDocuments({ isSubscribed: true });

    console.log('========================================');
    console.log('🎉 Migration complete!');
    console.log('========================================');
    console.log(`Total users in DB:           ${totalUsers}`);
    console.log(`Currently subscribed:        ${subscribed}`);
    console.log(`Tech backfill:               ${techBackfill.modifiedCount}`);
    console.log(`Non-Tech backfill:           ${nonTechBackfill.modifiedCount}`);
    console.log(`Empty array initialized:     ${initResult.modifiedCount}`);
    console.log(`Legacy fields removed:       ${unsetResult.modifiedCount}`);
    console.log('========================================\n');
    console.log('✅ Safe to delete this file now.');

    await client.close();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
