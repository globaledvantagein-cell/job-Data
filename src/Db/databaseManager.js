import { createJobModel } from '../models/jobModel.js';
import { MongoClient, ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { MONGO_URI } from '../env.js';
import { SITES_CONFIG } from '../config.js';
import { createUserModel } from '../models/userModel.js';
import bcrypt from 'bcryptjs';
import { StripHtml } from '../utils.js';

export const client = new MongoClient(MONGO_URI);
let db;

export async function connectToDb() {
    if (db) return db;
    
    await client.connect();
    
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGO_URI);
        console.log("🍃 Mongoose Connected");
    }

    db = client.db("job-scraper");
    const clicksCollection = db.collection('applyClicks');
    await clicksCollection.createIndex({ jobId: 1, visitorId: 1 }, { unique: true });
    console.log("🗄️  Successfully connected to MongoDB.");
    return db;
}

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
        return {
            updateOne: {
                filter: { JobID: job.JobID, sourceSite: job.sourceSite },
                update: {
                    $set: {
                        ...pureJobData,
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

export async function deleteOldJobs(siteName, scrapeStartTime) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const result = await jobsCollection.deleteMany({
        sourceSite: siteName,
        updatedAt: { $lt: sevenDaysAgo }
    });
    
    if (result.deletedCount > 0) {
        console.log(`[${siteName}] Deleted ${result.deletedCount} jobs older than 7 days.`);
    }
}

export async function deleteJobById(jobId) {
    try {
        const db = await connectToDb();
        const jobsCollection = db.collection('jobs');
        await jobsCollection.deleteOne({ _id: jobId });
    } catch (error) {
        console.error(`Error deleting job ${jobId}:`, error);
    }
}

export async function getSubscribedUsers() {
    const db = await connectToDb();
    const usersCollection = db.collection('users');
   return await usersCollection.find({ 
        isSubscribed: true,
        isWaitlist: { $ne: true }
    }).toArray();
}

export async function findMatchingJobs(user) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    
    const query = {
        Status: 'active',
        GermanRequired: false,
        Department: { $in: user.desiredDomains },
        JobID: { $nin: user.sentJobIds },
    };
    
    if (user.desiredRoles && user.desiredRoles.length > 0) {
        query.$text = { $search: user.desiredRoles.join(' ') };
    }
    
    return await jobsCollection.find(query).sort({ scrapedAt: -1 }).limit(3).toArray();
}

export async function updateUserAfterEmail(userId, newSentJobIds) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');
    await usersCollection.updateOne(
        { _id: userId },
        {
            $set: { lastEmailSent: new Date() },
            $push: { sentJobIds: { $each: newSentJobIds } }
        }
    );
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

export async function getAllJobs(page = 1, limit = 50) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const skip = (page - 1) * limit;
    const totalJobs = await jobsCollection.countDocuments();
    const jobs = await jobsCollection.find({})
        .sort({ PostedDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    return {
        jobs,
        totalJobs,
        totalPages: Math.ceil(totalJobs / limit),
        currentPage: page
    };
}

export async function getPublicBaitJobs() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    
    const jobs = await jobsCollection.find({
        Status: { $in: ['active', 'pending_review'] },
        GermanRequired: false
    })
        .sort({ PostedDate: -1, createdAt: -1 })
        .limit(9)
        .project({
            JobTitle: 1, Company: 1, Location: 1, Department: 1,
            PostedDate: 1, ApplicationURL: 1, GermanRequired: 1, applyClicks: 1
        })
        .toArray();
    return jobs.map(job => ({ ...job, applyClicks: job.applyClicks || 0 }));
}

export async function addSubscriber(data) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');
    const newUser = createUserModel({
        email: data.email,
        desiredDomains: data.categories,
        emailFrequency: data.frequency,
        name: data.email.split('@')[0],
        createdAt: new Date()
    });
    await usersCollection.updateOne(
        { email: newUser.email },
        {
            $set: {
                desiredDomains: newUser.desiredDomains,
                emailFrequency: newUser.emailFrequency,
                isSubscribed: true,
                updatedAt: new Date()
            },
            $setOnInsert: {
                createdAt: new Date(),
                subscriptionTier: "free",
                sentJobIds: []
            }
        },
        { upsert: true }
    );
    return { success: true, email: newUser.email };
}

export async function getJobsPaginated(page = 1, limit = 50, companyFilter = null) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const skip = (page - 1) * limit;

    const query = {
        Status: { $in: ['active', 'pending_review'] },
        GermanRequired: false
    };

    if (companyFilter) {
        query.Company = { $regex: companyFilter, $options: 'i' };
    }

    const totalJobs = await jobsCollection.countDocuments(query);
    const jobs = await jobsCollection.find(query)
        .sort({ PostedDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    const companies = await jobsCollection.distinct('Company', {
        Status: { $in: ['active', 'pending_review'] },
        GermanRequired: false
    });

    const normalizedJobs = jobs.map(job => ({
        ...job,
        applyClicks: job.applyClicks || 0
    }));

    return { jobs: normalizedJobs, totalJobs, companies };
}

export async function getRejectedJobs() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    return await jobsCollection.find({ Status: 'rejected' })
        .sort({ updatedAt: -1 })
        .toArray();
}

export async function getJobsForReview(page = 1, limit = 50) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const skip = (page - 1) * limit;

    const query = { Status: 'pending_review' };

    const totalJobs = await jobsCollection.countDocuments(query);
    const jobs = await jobsCollection.find(query)
        .sort({ ConfidenceScore: -1, scrapedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    return {
        jobs,
        totalJobs,
        totalPages: Math.ceil(totalJobs / limit),
        currentPage: page
    };
}

export async function reviewJobDecision(jobId, decision) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    let newStatus = 'pending_review';
    if (decision === 'accept') newStatus = 'active';
    if (decision === 'reject') newStatus = 'rejected';

    await jobsCollection.updateOne(
        { _id: new ObjectId(jobId) },
        {
            $set: {
                Status: newStatus,
                reviewedAt: new Date()
            }
        }
    );
    return { success: true, status: newStatus };
}

export async function trackApplyClick(jobId, visitorId) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const clicksCollection = db.collection('applyClicks');

    if (!ObjectId.isValid(jobId)) {
        throw new Error('Invalid job id');
    }
    if (!visitorId || typeof visitorId !== 'string') {
        throw new Error('visitorId is required');
    }

    const objectId = new ObjectId(jobId);
    const existing = await clicksCollection.findOne({ jobId: objectId, visitorId });

    if (existing) {
        const job = await jobsCollection.findOne({ _id: objectId }, { projection: { applyClicks: 1 } });
        return { applyClicks: job?.applyClicks || 0, alreadyTracked: true };
    }

    try {
        await clicksCollection.insertOne({
            jobId: objectId,
            visitorId,
            clickedAt: new Date()
        });
    } catch (error) {
        if (error?.code === 11000) {
            const job = await jobsCollection.findOne({ _id: objectId }, { projection: { applyClicks: 1 } });
            return { applyClicks: job?.applyClicks || 0, alreadyTracked: true };
        }
        throw error;
    }

    const result = await jobsCollection.findOneAndUpdate(
        { _id: objectId },
        { $inc: { applyClicks: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after', projection: { applyClicks: 1 } }
    );

    return { applyClicks: result?.applyClicks || 1, alreadyTracked: false };
}

export async function getCompanyDirectoryStats() {
    try {
        const db = await connectToDb();
        const jobsCollection = db.collection('jobs');
        const manualCompaniesCollection = db.collection('manual_companies');

        // SCRAPED COMPANIES
        const pipeline = [
            {
                $match: {
                    Status: { $in: ['active', 'pending_review'] },
                    GermanRequired: false
                }
            },
            {
                $group: {
                    _id: "$Company",
                    openRoles: { $sum: 1 },
                    locations: { $addToSet: "$Location" }
                }
            },
            { $sort: { openRoles: -1 } }
        ];
        const scrapedStats = await jobsCollection.aggregate(pipeline).toArray();
        const formattedScraped = scrapedStats.map(stat => ({
            _id: stat._id,
            companyName: stat._id || "Unknown",
            openRoles: stat.openRoles,
            cities: [...new Set((stat.locations || []).map(l => l.split(',')[0].trim()))].slice(0, 3),
            domain: null,
            careersUrl: null,
            source: 'scraped'
        }));

        // MANUAL COMPANIES
        const manualCompanies = await manualCompaniesCollection.find({}).toArray();
        // Deduplicate: skip manual if name matches a scraped company (case-insensitive)
        const scrapedNames = new Set(formattedScraped.map(c => c.companyName.toLowerCase()));
        const formattedManual = manualCompanies
            .filter(c => !scrapedNames.has((c.name || '').toLowerCase()))
            .map(c => ({
                _id: c._id.toString(),
                companyName: c.name,
                openRoles: 0,
                cities: c.cities ? (typeof c.cities === 'string' ? c.cities.split(',').map(s => s.trim()) : (Array.isArray(c.cities) ? c.cities : [])) : [],
                careersUrl: c.domain || null, // domain field IS the full URL already
                source: 'manual'
            }));

        // Merge and sort: scraped (by openRoles desc), then manual (alpha)
        const merged = [
            ...formattedScraped,
            ...formattedManual.sort((a, b) => a.companyName.localeCompare(b.companyName))
        ];
        return merged;
    } catch (error) {
        console.error("Stats: Aggregation failed:", error);
        return [];
    }
}

export async function findJobById(id) {
    const db = await connectToDb();
    return await db.collection('jobs').findOne({ _id: new ObjectId(id) });
}

export async function findJobByIdOrJobID(idOrJobID) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    if (ObjectId.isValid(idOrJobID)) {
        const byObjectId = await jobsCollection.findOne({ _id: new ObjectId(idOrJobID) });
        if (byObjectId) return byObjectId;
    }

    return await jobsCollection.findOne({ JobID: idOrJobID });
}

export async function getJobsEligibleForReanalysis() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    return await jobsCollection.find({
        $or: [
            { Status: 'pending_review' },
            {
                Status: 'rejected',
                $or: [
                    { reviewedAt: { $exists: false } },
                    { reviewedAt: null }
                ]
            }
        ]
    }).toArray();
}

