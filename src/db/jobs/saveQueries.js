import { connectToDb } from '../connection.js';
import { SITES_CONFIG } from '../../config.js';
import { createJobModel } from '../../models/jobModel.js';
import { categorizeJob } from '../../core/categorize.js';

export async function loadAllExistingIDs() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const existingIDsMap = new Map();
    for (const siteConfig of SITES_CONFIG) {
        const siteName = siteConfig.siteName;
        const idSet = new Set();
        const jobs = await jobsCollection.find({ sourceSite: siteName }, { projection: { JobID: 1 } }).toArray();
        jobs.forEach(job => idSet.add(job.JobID));
        existingIDsMap.set(siteName, idSet);
        console.log(`[${siteName}] Found ${idSet.size} existing jobs in the database.`);
    }
    return existingIDsMap;
}

export async function saveJobs(jobs) {
    if (jobs.length === 0) return;
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const operations = jobs.map(job => {
        const { createdAt, updatedAt, ...pureJobData } = job;
        // Compute Category at write time (deterministic, no AI).
        // Filter queries then use indexed Category lookups instead of
        // classifying every job on every API request.
        const Category = categorizeJob(pureJobData);
        return {
            updateOne: {
                filter: { JobID: job.JobID, sourceSite: job.sourceSite },
                update: {
                    $set: {
                        ...pureJobData,
                        Category,
                        updatedAt: new Date(),
                        scrapedAt: new Date()
                    },
                    $setOnInsert: { createdAt: new Date() }
                },
                upsert: true,
            },
        };
    });

    await jobsCollection.bulkWrite(operations);
}

export async function saveJobTestLog(jobTestLog) {
    if (!jobTestLog) return;
    const db = await connectToDb();
    const testLogsCollection = db.collection('jobTestLogs');

    // Ensure fingerprint index exists (runs once, no-ops after that)
    await testLogsCollection.createIndex({ fingerprint: 1 }, { background: true }).catch(() => { });

    const { createdAt, ...pureJobData } = jobTestLog;

    await testLogsCollection.updateOne(
        { JobID: jobTestLog.JobID, sourceSite: jobTestLog.sourceSite },
        {
            $set: {
                ...pureJobData,
                scrapedAt: new Date()
            },
            $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
    );
}

export async function findTestLogByFingerprint(fingerprint) {
    if (!fingerprint) return null;
    const db = await connectToDb();
    const testLogsCollection = db.collection('jobTestLogs');

    const log = await testLogsCollection.findOne(
        { fingerprint: fingerprint },
        {
            projection: {
                GermanRequired: 1,
                Domain: 1,
                SubDomain: 1,
                ConfidenceScore: 1,
                Evidence: 1,
                FinalDecision: 1,
                RejectionReason: 1,
                fingerprint: 1,
            }
        }
    );

    return log || null;
}

export async function addCuratedJob(jobData) {
    if (!jobData.JobTitle || !jobData.ApplicationURL || !jobData.Company) {
        throw new Error('Job Title, URL, and Company are required.');
    }
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const existingJob = await jobsCollection.findOne({ ApplicationURL: jobData.ApplicationURL });
    if (existingJob) {
        throw new Error('This Application URL already exists in the database.');
    }
    const jobID = `curated-${new Date().getTime()}`;

    const jobToSave = createJobModel({
        JobID: jobID,
        JobTitle: jobData.JobTitle,
        ApplicationURL: jobData.ApplicationURL,
        Company: jobData.Company,
        Location: jobData.Location,
        Department: jobData.Department,
        GermanRequired: jobData.GermanRequired ?? false,
        Description: jobData.Description || `Manually curated: ${jobData.JobTitle}`,
        PostedDate: jobData.PostedDate || new Date().toISOString(),
        ContractType: jobData.ContractType,
        ExperienceLevel: jobData.ExperienceLevel,
        isManual: true,
        Status: 'active'
    }, "Curated");

    await saveJobs([jobToSave]);
    return jobToSave;
}
