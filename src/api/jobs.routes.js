import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
    getJobsPaginated,
    addCuratedJob,
    deleteJobById,
    getPublicBaitJobs,
    trackApplyClick,
    getRejectedJobs,
    getCompanyDirectoryStats,
    getJobsForReview,
    reviewJobDecision,
    findJobById,
    findJobByIdOrJobID,
    getJobsEligibleForReanalysis,
    countManuallyReviewedJobs,
    updateJobAfterReanalysis,
    restoreRejectedJobToQueue,
    cleanAllDescriptions,
    deleteJobsByCompany,
    connectToDb
} from '../db/index.js';

import { analyzeJobWithGroq } from '../gemini/index.js';
import { deriveDomain, deriveExperienceLevelFromTitle, deriveIsEntryLevelFromTitle } from '../core/jobExtractor.js';
// ✅ FIXED: Import the correct middleware names
import { verifyToken, verifyAdmin } from '../middleware/authMiddleware.js';

export const jobsApiRouter = Router();

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Re-use the canonical implementation from core/jobExtractor.js via imports above.
// Route-specific aliases for backward compatibility:
const deriveExperienceFromTitle = deriveExperienceLevelFromTitle;
const isEntryLevelTitle = deriveIsEntryLevelFromTitle;

function deriveWorkplaceType(workplaceType, location = '', description = '') {
    const current = String(workplaceType || '').trim();
    if (current && current.toLowerCase() !== 'unspecified') {
        return current;
    }

    const haystack = `${String(location).toLowerCase()} ${String(description).toLowerCase().slice(0, 500)}`;

    if (haystack.includes('remote') || haystack.includes('fully remote') || haystack.includes('work from home')) {
        return 'Remote';
    }

    if (haystack.includes('hybrid')) {
        return 'Hybrid';
    }

    return 'Unspecified';
}

async function backfillExperienceForCollection(collection) {
    const documents = await collection.find({
        $or: [
            { ExperienceLevel: 'N/A' },
            { ExperienceLevel: { $exists: false } },
            { ExperienceLevel: null }
        ]
    }).toArray();

    let updated = 0;

    for (const document of documents) {
        const title = document.JobTitle || '';
        const experienceLevel = deriveExperienceFromTitle(title);
        const isEntryLevel = isEntryLevelTitle(title);
        const workplaceType = deriveWorkplaceType(document.WorkplaceType, document.Location, document.Description);

        await collection.updateOne(
            { _id: document._id },
            {
                $set: {
                    ExperienceLevel: experienceLevel,
                    isEntryLevel,
                    WorkplaceType: workplaceType
                }
            }
        );

        updated += 1;
    }

    return { total: documents.length, updated };
}

function isManuallyReviewed(job) {
    const reviewed = job?.reviewedAt !== undefined && job?.reviewedAt !== null;
    if (!reviewed) return false;
    return job?.Status === 'active' || job?.Status === 'rejected';
}

// ---------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------

jobsApiRouter.get('/public-bait', async (req, res) => {
    try {
        const jobs = await getPublicBaitJobs();
        res.status(200).json(jobs);
    } catch (error) {
        res.status(500).json({ error: "Failed to load bait jobs" });
    }
});

jobsApiRouter.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const company = req.query.company || null;
        const data = await getJobsPaginated(page, limit, company);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch jobs" });
    }
});

jobsApiRouter.get('/directory', async (req, res) => {
    try {
        const directory = await getCompanyDirectoryStats();
        res.status(200).json(directory);
    } catch (error) {
        res.status(500).json({ error: "Failed to load directory" });
    }
});

// ---------------------------------------------------------
// ADMIN ROUTES
// ---------------------------------------------------------

jobsApiRouter.get('/admin/review', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const data = await getJobsForReview(page, limit);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: "Failed to load review queue" });
    }
});