export async function countManuallyReviewedJobs() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    return await jobsCollection.countDocuments({
        $or: [
            { Status: 'active', reviewedAt: { $exists: true, $ne: null } },
            { Status: 'rejected', reviewedAt: { $exists: true, $ne: null } }
        ]
    });
}

export async function updateJobAfterReanalysis(jobId, aiResult, status, rejectionReason) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    await jobsCollection.updateOne(
        { _id: new ObjectId(jobId) },
        {
            $set: {
                GermanRequired: aiResult.german_required,
                Domain: aiResult.domain,
                SubDomain: aiResult.sub_domain,
                ConfidenceScore: aiResult.confidence,
                Evidence: aiResult.evidence || { german_reason: '' },
                Status: status,
                RejectionReason: rejectionReason,
                updatedAt: new Date()
            }
        }
    );

    return await jobsCollection.findOne({ _id: new ObjectId(jobId) });
}

export async function restoreRejectedJobToQueue(jobId) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    await jobsCollection.updateOne(
        { _id: new ObjectId(jobId) },
        {
            $set: {
                Status: 'pending_review',
                RejectionReason: null,
                updatedAt: new Date()
            },
            $unset: {
                reviewedAt: ''
            }
        }
    );
}

export async function deleteJobsByCompany(companyName) {
    const db = await connectToDb();
    console.log(`[Admin] Deleting all jobs for company: ${companyName}`);
    return await db.collection('jobs').deleteMany({
        Company: { $regex: new RegExp(`^${companyName}$`, 'i') }
    });
}

