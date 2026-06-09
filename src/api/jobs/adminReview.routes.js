import { ObjectId } from 'mongodb';
import {
    getJobsForReview,
    reviewJobDecision,
    getRejectedJobs,
    restoreRejectedJobToQueue,
} from '../../db/index.js';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';

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

    router.patch('/admin/decision/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { decision } = req.body;
            if (!['accept', 'reject'].includes(decision)) {
                return res.status(400).json({ error: "Invalid decision" });
            }
            await reviewJobDecision(id, decision);
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

    router.patch('/admin/restore/:id', verifyToken, verifyAdmin, async (req, res) => {
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
}
