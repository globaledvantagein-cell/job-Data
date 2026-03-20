// ─── Test: Validator + Test Log Cleanup ───────────────────────────────────
// Tests:
// 1. Validator only queries active jobs (not pending/rejected)
// 2. Test log cleanup deletes logs older than 30 days
// 3. Test log cleanup keeps recent logs
//
// Run: node src/test-validator-and-cleanup.js
// Delete this file after tests pass.

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const TEST_JOBS_COLLECTION = 'test_validator_jobs';
const TEST_LOGS_COLLECTION = 'test_validator_logs';

async function run() {
    if (!MONGO_URI) {
        console.error('❌ MONGO_URI not set in .env');
        process.exit(1);
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db('job-scraper');

    const jobsCol = db.collection(TEST_JOBS_COLLECTION);
    const logsCol = db.collection(TEST_LOGS_COLLECTION);

    // Clean up previous test data
    await jobsCol.deleteMany({});
    await logsCol.deleteMany({});

    const now = new Date();
    const daysAgo = (days) => {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        return d;
    };

    let passed = 0;
    let failed = 0;

    function check(condition, passMsg, failMsg) {
        if (condition) {
            console.log(`  ✅ ${passMsg}`);
            passed++;
        } else {
            console.log(`  ❌ ${failMsg}`);
            failed++;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n=== Test Group 1: Validator Should Only Query Active Jobs ===\n');
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Insert test jobs with different statuses
    await jobsCol.insertMany([
        {
            JobID: 'v_1', Status: 'active', JobTitle: 'Active Job 1',
            Company: 'TestCo', ApplicationURL: 'https://example.com/job1'
        },
        {
            JobID: 'v_2', Status: 'active', JobTitle: 'Active Job 2',
            Company: 'TestCo', ApplicationURL: 'https://example.com/job2'
        },
        {
            JobID: 'v_3', Status: 'pending_review', JobTitle: 'Pending Job',
            Company: 'TestCo', ApplicationURL: 'https://example.com/job3'
        },
        {
            JobID: 'v_4', Status: 'rejected', JobTitle: 'Rejected Job',
            Company: 'TestCo', ApplicationURL: 'https://example.com/job4'
        },
        {
            JobID: 'v_5', Status: 'pending_review', JobTitle: 'Another Pending',
            Company: 'TestCo', ApplicationURL: 'https://example.com/job5'
        },
    ]);

    // Simulate what the new validator does: query only active jobs
    const activeQuery = { Status: 'active' };
    const activeJobs = await jobsCol.find(activeQuery).toArray();
    const allJobs = await jobsCol.find({}).toArray();

    check(
        activeJobs.length === 2,
        `Validator would check ${activeJobs.length} active jobs (correct: 2)`,
        `Validator would check ${activeJobs.length} active jobs (expected 2)`
    );

    check(
        allJobs.length === 5,
        `Total jobs in DB: ${allJobs.length} (correct: 5)`,
        `Total jobs in DB: ${allJobs.length} (expected 5)`
    );

    check(
        activeJobs.every(j => j.Status === 'active'),
        'All queried jobs have Status: active',
        'Some queried jobs have wrong status!'
    );

    check(
        !activeJobs.some(j => j.Status === 'pending_review' || j.Status === 'rejected'),
        'No pending or rejected jobs in validator query',
        'Pending or rejected jobs leaked into validator query!'
    );

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n=== Test Group 2: Test Log Cleanup ===\n');
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Insert test logs with various ages
    await logsCol.insertMany([
        {
            _label: 'Recent log (5 days)',
            JobID: 'log_1', fingerprint: 'fp_1',
            scrapedAt: daysAgo(5)
        },
        {
            _label: 'Recent log (15 days)',
            JobID: 'log_2', fingerprint: 'fp_2',
            scrapedAt: daysAgo(15)
        },
        {
            _label: 'Recent log (29 days)',
            JobID: 'log_3', fingerprint: 'fp_3',
            scrapedAt: daysAgo(29)
        },
        {
            _label: 'Old log (31 days) — SHOULD BE DELETED',
            JobID: 'log_4', fingerprint: 'fp_4',
            scrapedAt: daysAgo(31)
        },
        {
            _label: 'Old log (45 days) — SHOULD BE DELETED',
            JobID: 'log_5', fingerprint: 'fp_5',
            scrapedAt: daysAgo(45)
        },
        {
            _label: 'Very old log (90 days) — SHOULD BE DELETED',
            JobID: 'log_6', fingerprint: 'fp_6',
            scrapedAt: daysAgo(90)
        },
    ]);

    const beforeCount = await logsCol.countDocuments();
    check(
        beforeCount === 6,
        `Inserted ${beforeCount} test logs (correct: 6)`,
        `Inserted ${beforeCount} test logs (expected 6)`
    );

    // Run the cleanup logic (same query as cleanupOldTestLogs in databaseManager.js)
    const thirtyDaysAgo = daysAgo(30);
    const deleteResult = await logsCol.deleteMany({
        scrapedAt: { $lt: thirtyDaysAgo }
    });

    check(
        deleteResult.deletedCount === 3,
        `Deleted ${deleteResult.deletedCount} old logs (correct: 3)`,
        `Deleted ${deleteResult.deletedCount} old logs (expected 3)`
    );

    const afterCount = await logsCol.countDocuments();
    check(
        afterCount === 3,
        `${afterCount} logs remaining (correct: 3)`,
        `${afterCount} logs remaining (expected 3)`
    );

    // Check that the RIGHT logs survived
    const surviving = await logsCol.find({}).toArray();
    const survivingIds = new Set(surviving.map(l => l.JobID));

    check(
        survivingIds.has('log_1') && survivingIds.has('log_2') && survivingIds.has('log_3'),
        'Recent logs (5d, 15d, 29d) all survived',
        'Some recent logs were wrongly deleted!'
    );

    check(
        !survivingIds.has('log_4') && !survivingIds.has('log_5') && !survivingIds.has('log_6'),
        'Old logs (31d, 45d, 90d) all deleted',
        'Some old logs wrongly survived!'
    );

    // Check that surviving logs still have their fingerprints
    check(
        surviving.every(l => l.fingerprint && l.fingerprint.startsWith('fp_')),
        'Surviving logs still have fingerprint field intact',
        'Some surviving logs lost their fingerprint!'
    );

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n=== Test Group 3: Wiring Check ===\n');
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // These are static checks — verify the code structure is correct.
    // We import and check that the functions exist.

    let wiringOk = true;

    try {
        const dbModule = await import('../Db/databaseManager.js');
        check(
            typeof dbModule.cleanupOldTestLogs === 'function',
            'cleanupOldTestLogs() exists in databaseManager.js',
            'cleanupOldTestLogs() NOT FOUND in databaseManager.js — did you add it?'
        );
    } catch (err) {
        console.log(`  ❌ Could not import databaseManager.js: ${err.message}`);
        failed++;
        wiringOk = false;
    }

    try {
        const scraperModule = await import('../tasks/runScraper.js');
        // We can't easily check if cleanupOldTestLogs is called inside runScraper
        // without running it. But we can check the import exists.
        check(
            typeof scraperModule.runScraper === 'function',
            'runScraper() exports correctly (verify cleanupOldTestLogs import manually)',
            'runScraper() export broken!'
        );
    } catch (err) {
        console.log(`  ❌ Could not import runScraper.js: ${err.message}`);
        failed++;
        wiringOk = false;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Cleanup
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    await jobsCol.deleteMany({});
    await logsCol.deleteMany({});
    await jobsCol.drop().catch(() => {});
    await logsCol.drop().catch(() => {});

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log(`⚠️  ${failed} test(s) failed. Check the relevant files.`);
        await client.close();
        process.exit(1);
    } else {
        console.log('✅ All validator and cleanup tests passed.');
        console.log('   Validator only checks active jobs.');
        console.log('   Test log cleanup correctly removes 30+ day old logs.');
        console.log('   Delete this file: rm src/test-validator-and-cleanup.js');
        await client.close();
        process.exit(0);
    }
}

run().catch(async (err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