export async function registerUser({ email, password, name, role = 'user', location, domain, isWaitlist }) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
        throw new Error("User already exists");
    }

    let hashedPassword = null;
    if (password) {
        const salt = await bcrypt.genSalt(10);
        hashedPassword = await bcrypt.hash(password, salt);
    }

    const newUser = createUserModel({
        email,
        password: hashedPassword,
        name,
        role,
        location,
        domain,
        isWaitlist,
        createdAt: new Date()
    });

    await usersCollection.insertOne(newUser);
    
    return { 
        id: newUser._id, 
        email: newUser.email, 
        role: newUser.role, 
        name: newUser.name 
    };
}

export async function loginUser(email, password) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne({ email });
    if (!user) {
        throw new Error("Invalid credentials");
    }

    if (!user.password) {
        throw new Error("Please register an account first.");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error("Invalid credentials");
    }

    return { id: user._id, email: user.email, role: user.role, name: user.name };
}

export async function getUserProfile(userId) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');
    return await usersCollection.findOne({ _id: new ObjectId(userId) }, { projection: { password: 0 } });
}

export async function cleanAllDescriptions() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const logsCollection = db.collection('jobTestLogs');

    let total = 0;
    let cleaned = 0;

    const cleanInCollection = async (collection) => {
        const cursor = collection.find({}, { projection: { _id: 1, Description: 1 } });

        while (await cursor.hasNext()) {
            const document = await cursor.next();
            total += 1;

            const currentDescription = typeof document?.Description === 'string' ? document.Description : '';
            const nextDescription = StripHtml(currentDescription);

            if (nextDescription !== currentDescription) {
                await collection.updateOne(
                    { _id: document._id },
                    { $set: { Description: nextDescription, updatedAt: new Date() } }
                );
                cleaned += 1;
            }
        }
    };

    await cleanInCollection(jobsCollection);
    await cleanInCollection(logsCollection);

    return {
        total,
        cleaned,
        alreadyClean: total - cleaned
    };
}

