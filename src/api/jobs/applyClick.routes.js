import { ObjectId } from 'mongodb';
import { findJobById, trackApplyClick, confirmApplied, getAppliedJobIds, getAppliedJobsWithDetails } from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';
import { Analytics } from '../../models/analyticsModel.js';

export function attachApplyClickRoute(router) {
    router.post('/:id/apply-click', verifyToken, async (req, res) => {
        try {
            const { id } = req.params;
            const visitorId = req.body?.visitorId || `user_${req.user.id}`;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: 'Invalid job ID' });
            }

            // Fetch the job so we can return its real ApplicationURL — the
            // list endpoint never sent it, so the frontend needs it now.
            const job = await findJobById(id);
            if (!job) return res.status(404).json({ error: 'Job not found' });
            if (job.Status !== 'active' || job.GermanRequired === true) {
                return res.status(404).json({ error: 'Job not found' });
            }

            const result = await trackApplyClick(id, visitorId);
            Analytics.increment('applyClicks_total'); // fire-and-forget
            res.status(200).json({
                ...result,
                applicationUrl: job.ApplicationURL,
                directApplyUrl: job.DirectApplyURL || null,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // User confirms they actually applied (after returning from external ATS)
    router.post('/:id/confirm-applied', verifyToken, async (req, res) => {
        try {
            const { id } = req.params;
            const visitorId = `user_${req.user.id}`;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: 'Invalid job ID' });
            }

            await confirmApplied(id, visitorId);
            res.status(200).json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get all job IDs the user has confirmed-applied to
    router.get('/applied-ids', verifyToken, async (req, res) => {
        try {
            const visitorId = `user_${req.user.id}`;
            const ids = await getAppliedJobIds(visitorId);
            res.status(200).json({ ids });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get full applied jobs with details for the Applied Jobs page
    router.get('/applied', verifyToken, async (req, res) => {
        try {
            const visitorId = `user_${req.user.id}`;
            const jobs = await getAppliedJobsWithDetails(visitorId);
            res.status(200).json({ success: true, jobs });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}