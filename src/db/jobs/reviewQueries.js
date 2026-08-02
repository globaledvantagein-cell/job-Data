import { ObjectId } from 'mongodb';
import { connectToDb } from '../connection.js';

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

    // Two kinds of work land in this queue:
    //   1. pending_review — needs a decision before it can go live
    //   2. auto-published — already live, but no human has confirmed it yet.
    //      This is the safety net on the auto-publish band: an admin can still
    //      pull a bad job. Once reviewedAt is stamped it leaves the queue.
    const query = {
        $or: [
            { Status: 'pending_review' },
            // `reviewedAt: null` matches both a missing field and an explicit
            // null — $exists:false alone would miss jobs whose reviewedAt was
            // nulled out rather than unset.
            { Status: 'active', approvalMethod: 'ai_auto', reviewedAt: null },
        ],
    };

    const totalJobs = await jobsCollection.countDocuments(query);
    // reviewGroup sorts pending_review (0) above auto-published (1) — the first
    // group is blocking publication, the second is only awaiting confirmation.
    const jobs = await jobsCollection.aggregate([
        { $match: query },
        { $addFields: {
            reviewGroup: { $cond: [{ $eq: ['$Status', 'pending_review'] }, 0, 1] },
        }},
        { $sort: { reviewGroup: 1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { reviewGroup: 0 } },
    ]).toArray();

    return {
        jobs,
        totalJobs,
        totalPages: Math.ceil(totalJobs / limit),
        currentPage: page
    };
}

/**
 * Record an admin accept/reject.
 *
 * Returns `wasAutoPublished` so the route can tell a first-time approval apart
 * from a confirmation of an already-live auto-published job: the latter is
 * already in the cache and has already had its Gemma extraction run, so
 * repeating that work would be wasted (and would re-increment jobsPublished for
 * a job that was already counted at scrape time).
 *
 * @param {string} jobId
 * @param {"accept"|"reject"} decision
 * @param {string|null} rejectionReason - admin-supplied note, reject only
 */
export async function reviewJobDecision(jobId, decision, rejectionReason = null) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const _id = new ObjectId(jobId);

    const existing = await jobsCollection.findOne(
        { _id },
        { projection: { Status: 1, approvalMethod: 1, JobTitle: 1 } },
    );
    const wasAutoPublished = existing?.Status === 'active' && existing?.approvalMethod === 'ai_auto';

    let newStatus = 'pending_review';
    if (decision === 'accept') newStatus = 'active';
    if (decision === 'reject') newStatus = 'rejected';

    const now = new Date();
    const fields = {
        Status: newStatus,
        reviewedAt: now
    };
    // Confirming an auto-published job must not relabel it as a manual approval —
    // the stats depend on approvalMethod recording how it originally went live.
    if (decision === 'accept' && !wasAutoPublished) fields.approvalMethod = 'manual';
    if (decision === 'reject') {
        fields.rejectedAt = now;
        if (rejectionReason) fields.RejectionReason = rejectionReason;
    }

    await jobsCollection.updateOne({ _id }, { $set: fields });
    return {
        success: true,
        status: newStatus,
        wasAutoPublished,
        JobTitle: existing?.JobTitle || '',
    };
}

export async function getJobsEligibleForReanalysis() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    return await jobsCollection.find({
        Status: { $in: ['pending_review', 'active', 'rejected'] },
        sourceSite: { $ne: 'Curated' }
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

export async function updateJobAfterReanalysis(jobId, aiResult, status, rejectionReason, domain, subDomain) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    await jobsCollection.updateOne(
        { _id: new ObjectId(jobId) },
        {
            $set: {
                GermanRequired: aiResult.german_required,
                Domain: domain,
                SubDomain: subDomain,
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