export async function saveFeedback(feedbackData) {
    const db = await connectToDb();
    const collection = db.collection('feedback');
    const result = await collection.insertOne(feedbackData);
    return { id: result.insertedId, ...feedbackData };
}

export async function getAllFeedback(page = 1, limit = 50, statusFilter = null) {
    const db = await connectToDb();
    const collection = db.collection('feedback');
    const skip = (page - 1) * limit;

    const query = {};
    if (statusFilter && statusFilter !== 'all') {
        query.status = statusFilter;
    }

    const total = await collection.countDocuments(query);
    const feedback = await collection.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    return { feedback, total, totalPages: Math.ceil(total / limit), currentPage: page };
}

export async function updateFeedbackStatus(feedbackId, status, adminNote = null) {
    const db = await connectToDb();
    const collection = db.collection('feedback');

    const update = { status, updatedAt: new Date() };
    if (adminNote !== null) update.adminNote = adminNote;

    await collection.updateOne(
        { _id: new ObjectId(feedbackId) },
        { $set: update }
    );
    return { success: true };
}

export async function deleteFeedback(feedbackId) {
    const db = await connectToDb();
    const collection = db.collection('feedback');
    await collection.deleteOne({ _id: new ObjectId(feedbackId) });
    return { success: true };
}

export async function getFeedbackStats() {
    const db = await connectToDb();
    const collection = db.collection('feedback');

    const total = await collection.countDocuments();
    const unread = await collection.countDocuments({ status: 'unread' });
    const read = await collection.countDocuments({ status: 'read' });
    const resolved = await collection.countDocuments({ status: 'resolved' });

    return { total, unread, read, resolved };
}