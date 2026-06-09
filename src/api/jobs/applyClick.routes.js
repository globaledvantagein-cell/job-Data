import { ObjectId } from 'mongodb';
import { findJobById, trackApplyClick } from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';

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
            res.status(200).json({
                ...result,
                applicationUrl: job.ApplicationURL,
                directApplyUrl: job.DirectApplyURL || null,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