jobsApiRouter.patch('/admin/decision/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { decision } = req.body;
        if (!['accept', 'reject'].includes(decision)) return res.status(400).json({ error: "Invalid decision" });
        await reviewJobDecision(id, decision);
        res.status(200).json({ message: `Job ${decision}ed successfully` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.get('/rejected', async (req, res) => {
    try {
        const jobs = await getRejectedJobs();
        res.status(200).json(jobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/:id/apply-click', async (req, res) => {
    try {
        const { id } = req.params;
        const { visitorId } = req.body;

        if (!visitorId) {
            return res.status(400).json({ error: 'visitorId required' });
        }

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        const result = await trackApplyClick(id, visitorId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/admin/reanalyze-all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();

        // ── Target: ONLY jobs the AI said "OK" to but admin hasn't reviewed yet ──
        // Status:        pending_review   (AI accepted, sitting in review queue)
        // GermanRequired: false           (AI said no German needed — we're double-checking this)
        // reviewedAt:     null/missing    (admin has NOT manually approved or rejected)
        // sourceSite:     not Curated     (skip manually added jobs)
        const jobs = await db.collection('jobs').find({
            Status: 'pending_review',
            GermanRequired: false,
            $or: [{ reviewedAt: { $exists: false } }, { reviewedAt: null }],
            sourceSite: { $ne: 'Curated' }
        }).toArray();

        const summary = {
            total: jobs.length,
            reanalyzed: 0,
            movedToRejected: 0,   // AI now says German IS required — was a false accept
            stillAccepted: 0,     // AI confirmed — no German needed, no change
            failed: 0,
        };

        console.log(`[Reanalyze All] Checking ${jobs.length} AI-accepted pending_review jobs...`);

        for (const job of jobs) {
            try {
                const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description);

                if (!aiResult) {
                    summary.failed += 1;
                    continue;
                }

                if (aiResult.german_required === true) {
                    // AI caught a mistake — this job actually requires German
                    const domain = deriveDomain(job.Department, job.JobTitle);
                    const subDomain = job.Department || 'Other';
                    await updateJobAfterReanalysis(
                        job._id,
                        aiResult,
                        'rejected',
                        'German language required',
                        domain,
                        subDomain
                    );
                    summary.movedToRejected += 1;
                    console.log(`[Reanalyze All] ❌ Caught false accept: "${job.JobTitle}" → rejected`);
                } else {
                    // AI confirmed — still no German required, leave it alone
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

jobsApiRouter.post('/admin/reanalyze/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const job = await findJobByIdOrJobID(id);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        if (isManuallyReviewed(job)) {
            return res.status(200).json({
                skipped: true,
                reason: 'Job was manually reviewed by admin and cannot be re-analyzed',
                job
            });
        }

        const oldGermanRequired = Boolean(job.GermanRequired);
        const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description);

        if (!aiResult) {
            return res.status(500).json({ error: 'AI analysis failed' });
        }

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

        res.status(200).json({
            skipped: false,
            job: updatedJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/:id/analyze', async (req, res) => {
    try {
        const { id } = req.params;
        const job = await findJobById(id);
        if (!job) return res.status(404).json({ error: "Job not found" });

        const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description, job.Location);
        if (!aiResult) return res.status(500).json({ error: "AI Analysis failed" });

        let newStatus = "pending_review";
        let rejectionReason = null;

        if (aiResult.location_classification !== "Germany") {
            newStatus = "rejected";
            rejectionReason = "Location not Germany";
        } else if (aiResult.english_speaking !== true) {
            newStatus = "rejected";
            rejectionReason = "Not English-speaking";
        } else if (aiResult.german_required === true) {
            newStatus = "rejected";
            rejectionReason = "German Language Required";
        }

        const db = await connectToDb();

        await db.collection('jobs').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    EnglishSpeaking: aiResult.english_speaking,
                    GermanRequired: aiResult.german_required,
                    Domain: deriveDomain(job.Department, job.JobTitle),
                    SubDomain: job.Department || 'Other',
                    ConfidenceScore: aiResult.confidence,
                    Status: newStatus,
                    RejectionReason: rejectionReason,
                    updatedAt: new Date()
                }
            }
        );

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

jobsApiRouter.delete('/company', async (req, res) => {
    try {
        const { name } = req.query;
        if (name) {
            const result = await deleteJobsByCompany(name);
            return res.status(200).json({ message: `Deleted ${result.deletedCount} jobs for ${name}.` });
        }
        res.status(400).json({ error: "Name required" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/', async (req, res) => {
    try {
        const jobData = req.body;
        const newJob = await addCuratedJob(jobData);
        res.status(201).json(newJob);
    } catch (error) {
        if (error.message.includes('duplicate URL')) return res.status(409).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });
        await deleteJobById(new ObjectId(id));
        res.status(200).json({ message: 'Job deleted.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ✅ TEST LOGS ROUTE - With correct auth middleware and collection name
jobsApiRouter.get('/test-logs', verifyToken, verifyAdmin, async (req, res) => {
    console.log('[API] test-logs route hit');
    try {
        const db = await connectToDb();
        console.log('[API] DB connected');

        // ✅ FIXED: Lowercase 'j' to match your databaseManager.js
        const logs = await db.collection('jobTestLogs')
            .find({})
            .sort({ scrapedAt: -1 })
            .limit(500)
            .toArray();

        console.log('[API] Found logs:', logs.length);
        res.status(200).json(logs);
    } catch (error) {
        console.error('[API] Error fetching test logs:', error);
        res.status(500).json({ error: 'Failed to fetch test logs', details: error.message });
    }
});

jobsApiRouter.patch('/admin/restore/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        await restoreRejectedJobToQueue(id);
        res.status(200).json({ message: 'Job restored to pending review queue' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/admin/clean-descriptions', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const summary = await cleanAllDescriptions();
        res.status(200).json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/admin/fix-salaries', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();
        const jobsCollection = db.collection('jobs');

        const jobs = await jobsCollection.find({
            $or: [
                { SalaryMin: { $gt: 0, $lt: 1000 } },
                { SalaryMax: { $gt: 0, $lt: 1000 } }
            ]
        }).toArray();

        let fixed = 0;

        for (const job of jobs) {
            const update = {};

            if (job.SalaryMin && job.SalaryMin > 0 && job.SalaryMin < 1000) {
                update.SalaryMin = job.SalaryMin * 1000;
            }

            if (job.SalaryMax && job.SalaryMax > 0 && job.SalaryMax < 1000) {
                update.SalaryMax = job.SalaryMax * 1000;
            }

            if (Object.keys(update).length > 0) {
                await jobsCollection.updateOne({ _id: job._id }, { $set: update });
                fixed += 1;
            }
        }

        res.status(200).json({ total: jobs.length, fixed });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/admin/backfill-experience', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();
        const jobsSummary = await backfillExperienceForCollection(db.collection('jobs'));
        const logsSummary = await backfillExperienceForCollection(db.collection('jobTestLogs'));

        res.status(200).json({
            total: jobsSummary.total,
            updated: jobsSummary.updated,
            logsTotal: logsSummary.total,
            logsUpdated: logsSummary.updated,
            message: 'Backfill complete'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



jobsApiRouter.patch('/admin/update/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        const allowedFields = ['Location', 'Company', 'JobTitle', 'WorkplaceType'];
        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        updates.updatedAt = new Date();

        const db = await connectToDb();
        await db.collection('jobs').updateOne(
            { _id: new ObjectId(id) },
            { $set: updates }
        );

        const updated = await db.collection('jobs').findOne({ _id: new ObjectId(id) });
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});