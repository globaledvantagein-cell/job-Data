import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
    getJobsPaginated,
    getCompanyNames,
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
    connectToDb,
    shouldGate,
    recordJobView,
} from '../db/index.js';

import { analyzeJobWithGroq } from '../gemini/index.js';
import { deriveDomain, deriveExperienceLevelFromTitle, deriveIsEntryLevelFromTitle } from '../core/jobExtractor.js';
import { verifyToken, verifyAdmin, softVerifyToken } from '../middleware/authMiddleware.js';

export const jobsApiRouter = Router();

// ── Field-stripping helper ────────────────────────────────────────────────
// The list endpoint must NOT return description, apply URLs, or full salary
// details — those are gated. We only ship enough to render a card: title,
// company, location, dept, posted date, badges, click count.
function toTeaser(job) {
    if (!job) return null;
    return {
        _id: job._id,
        JobID: job.JobID,
        JobTitle: job.JobTitle,
        Company: job.Company,
        Location: job.Location,
        Department: job.Department,
        Domain: job.Domain,
        SubDomain: job.SubDomain,
        WorkplaceType: job.WorkplaceType,
        EmploymentType: job.EmploymentType,
        ExperienceLevel: job.ExperienceLevel,
        isEntryLevel: job.isEntryLevel,
        ContractType: job.ContractType,
        Tags: job.Tags,
        PostedDate: job.PostedDate,
        scrapedAt: job.scrapedAt,
        applyClicks: job.applyClicks || 0,
        ATSPlatform: job.ATSPlatform,
        sourceSite: job.sourceSite,
        // Deliberately omitted: Description, DescriptionHtml,
        // ApplicationURL, DirectApplyURL, SalaryMin, SalaryMax,
        // SalaryCurrency, SalaryInterval
    };
}

// ── Tiny re-used helpers from original ────────────────────────────────────
const deriveExperienceFromTitle = deriveExperienceLevelFromTitle;
const isEntryLevelTitle = deriveIsEntryLevelFromTitle;

