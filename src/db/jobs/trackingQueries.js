import { ObjectId } from 'mongodb';
import { connectToDb } from '../connection.js';

/**
 * Records one apply click for a job by a specific visitor.
 * Idempotent — same (jobId, visitorId) combo only increments the counter once.
 * Returns the current applyClicks count.
 */
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

/**
 * Marks an apply-click record as "confirmed applied" — the user came back
 * from the external ATS site and said "Yes, I applied."
 */
export async function confirmApplied(jobId, visitorId) {
    const db = await connectToDb();
    const clicksCollection = db.collection('applyClicks');

    if (!ObjectId.isValid(jobId)) throw new Error('Invalid job id');

    const objectId = new ObjectId(jobId);

    // Upsert: if they somehow confirm without a prior click record, create one.
    await clicksCollection.updateOne(
        { jobId: objectId, visitorId },
        { $set: { confirmedApplied: true, confirmedAt: new Date() }, $setOnInsert: { clickedAt: new Date() } },
        { upsert: true }
    );
}

/**
 * Returns an array of job ID strings the visitor has confirmed-applied to.
 */
export async function getAppliedJobIds(visitorId) {
    const db = await connectToDb();
    const clicksCollection = db.collection('applyClicks');

    const records = await clicksCollection
        .find({ visitorId, confirmedApplied: true }, { projection: { jobId: 1 } })
        .toArray();

    return records.map(r => r.jobId.toString());
}

// ─── Saved Jobs ───────────────────────────────────────────────────────────
// Stored as a savedJobs array on the user doc (keyed by userId), NOT in the
// applyClicks collection — saving is a per-account action, while apply-clicks
// are tracked per visitor so anonymous browsing still counts.

/**
 * Saves a job for a user. Idempotent — the filter excludes users who already
 * have this jobId, so a repeat save is a no-op rather than a duplicate entry.
 * Returns true if the job was newly saved.
 */
export async function saveJob(userId, jobId) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    if (!ObjectId.isValid(userId)) throw new Error('Invalid user id');
    if (!ObjectId.isValid(jobId)) throw new Error('Invalid job id');

    const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId), 'savedJobs.jobId': { $ne: new ObjectId(jobId) } },
        { $push: { savedJobs: { jobId: new ObjectId(jobId), savedAt: new Date() } } }
    );

    return result.modifiedCount > 0;
}

/**
 * Removes a job from a user's savedJobs array. Idempotent.
 * Returns true if an entry was actually removed.
 */
export async function unsaveJob(userId, jobId) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    if (!ObjectId.isValid(userId)) throw new Error('Invalid user id');
    if (!ObjectId.isValid(jobId)) throw new Error('Invalid job id');

    const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $pull: { savedJobs: { jobId: new ObjectId(jobId) } } }
    );

    return result.modifiedCount > 0;
}

/**
 * Returns an array of job ID strings the user has saved.
 */
export async function getSavedJobIds(userId) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    if (!ObjectId.isValid(userId)) throw new Error('Invalid user id');

    const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { savedJobs: 1 } }
    );

    return (user?.savedJobs || []).map(entry => entry.jobId.toString());
}

/**
 * Returns saved jobs with full details for the Profile page, newest save first.
 * Mirrors getAppliedJobsWithDetails: entries whose job no longer exists are
 * dropped, and isActive lets the UI flag roles that have since closed.
 */
export async function getSavedJobsWithDetails(userId) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');
    const jobsCollection = db.collection('jobs');

    if (!ObjectId.isValid(userId)) throw new Error('Invalid user id');

    const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { savedJobs: 1 } }
    );

    const saved = user?.savedJobs || [];
    if (saved.length === 0) return [];

    const sorted = [...saved].sort((a, b) => {
        const aTime = a.savedAt ? new Date(a.savedAt).getTime() : 0;
        const bTime = b.savedAt ? new Date(b.savedAt).getTime() : 0;
        return bTime - aTime;
    });

    const jobs = await jobsCollection
        .find(
            { _id: { $in: sorted.map(entry => entry.jobId) } },
            { projection: {
                JobTitle: 1, Company: 1, Location: 1, ApplicationURL: 1,
                Status: 1, IsRemote: 1, Category: 1, Domain: 1,
                ExperienceLevel: 1, PostedDate: 1,
            }}
        )
        .toArray();

    const jobMap = new Map(jobs.map(j => [j._id.toString(), j]));

    return sorted.map(entry => {
        const job = jobMap.get(entry.jobId.toString());
        return {
            jobId: entry.jobId.toString(),
            savedAt: entry.savedAt,
            isActive: job?.Status === 'active',
            job: job ? {
                JobTitle: job.JobTitle,
                Company: job.Company,
                Location: job.Location,
                ApplicationURL: job.ApplicationURL,
                IsRemote: job.IsRemote,
                Category: job.Category,
                Domain: job.Domain,
                ExperienceLevel: job.ExperienceLevel,
                PostedDate: job.PostedDate,
            } : null,
        };
    }).filter(entry => entry.job !== null);
}

/**
 * Returns applied jobs with full details for the Applied Jobs page.
 * Joins applyClicks (confirmed only) with the jobs collection.
 * Includes expired/deleted jobs so the user can see their full history.
 */
export async function getAppliedJobsWithDetails(visitorId) {
    const db = await connectToDb();
    const clicksCollection = db.collection('applyClicks');
    const jobsCollection = db.collection('jobs');

    const clicks = await clicksCollection
        .find({ visitorId, confirmedApplied: true })
        .sort({ confirmedAt: -1 })
        .toArray();

    if (clicks.length === 0) return [];

    const jobIds = clicks.map(c => c.jobId);
    const jobs = await jobsCollection
        .find(
            { _id: { $in: jobIds } },
            { projection: {
                JobTitle: 1, Company: 1, Location: 1, ApplicationURL: 1,
                Status: 1, IsRemote: 1, Category: 1, Domain: 1,
                ExperienceLevel: 1, PostedDate: 1,
            }}
        )
        .toArray();

    const jobMap = new Map(jobs.map(j => [j._id.toString(), j]));

    return clicks.map(click => {
        const job = jobMap.get(click.jobId.toString());
        return {
            jobId: click.jobId.toString(),
            appliedAt: click.confirmedAt || click.clickedAt,
            isActive: job?.Status === 'active',
            job: job ? {
                JobTitle: job.JobTitle,
                Company: job.Company,
                Location: job.Location,
                ApplicationURL: job.ApplicationURL,
                IsRemote: job.IsRemote,
                Category: job.Category,
                Domain: job.Domain,
                ExperienceLevel: job.ExperienceLevel,
                PostedDate: job.PostedDate,
            } : null,
        };
    }).filter(entry => entry.job !== null);
}