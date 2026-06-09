import { connectToDb } from '../connection.js';
import { StripHtml } from '../../utils.js';

export async function deleteOldJobs(siteName, scrapeStartTime) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    let totalDeleted = 0;

    // ── Rule 1: NEVER delete admin-approved jobs (active + reviewedAt) ──
    // Only removed by URL validator (404 check) or manual admin action.

    // ── Rule 2: NEVER delete curated jobs (sourceSite === "Curated") ──
    // Excluded automatically — siteName comes from SITES_CONFIG, never equals "Curated".

    // ── Rule 3: Delete AI-rejected jobs older than 7 days ──
    const aiRejectedResult = await jobsCollection.deleteMany({
        sourceSite: siteName,
        Status: 'rejected',
        $or: [
            { reviewedAt: { $exists: false } },
            { reviewedAt: null }
        ],
        updatedAt: { $lt: sevenDaysAgo }
    });
    if (aiRejectedResult.deletedCount > 0) {
        console.log(`[${siteName}] 🗑️  Deleted ${aiRejectedResult.deletedCount} AI-rejected jobs (>7 days old)`);
        totalDeleted += aiRejectedResult.deletedCount;
    }

    // ── Rule 4: Delete admin-rejected jobs older than 14 days ──
    const adminRejectedResult = await jobsCollection.deleteMany({
        sourceSite: siteName,
        Status: 'rejected',
        reviewedAt: { $exists: true, $ne: null },
        updatedAt: { $lt: fourteenDaysAgo }
    });
    if (adminRejectedResult.deletedCount > 0) {
        console.log(`[${siteName}] 🗑️  Deleted ${adminRejectedResult.deletedCount} admin-rejected jobs (>14 days old)`);
        totalDeleted += adminRejectedResult.deletedCount;
    }

    // ── Rule 5: Delete pending_review jobs older than 14 days ──
    const pendingResult = await jobsCollection.deleteMany({
        sourceSite: siteName,
        Status: 'pending_review',
        updatedAt: { $lt: fourteenDaysAgo }
    });
    if (pendingResult.deletedCount > 0) {
        console.log(`[${siteName}] 🗑️  Deleted ${pendingResult.deletedCount} stale pending jobs (>14 days old)`);
        totalDeleted += pendingResult.deletedCount;
    }

    // ── Rule 6: Delete auto-approved active jobs (no reviewedAt) older than 14 days ──
    const autoActiveResult = await jobsCollection.deleteMany({
        sourceSite: siteName,
        Status: 'active',
        $or: [
            { reviewedAt: { $exists: false } },
            { reviewedAt: null }
        ],
        updatedAt: { $lt: fourteenDaysAgo }
    });
    if (autoActiveResult.deletedCount > 0) {
        console.log(`[${siteName}] 🗑️  Deleted ${autoActiveResult.deletedCount} auto-active jobs with no review (>14 days old)`);
        totalDeleted += autoActiveResult.deletedCount;
    }

    if (totalDeleted > 0) {
        console.log(`[${siteName}] 🗑️  Total cleanup: ${totalDeleted} jobs deleted`);
    } else {
        console.log(`[${siteName}] ✅ Cleanup: nothing to delete`);
    }

    return totalDeleted;
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

export async function deleteJobsByCompany(companyName) {
    const db = await connectToDb();
    console.log(`[Admin] Deleting all jobs for company: ${companyName}`);
    return await db.collection('jobs').deleteMany({
        Company: { $regex: new RegExp(`^${companyName}$`, 'i') }
    });
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