function deriveWorkplaceType(workplaceType, location = '', description = '') {
    const current = String(workplaceType || '').trim();
    if (current && current.toLowerCase() !== 'unspecified') return current;

    const haystack = `${String(location).toLowerCase()} ${String(description).toLowerCase().slice(0, 500)}`;
    if (haystack.includes('remote') || haystack.includes('fully remote') || haystack.includes('work from home')) return 'Remote';
    if (haystack.includes('hybrid')) return 'Hybrid';
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
            { $set: { ExperienceLevel: experienceLevel, isEntryLevel, WorkplaceType: workplaceType } }
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

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────

jobsApiRouter.get('/public-bait', async (req, res) => {
    try {
        const jobs = await getPublicBaitJobs();
        // public-bait already projects safe fields; pass through to teaser anyway
        res.status(200).json(jobs.map(toTeaser));
    } catch (error) {
        res.status(500).json({ error: "Failed to load bait jobs" });
    }
});

// LIST endpoint — returns teasers only. No description/apply URL/salary.
jobsApiRouter.get('/', async (req, res) => {
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);

        let company = req.query.company;
        if (!company)                        company = [];
        else if (typeof company === 'string') company = company ? [company] : [];

        const filters = {
            company,
            search: req.query.search  || '',
            date:   req.query.date    || 'All',
            sort:   req.query.sort    || 'newest',
        };

        const data = await getJobsPaginated(page, limit, filters);
        res.status(200).json({
            jobs: (data.jobs || []).map(toTeaser),
            totalJobs: data.totalJobs,
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch jobs" });
    }
});

jobsApiRouter.get('/company-names', async (req, res) => {
    try {
        const names = await getCompanyNames();
        res.status(200).json(names);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch company names" });
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

// ─────────────────────────────────────────────────────────────────────────
// GATED FULL-DETAIL ENDPOINT
// ─────────────────────────────────────────────────────────────────────────
// Returns the full job (description, apply URL, salary) IF:
//   - the user is authenticated, OR
//   - the visitor is under the free view limit.
// Otherwise returns { gated: true, teaser: { ... } } with no sensitive data.
//
// IMPORTANT: We never include the limit number, remaining count, or any
// hint of how the gate works. The response is binary: gated or not.
jobsApiRouter.get('/:id/full', softVerifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const job = await findJobByIdOrJobID(id);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        // Only surface active, English jobs through this endpoint
        if (job.Status !== 'active' || job.GermanRequired === true) {
            return res.status(404).json({ error: 'Job not found' });
        }

        // Authenticated user → always full access
        if (req.user?.id) {
            return res.status(200).json({ gated: false, job });
        }

        // Anonymous → resolve visitor and check gate
        const visitor = await req.resolveVisitor();
        const jobIdString = String(job._id);

        if (shouldGate(visitor, jobIdString)) {
            return res.status(200).json({
                gated: true,
                teaser: toTeaser(job),
            });
        }

        // Under limit → record the view (idempotent) and return full job
        await recordJobView(visitor._id, jobIdString);
        return res.status(200).json({ gated: false, job });

    } catch (error) {
        console.error('[Jobs/full] Error:', error);
        res.status(500).json({ error: 'Failed to load job' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// APPLY-CLICK — now requires auth. Highest-value action, always gated.
// ─────────────────────────────────────────────────────────────────────────
jobsApiRouter.post('/:id/apply-click', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const visitorId = req.body?.visitorId || `user_${req.user.id}`;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid job ID' });
        }

        // Also fetch the job to return its real ApplicationURL — the list
        // endpoint never sent it, so the frontend will need it now.
        const job = await findJobById(id);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        if (job.Status !== 'active' || job.GermanRequired === true) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const result = await trackApplyClick(id, visitorId);
        res.status(200).json({
            ...result,
            applicationUrl: job.ApplicationURL,
            directApplyUrl: job.DirectApplyURL || null,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/admin/reanalyze-all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();

        const jobs = await db.collection('jobs').find({
            Status: 'pending_review',
            GermanRequired: false,
            $or: [{ reviewedAt: { $exists: false } }, { reviewedAt: null }],
            sourceSite: { $ne: 'Curated' }
        }).toArray();

        const summary = {
            total: jobs.length,
            reanalyzed: 0,
            movedToRejected: 0,
            stillAccepted: 0,
            failed: 0,
        };

        console.log(`[Reanalyze All] Checking ${jobs.length} AI-accepted pending_review jobs...`);

        for (const job of jobs) {
            try {
                const aiResult = await analyzeJobWithGroq(job.JobTitle, job.Description);
                if (!aiResult) { summary.failed += 1; continue; }

                if (aiResult.german_required === true) {
                    const domain = deriveDomain(job.Department, job.JobTitle);
                    const subDomain = job.Department || 'Other';
                    await updateJobAfterReanalysis(job._id, aiResult, 'rejected', 'German language required', domain, subDomain);
                    summary.movedToRejected += 1;
                } else {
                    summary.stillAccepted += 1;
                }
                summary.reanalyzed += 1;
            } catch (error) {
                console.error(`[Reanalyze All] Failed for job ${job?._id}:`, error.message);
                summary.failed += 1;
            }
        }

        res.status(200).json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jobsApiRouter.post('/admin/reanalyze/:id', verifyToken, verifyAdmin, async (req, res) => {
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

        res.status(200).json({ skipped: false, job: updatedJob });
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
            newStatus = "rejected"; rejectionReason = "Location not Germany";
        } else if (aiResult.english_speaking !== true) {
            newStatus = "rejected"; rejectionReason = "Not English-speaking";
        } else if (aiResult.german_required === true) {
            newStatus = "rejected"; rejectionReason = "German Language Required";
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

jobsApiRouter.get('/test-logs', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();
        const logs = await db.collection('jobTestLogs')
            .find({}).sort({ scrapedAt: -1 }).limit(500).toArray();
        res.status(200).json(logs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch test logs', details: error.message });
    }
});

jobsApiRouter.patch('/admin/restore/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });
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
            if (job.SalaryMin && job.SalaryMin > 0 && job.SalaryMin < 1000) update.SalaryMin = job.SalaryMin * 1000;
            if (job.SalaryMax && job.SalaryMax > 0 && job.SalaryMax < 1000) update.SalaryMax = job.SalaryMax * 1000;
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
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

        const allowedFields = ['Location', 'Company', 'JobTitle', 'WorkplaceType'];
        const updates = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        updates.updatedAt = new Date();

        const db = await connectToDb();
        await db.collection('jobs').updateOne({ _id: new ObjectId(id) }, { $set: updates });

        const updated = await db.collection('jobs').findOne({ _id: new ObjectId(id) });
        res.status(200).json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
