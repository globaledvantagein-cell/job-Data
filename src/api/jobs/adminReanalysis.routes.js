import { ObjectId } from 'mongodb';
import {
    findJobById,
    findJobByIdOrJobID,
    connectToDb,
    updateJobAfterReanalysis,
} from '../../db/index.js';
import { upsertJob } from '../../cache/index.js';
import { analyzeJobWithGroq } from '../../gemini/index.js';
import { deriveDomain } from '../../core/jobExtractor.js';
import { categorizeJob } from '../../core/categorize.js';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { isManuallyReviewed } from './helpers.js';

export function attachAdminReanalysisRoutes(router) {

    // Re-analyze ALL AI-accepted jobs in the pending review queue
    router.post('/admin/reanalyze-all', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const db = await connectToDb();
            const jobs = await db.collection('jobs').find({
                Status: 'pending_review',
                GermanRequired: false,
                $or: [{ reviewedAt: { $exists: false } }, { reviewedAt: null }],
                sourceSite: { $ne: 'Curated' }
            }).toArray();

            const summary = { total: jobs.length, reanalyzed: 0, movedToRejected: 0, stillAccepted: 0, failed: 0 };
            console.log(`[Reanalyze All] Checking ${jobs.length} AI-accepted pending_review jobs...`);

            for (const job of jobs) {
                try {
                    const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description);
                    if (!aiResult) { summary.failed += 1; continue; }

                    if (aiResult.german_required === true) {
                        const domain = deriveDomain(job.Department, job.JobTitle);
                        const subDomain = job.Department || 'Other';
                        await updateJobAfterReanalysis(
                            job._id, aiResult, 'rejected', 'German language required', domain, subDomain,
                        );
                        summary.movedToRejected += 1;
                        console.log(`[Reanalyze All] ❌ Caught false accept: "${job.JobTitle}" → rejected`);
                    } else {
                        summary.stillAccepted += 1;
                    }
                    summary.reanalyzed += 1;
                } catch (error) {
                    console.error(`[Reanalyze All] Failed for job ${job?._id}:`, error.message);
                    summary.failed += 1;
                }
            }

            console.log(`[Reanalyze All] Done. Rejected ${summary.movedToRejected} false accepts out of ${summary.total} checked.`);
            res.status(200).json(summary);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Re-analyze a single job by id.
    // After updating the DB, sync the cache: upsertJob handles add/remove
    // automatically based on the new Status field.
    router.post('/admin/reanalyze/:id', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const job = await findJobByIdOrJobID(id);
            if (!job) return res.status(404).json({ error: 'Job not found' });

            if (isManuallyReviewed(job)) {
                return res.status(200).json({
                    skipped: true,
                    reason: 'Job was manually reviewed by admin and cannot be re-analyzed',
                    job
                });
            }

            const oldGermanRequired = Boolean(job.GermanRequired);
            const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description);
            if (!aiResult) return res.status(500).json({ error: 'AI analysis failed' });

            let nextStatus = job.Status || 'pending_review';
            let rejectionReason = job.RejectionReason || null;

            if (!oldGermanRequired && aiResult.german_required === true) {
                nextStatus = 'rejected';
                rejectionReason = 'German language required';
            } else if (oldGermanRequired && aiResult.german_required === false) {
                nextStatus = 'pending_review';
                rejectionReason = null;
            }

            const domain = deriveDomain(job.Department, job.JobTitle);
            const subDomain = job.Department || 'Other';
            const updatedJob = await updateJobAfterReanalysis(job._id, aiResult, nextStatus, rejectionReason, domain, subDomain);

            // ── Cache sync ─ upsertJob inspects Status and adds/removes accordingly
            try { if (updatedJob) upsertJob(updatedJob); }
            catch (cacheErr) { console.warn('[Cache] sync failed after reanalysis:', cacheErr.message); }

            res.status(200).json({ skipped: false, job: updatedJob });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // One-shot analyze: runs AI on a job and updates its fields in MongoDB.
    // Then we re-fetch and sync the cache.
    router.post('/:id/analyze', async (req, res) => {
        try {
            const { id } = req.params;
            const job = await findJobById(id);
            if (!job) return res.status(404).json({ error: "Job not found" });

            const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description, job.Location);
            if (!aiResult) return res.status(500).json({ error: "AI Analysis failed" });

            let newStatus = "pending_review";
            let rejectionReason = null;
            if (aiResult.location_classification !== "Germany") {
                newStatus = "rejected"; rejectionReason = "Location not Germany";
            } else if (aiResult.english_speaking !== true) {
                newStatus = "rejected"; rejectionReason = "Not English-speaking";
            } else if (aiResult.german_required === true) {
                newStatus = "rejected"; rejectionReason = "German Language Required";
            }

            const db = await connectToDb();
            const newDomain = deriveDomain(job.Department, job.JobTitle);
            const newSubDomain = job.Department || 'Other';
            const newCategory = categorizeJob({
                JobTitle: job.JobTitle, Department: job.Department,
                SubDomain: newSubDomain, Domain: newDomain, Tags: job.Tags,
            });

            await db.collection('jobs').updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        EnglishSpeaking: aiResult.english_speaking,
                        GermanRequired: aiResult.german_required,
                        Domain: newDomain,
                        SubDomain: newSubDomain,
                        Category: newCategory,
                        ConfidenceScore: aiResult.confidence,
                        Status: newStatus,
                        RejectionReason: rejectionReason,
                        updatedAt: new Date()
                    }
                }
            );

            // ── Cache sync ─ re-fetch and upsert
            try {
                const updated = await findJobById(id);
                if (updated) upsertJob(updated);
            } catch (cacheErr) { console.warn('[Cache] sync failed after analyze:', cacheErr.message); }

            res.status(200).json({
                message: "Job re-analyzed",
                newStatus,
                english: aiResult.english_speaking,
                german: aiResult.german_required
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
