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