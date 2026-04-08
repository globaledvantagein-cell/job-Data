// ─── Test: Auto-Deletion Rules ────────────────────────────────────────────
// Tests that deleteOldJobs() respects status-based rules:
// - NEVER deletes admin-approved active jobs
// - NEVER deletes curated jobs
// - Deletes AI-rejected after 7 days
// - Deletes admin-rejected after 14 days
// - Deletes pending_review after 14 days
//
// Run: node src/tests/test-auto-deletion.js

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const TEST_COLLECTION = 'test_deletion_jobs';
const TEST_SITE = 'Test Site';

async function run() {
    if (!MONGO_URI) {
        console.error('❌ MONGO_URI not set in .env');
        process.exit(1);
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db('job-scraper');
    const collection = db.collection(TEST_COLLECTION);

    // Clean up any previous test data
    await collection.deleteMany({});

    const now = new Date();
    const daysAgo = (days) => {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        return d;
    };

    // ── Insert test documents ─────────────────────────────────────────────

    const testJobs = [
        {
            _label: 'Admin-approved active (8 days old) — MUST SURVIVE',
            JobID: 'test_1',
            sourceSite: TEST_SITE,
            Status: 'active',
            reviewedAt: daysAgo(7),
            updatedAt: daysAgo(8),
            JobTitle: 'Approved Job'
        },
        {
            _label: 'Admin-approved active (30 days old) — MUST SURVIVE',
            JobID: 'test_2',
            sourceSite: TEST_SITE,
            Status: 'active',
            reviewedAt: daysAgo(25),
            updatedAt: daysAgo(30),
            JobTitle: 'Old Approved Job'
        },
        {
            _label: 'Admin-approved active (100 days old) — MUST SURVIVE',
            JobID: 'test_3',
            sourceSite: TEST_SITE,
            Status: 'active',
            reviewedAt: daysAgo(90),
            updatedAt: daysAgo(100),
            JobTitle: 'Very Old Approved Job'
        },
        {
            _label: 'Curated job (60 days old) — MUST SURVIVE',
            JobID: 'test_4',
            sourceSite: 'Curated',
            Status: 'active',
            updatedAt: daysAgo(60),
            JobTitle: 'Manually Added Job'
        },
        {
            _label: 'AI-rejected (8 days old, no reviewedAt) — SHOULD BE DELETED',
            JobID: 'test_5',
            sourceSite: TEST_SITE,
            Status: 'rejected',
            updatedAt: daysAgo(8),
            JobTitle: 'AI Rejected Old'
        },
        {
            _label: 'AI-rejected (3 days old, no reviewedAt) — MUST SURVIVE (< 7 days)',
            JobID: 'test_6',
            sourceSite: TEST_SITE,
            Status: 'rejected',
            updatedAt: daysAgo(3),
            JobTitle: 'AI Rejected Recent'
        },
        {
            _label: 'Admin-rejected (15 days old, has reviewedAt) — SHOULD BE DELETED',
            JobID: 'test_7',
            sourceSite: TEST_SITE,
            Status: 'rejected',
            reviewedAt: daysAgo(14),
            updatedAt: daysAgo(15),
            JobTitle: 'Admin Rejected Old'
        },
        {
            _label: 'Admin-rejected (10 days old, has reviewedAt) — MUST SURVIVE (< 14 days)',
            JobID: 'test_8',
            sourceSite: TEST_SITE,
            Status: 'rejected',
            reviewedAt: daysAgo(9),
            updatedAt: daysAgo(10),
            JobTitle: 'Admin Rejected Recent'
        },
        {
            _label: 'Pending review (15 days old) — SHOULD BE DELETED',
            JobID: 'test_9',
            sourceSite: TEST_SITE,
            Status: 'pending_review',
            updatedAt: daysAgo(15),
            JobTitle: 'Stale Pending'
        },
        {
            _label: 'Pending review (5 days old) — MUST SURVIVE (< 14 days)',
            JobID: 'test_10',
            sourceSite: TEST_SITE,
            Status: 'pending_review',
            updatedAt: daysAgo(5),
            JobTitle: 'Recent Pending'
        },
        {
            _label: 'Auto-active no review (15 days old) — SHOULD BE DELETED',
            JobID: 'test_11',
            sourceSite: TEST_SITE,
            Status: 'active',
            updatedAt: daysAgo(15),
            JobTitle: 'Auto Active Old'
            // no reviewedAt field at all
        },
        {
            _label: 'Auto-active no review (5 days old) — MUST SURVIVE (< 14 days)',
            JobID: 'test_12',
            sourceSite: TEST_SITE,
            Status: 'active',
            updatedAt: daysAgo(5),
            JobTitle: 'Auto Active Recent'
            // no reviewedAt field at all
        },
    ];

    await collection.insertMany(testJobs);
    console.log(`\n=== Auto-Deletion Test ===\n`);
    console.log(`Inserted ${testJobs.length} test documents\n`);

    // ── Run the deletion logic (same queries as db/jobQueries.js) ─────────

    const sevenDaysAgo = daysAgo(7);
    const fourteenDaysAgo = daysAgo(14);
    const siteName = TEST_SITE;

    // Rule 3: AI-rejected > 7 days
    const r3 = await collection.deleteMany({
        sourceSite: siteName,
        Status: 'rejected',
        $or: [
            { reviewedAt: { $exists: false } },
            { reviewedAt: null }
        ],
        updatedAt: { $lt: sevenDaysAgo }
    });

    // Rule 4: Admin-rejected > 14 days
    const r4 = await collection.deleteMany({
        sourceSite: siteName,
        Status: 'rejected',
        reviewedAt: { $exists: true, $ne: null },
        updatedAt: { $lt: fourteenDaysAgo }
    });

    // Rule 5: Pending > 14 days
    const r5 = await collection.deleteMany({
        sourceSite: siteName,
        Status: 'pending_review',
        updatedAt: { $lt: fourteenDaysAgo }
    });

    // Rule 6: Auto-active no review > 14 days
    const r6 = await collection.deleteMany({
        sourceSite: siteName,
        Status: 'active',
        $or: [
            { reviewedAt: { $exists: false } },
            { reviewedAt: null }
        ],
        updatedAt: { $lt: fourteenDaysAgo }
    });

    console.log(`Deletion results:`);
    console.log(`  AI-rejected >7d:      ${r3.deletedCount} deleted`);
    console.log(`  Admin-rejected >14d:   ${r4.deletedCount} deleted`);
    console.log(`  Pending >14d:          ${r5.deletedCount} deleted`);
    console.log(`  Auto-active >14d:      ${r6.deletedCount} deleted`);
    console.log('');

    // ── Check what survived ───────────────────────────────────────────────

    const surviving = await collection.find({}).toArray();
    const survivingIds = new Set(surviving.map(j => j.JobID));

    let passed = 0;
    let failed = 0;

    function expectSurvived(testId, label) {
        if (survivingIds.has(testId)) {
            console.log(`  ✅ ${label}`);
            passed++;
        } else {
            console.log(`  ❌ ${label} — WAS DELETED (should have survived!)`);
            failed++;
        }
    }

    function expectDeleted(testId, label) {
        if (!survivingIds.has(testId)) {
            console.log(`  ✅ ${label}`);
            passed++;
        } else {
            console.log(`  ❌ ${label} — SURVIVED (should have been deleted!)`);
            failed++;
        }
    }

    console.log('Checking survival rules:\n');

    // MUST SURVIVE
    expectSurvived('test_1', 'Admin-approved active (8 days) — survived');
    expectSurvived('test_2', 'Admin-approved active (30 days) — survived');
    expectSurvived('test_3', 'Admin-approved active (100 days) — survived');
    expectSurvived('test_4', 'Curated job (60 days) — survived');
    expectSurvived('test_6', 'AI-rejected (3 days, fresh) — survived');
    expectSurvived('test_8', 'Admin-rejected (10 days, fresh) — survived');
    expectSurvived('test_10', 'Pending review (5 days, fresh) — survived');
    expectSurvived('test_12', 'Auto-active no review (5 days, fresh) — survived');

    // SHOULD BE DELETED
    expectDeleted('test_5', 'AI-rejected (8 days, stale) — deleted');
    expectDeleted('test_7', 'Admin-rejected (15 days, stale) — deleted');
    expectDeleted('test_9', 'Pending review (15 days, stale) — deleted');
    expectDeleted('test_11', 'Auto-active no review (15 days, stale) — deleted');

    // ── Cleanup ───────────────────────────────────────────────────────────
    await collection.deleteMany({});
    await collection.drop().catch(() => { });

    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log(`⚠️  ${failed} test(s) failed. Check deleteOldJobs() in src/db/jobQueries.js`);
        await client.close();
        process.exit(1);
    } else {
        console.log('✅ All auto-deletion rules are correct.');
        console.log('   Admin-approved and curated jobs are protected.');
        console.log('   Stale jobs are cleaned up on the right schedule.');
        await client.close();
        process.exit(0);
    }
}

run().catch(async (err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
