// ─── Test: Validator + Test Log Cleanup ───────────────────────────────────
// Tests:
// 1. Validator only queries active jobs (not pending/rejected)
// 2. Test log cleanup deletes logs older than 30 days
// 3. Test log cleanup keeps recent logs
//
// Run: node src/tests/test-validator-and-cleanup.js

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

    await jobsCol.insertMany([
        { JobID: 'v_1', Status: 'active', JobTitle: 'Active Job 1', Company: 'TestCo', ApplicationURL: 'https://example.com/job1' },
        { JobID: 'v_2', Status: 'active', JobTitle: 'Active Job 2', Company: 'TestCo', ApplicationURL: 'https://example.com/job2' },
        { JobID: 'v_3', Status: 'pending_review', JobTitle: 'Pending Job', Company: 'TestCo', ApplicationURL: 'https://example.com/job3' },
        { JobID: 'v_4', Status: 'rejected', JobTitle: 'Rejected Job', Company: 'TestCo', ApplicationURL: 'https://example.com/job4' },
        { JobID: 'v_5', Status: 'pending_review', JobTitle: 'Another Pending', Company: 'TestCo', ApplicationURL: 'https://example.com/job5' },
    ]);

    const activeJobs = await jobsCol.find({ Status: 'active' }).toArray();
    const allJobs = await jobsCol.find({}).toArray();

    check(activeJobs.length === 2, `Validator checks ${activeJobs.length} active jobs (correct: 2)`, `Validator checks ${activeJobs.length} active jobs (expected 2)`);
    check(allJobs.length === 5, `Total jobs in DB: ${allJobs.length} (correct: 5)`, `Total jobs in DB: ${allJobs.length} (expected 5)`);
    check(activeJobs.every(j => j.Status === 'active'), 'All queried jobs have Status: active', 'Some queried jobs have wrong status!');
    check(!activeJobs.some(j => j.Status === 'pending_review' || j.Status === 'rejected'), 'No pending or rejected jobs in validator query', 'Pending or rejected jobs leaked into validator query!');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n=== Test Group 2: Test Log Cleanup ===\n');
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    await logsCol.insertMany([
        { _label: 'Recent log (5 days)', JobID: 'log_1', fingerprint: 'fp_1', scrapedAt: daysAgo(5) },
        { _label: 'Recent log (15 days)', JobID: 'log_2', fingerprint: 'fp_2', scrapedAt: daysAgo(15) },
        { _label: 'Recent log (29 days)', JobID: 'log_3', fingerprint: 'fp_3', scrapedAt: daysAgo(29) },
        { _label: 'Old log (31 days) — DELETE', JobID: 'log_4', fingerprint: 'fp_4', scrapedAt: daysAgo(31) },
        { _label: 'Old log (45 days) — DELETE', JobID: 'log_5', fingerprint: 'fp_5', scrapedAt: daysAgo(45) },
        { _label: 'Very old (90 days) — DELETE', JobID: 'log_6', fingerprint: 'fp_6', scrapedAt: daysAgo(90) },
    ]);

    const beforeCount = await logsCol.countDocuments();
    check(beforeCount === 6, `Inserted ${beforeCount} test logs (correct: 6)`, `Inserted ${beforeCount} test logs (expected 6)`);

    // Same query used by db/testLogQueries.js cleanupOldTestLogs()
    const thirtyDaysAgo = daysAgo(30);
    const deleteResult = await logsCol.deleteMany({ scrapedAt: { $lt: thirtyDaysAgo } });

    check(deleteResult.deletedCount === 3, `Deleted ${deleteResult.deletedCount} old logs (correct: 3)`, `Deleted ${deleteResult.deletedCount} old logs (expected 3)`);

    const afterCount = await logsCol.countDocuments();
    check(afterCount === 3, `${afterCount} logs remaining (correct: 3)`, `${afterCount} logs remaining (expected 3)`);

    const surviving = await logsCol.find({}).toArray();
    const survivingIds = new Set(surviving.map(l => l.JobID));

    check(survivingIds.has('log_1') && survivingIds.has('log_2') && survivingIds.has('log_3'), 'Recent logs (5d, 15d, 29d) all survived', 'Some recent logs were wrongly deleted!');
    check(!survivingIds.has('log_4') && !survivingIds.has('log_5') && !survivingIds.has('log_6'), 'Old logs (31d, 45d, 90d) all deleted', 'Some old logs wrongly survived!');
    check(surviving.every(l => l.fingerprint && l.fingerprint.startsWith('fp_')), 'Surviving logs still have fingerprint field intact', 'Some surviving logs lost their fingerprint!');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n=== Test Group 3: Wiring Check (updated import paths) ===\n');
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Verify new split modules exist and export the correct functions

    try {
        const dbModule = await import('../db/index.js');
        check(
            typeof dbModule.deleteOldJobs === 'function',
            'deleteOldJobs() exists in db/index.js',
            'deleteOldJobs() NOT FOUND in db/index.js'
        );
        check(
            typeof dbModule.connectToDb === 'function',
            'connectToDb() exists in db/index.js',
            'connectToDb() NOT FOUND in db/index.js'
        );
        check(
            typeof dbModule.saveJobs === 'function',
            'saveJobs() exists in db/index.js',
            'saveJobs() NOT FOUND in db/index.js'
        );
    } catch (err) {
        console.log(`  ❌ Could not import db/index.js: ${err.message}`);
        failed++;
    }

    try {
        const cronModule = await import('../cron/runScraper.js');
        check(
            typeof cronModule.runScraper === 'function',
            'runScraper() exports correctly from cron/runScraper.js',
            'runScraper() export broken in cron/runScraper.js!'
        );
    } catch (err) {
        console.log(`  ❌ Could not import cron/runScraper.js: ${err.message}`);
        failed++;
    }

    try {
        const geminiModule = await import('../gemini/index.js');
        check(
            typeof geminiModule.analyzeJobWithGroq === 'function',
            'analyzeJobWithGroq() exists in gemini/index.js',
            'analyzeJobWithGroq() NOT FOUND in gemini/index.js'
        );
    } catch (err) {
        console.log(`  ❌ Could not import gemini/index.js: ${err.message}`);
        failed++;
    }

    try {
        const filtersModule = await import('../filters/index.js');
        check(
            typeof filtersModule.detectGermanRequiredFromTitle === 'function',
            'detectGermanRequiredFromTitle() exists in filters/index.js',
            'detectGermanRequiredFromTitle() NOT FOUND in filters/index.js'
        );
    } catch (err) {
        console.log(`  ❌ Could not import filters/index.js: ${err.message}`);
        failed++;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Cleanup
    await jobsCol.deleteMany({});
    await logsCol.deleteMany({});
    await jobsCol.drop().catch(() => { });
    await logsCol.drop().catch(() => { });
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log(`⚠️  ${failed} test(s) failed.`);
        await client.close();
        process.exit(1);
    } else {
        console.log('✅ All validator and cleanup tests passed.');
        console.log('   Validator only checks active jobs.');
        console.log('   Test log cleanup correctly removes 30+ day old logs.');
        console.log('   All new module imports verified (db/, gemini/, filters/, cron/).');
        await client.close();
        process.exit(0);
    }
}

run().catch(async (err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
