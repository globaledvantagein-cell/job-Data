import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'job-scraper';

async function run() {
    console.log('🚀 Starting database cleanup migration...\n');

    if (!MONGO_URI) {
        throw new Error('MONGO_URI is not defined in environment variables');
    }

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log('--- Step 1: Remove thumb fields from jobs ---');
    const jobsCollection = db.collection('jobs');

    const thumbResult = await jobsCollection.updateMany(
        {},
        {
            $unset: {
                thumbsUp: '',
                thumbsDown: '',
                thumbStatus: '',
                userVote: ''
            }
        }
    );
    console.log(`✅ Removed thumb fields from ${thumbResult.modifiedCount} job documents\n`);

    console.log('--- Step 2: Remove thumb fields from jobTestLogs ---');
    const logsCollection = db.collection('jobTestLogs');

    const logsResult = await logsCollection.updateMany(
        {},
        {
            $unset: {
                thumbsUp: '',
                thumbsDown: '',
                thumbStatus: '',
                userVote: ''
            }
        }
    );
    console.log(`✅ Removed thumb fields from ${logsResult.modifiedCount} log documents\n`);

    console.log('--- Step 3: Drop votes collection ---');
    try {
        await db.collection('votes').drop();
        console.log('✅ Dropped votes collection\n');
    } catch {
        console.log('ℹ️  votes collection does not exist, skipping\n');
    }

    console.log('--- Step 4: Fix salary values stored in thousands ---');

    const lowSalaryJobs = await jobsCollection.find({
        SalaryInterval: 'per-year-salary',
        $or: [
            { SalaryMin: { $gt: 0, $lt: 1000 } },
            { SalaryMax: { $gt: 0, $lt: 1000 } }
        ]
    }).toArray();

    let salaryFixed = 0;
    for (const job of lowSalaryJobs) {
        const update = {};
        if (job.SalaryMin && job.SalaryMin > 0 && job.SalaryMin < 1000) {
            update.SalaryMin = job.SalaryMin * 1000;
        }
        if (job.SalaryMax && job.SalaryMax > 0 && job.SalaryMax < 1000) {
            update.SalaryMax = job.SalaryMax * 1000;
        }
        if (Object.keys(update).length > 0) {
            await jobsCollection.updateOne({ _id: job._id }, { $set: update });
            salaryFixed++;
        }
    }
    console.log(`✅ Fixed salary for ${salaryFixed} jobs (${lowSalaryJobs.length} had low values)\n`);

    const lowSalaryLogs = await logsCollection.find({
        SalaryInterval: 'per-year-salary',
        $or: [
            { SalaryMin: { $gt: 0, $lt: 1000 } },
            { SalaryMax: { $gt: 0, $lt: 1000 } }
        ]
    }).toArray();

    let logSalaryFixed = 0;
    for (const log of lowSalaryLogs) {
        const update = {};
        if (log.SalaryMin && log.SalaryMin > 0 && log.SalaryMin < 1000) update.SalaryMin = log.SalaryMin * 1000;
        if (log.SalaryMax && log.SalaryMax > 0 && log.SalaryMax < 1000) update.SalaryMax = log.SalaryMax * 1000;
        if (Object.keys(update).length > 0) {
            await logsCollection.updateOne({ _id: log._id }, { $set: update });
            logSalaryFixed++;
        }
    }
    console.log(`✅ Fixed salary for ${logSalaryFixed} log entries\n`);

    console.log('--- Step 5: Backfill ExperienceLevel from titles ---');

    const naExperienceJobs = await jobsCollection.find({
        $or: [
            { ExperienceLevel: 'N/A' },
            { ExperienceLevel: { $exists: false } },
            { ExperienceLevel: null }
        ]
    }).toArray();

    let expFixed = 0;
    for (const job of naExperienceJobs) {
        const lower = (job.JobTitle || '').toLowerCase();
        let exp = 'Mid';
        let entry = false;

        if (/\b(staff|distinguished)\b/.test(lower)) exp = 'Staff';
        else if (/\b(lead|principal|tech lead)\b/.test(lower)) exp = 'Lead';
        else if (/\b(senior|sr\.?)\b/.test(lower)) exp = 'Senior';
        else if (/\b(junior|jr\.?|entry|associate|graduate)\b/.test(lower)) {
            exp = 'Entry';
            entry = true;
        }

        await jobsCollection.updateOne(
            { _id: job._id },
            { $set: { ExperienceLevel: exp, isEntryLevel: entry } }
        );
        expFixed++;
    }
    console.log(`✅ Backfilled ExperienceLevel for ${expFixed} jobs (of ${naExperienceJobs.length} with N/A)\n`);

    console.log('--- Step 6: Backfill WorkplaceType ---');

    const unspecifiedJobs = await jobsCollection.find({
        $or: [
            { WorkplaceType: 'Unspecified' },
            { WorkplaceType: { $exists: false } },
            { WorkplaceType: null }
        ]
    }).toArray();

    let wpFixed = 0;
    for (const job of unspecifiedJobs) {
        const location = (job.Location || '').toLowerCase();
        const descStart = (job.Description || '').toLowerCase().substring(0, 1000);

        let wp = 'Unspecified';
        if (location.includes('remote') || descStart.includes('fully remote') || descStart.includes('100% remote')) {
            wp = 'Remote';
        } else if (location.includes('hybrid') || descStart.includes('hybrid')) {
            wp = 'Hybrid';
        }

        if (wp !== 'Unspecified') {
            await jobsCollection.updateOne({ _id: job._id }, { $set: { WorkplaceType: wp } });
            wpFixed++;
        }
    }
    console.log(`✅ Backfilled WorkplaceType for ${wpFixed} jobs (of ${unspecifiedJobs.length} unspecified)\n`);

    console.log('--- Step 7: Initialize applyClicks field ---');

    const noClicksResult = await jobsCollection.updateMany(
        { applyClicks: { $exists: false } },
        { $set: { applyClicks: 0 } }
    );
    console.log(`✅ Initialized applyClicks for ${noClicksResult.modifiedCount} jobs\n`);

    console.log('--- Step 8: Create applyClicks index ---');
    try {
        const clicksCollection = db.collection('applyClicks');
        await clicksCollection.createIndex(
            { jobId: 1, visitorId: 1 },
            { unique: true }
        );
        console.log('✅ Created unique index on applyClicks collection\n');
    } catch (e) {
        console.log(`ℹ️  Index may already exist: ${e.message}\n`);
    }

    console.log('--- Step 9: Drop unused collections ---');
    const toDrop = ['raw_jobs', 'normalized_jobs', 'manual_companies', 'sent_jobs', 'sync_runs'];
    for (const name of toDrop) {
        try {
            await db.collection(name).drop();
            console.log(`✅ Dropped collection: ${name}`);
        } catch {
            console.log(`ℹ️  ${name} does not exist, skipping`);
        }
    }

    console.log('\n========================================');
    console.log('🎉 Migration complete!');
    console.log('========================================');
    console.log(`Thumb fields removed: ${thumbResult.modifiedCount} jobs + ${logsResult.modifiedCount} logs`);
    console.log(`Salaries fixed: ${salaryFixed} jobs + ${logSalaryFixed} logs`);
    console.log(`ExperienceLevel backfilled: ${expFixed} jobs`);
    console.log(`WorkplaceType backfilled: ${wpFixed} jobs`);
    console.log(`applyClicks initialized: ${noClicksResult.modifiedCount} jobs`);
    console.log('========================================\n');
    console.log('✅ Safe to delete this file now.');

    await client.close();
    process.exit(0);
}

run().catch(async err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
