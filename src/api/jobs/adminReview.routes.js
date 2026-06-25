import { ObjectId } from 'mongodb';
import {
    getJobsForReview,
    reviewJobDecision,
    getRejectedJobs,
    restoreRejectedJobToQueue,
    findJobByIdOrJobID,
} from '../../db/index.js';
import { upsertJob, removeJob } from '../../cache/index.js';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { extractAndStoreRequirements } from '../../gemma/index.js';

export function attachAdminReviewRoutes(router) {

    router.get('/admin/review', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 50;
            const data = await getJobsForReview(page, limit);
            res.status(200).json(data);
        } catch (error) {
            res.status(500).json({ error: "Failed to load review queue" });
        }
    });

    // Admin accepts/rejects a pending job. After the DB write succeeds,
    // mirror the change into the RAM cache so the public list reflects
    // the decision immediately.
    router.patch('/admin/decision/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { decision } = req.body;
            if (!['accept', 'reject'].includes(decision)) {
                return res.status(400).json({ error: "Invalid decision" });
            }
            await reviewJobDecision(id, decision);

            // ── Cache sync ───────────────────────────────────────────
            // After accept → fetch the updated doc and add to cache.
            // After reject → drop from cache (no need to fetch).
            try {
                if (decision === 'accept') {
                    const updated = await findJobByIdOrJobID(id);
                    if (updated) upsertJob(updated);

                    // Background: extract structured requirements via Gemma 4 31B
                    if (updated && !updated.parsedRequirements) {
                        extractAndStoreRequirements(updated).catch(err =>
                            console.warn('[Gemma] Background extraction error:', err.message)
                        );
                    }
                } else if (decision === 'reject') {
                    // We don't know the JobID without a fetch. Easiest:
                    // fetch by _id, then remove the cache entry by JobID.
                    const updated = await findJobByIdOrJobID(id);
                    if (updated?.JobID) removeJob(updated.JobID);
                }
            } catch (cacheErr) {
                console.warn('[Cache] sync failed after decision:', cacheErr.message);
            }

            res.status(200).json({ message: `Job ${decision}ed successfully` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/rejected', async (req, res) => {
        try {
            const jobs = await getRejectedJobs();
            res.status(200).json(jobs);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Restore a rejected job back to pending_review queue.
    // Pending jobs are NOT in the cache (only active ones are), so we
    // just need to make sure the cache doesn't still hold a stale entry.
    router.patch('/admin/restore/:id', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: 'Invalid ID' });
            }
            await restoreRejectedJobToQueue(id);

            // Defensive: drop from cache in case it was somehow present
            try {
                const updated = await findJobByIdOrJobID(id);
                if (updated?.JobID) removeJob(updated.JobID);
            } catch (cacheErr) {
                console.warn('[Cache] sync failed after restore:', cacheErr.message);
            }

            res.status(200).json({ message: 'Job restored to pending review queue' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
