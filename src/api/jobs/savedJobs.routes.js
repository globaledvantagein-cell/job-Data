import { ObjectId } from 'mongodb';
import {
    findJobById,
    saveJob,
    unsaveJob,
    getSavedJobIds,
    getSavedJobsWithDetails,
} from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';

export function attachSavedJobsRoutes(router) {

    // Save a job for the current user. Idempotent — re-saving returns saved:false.
    router.post('/:id/save', verifyToken, async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: 'Invalid job ID' });
            }

            // Only allow saving jobs that are actually visible to users —
            // same guard the apply-click route uses.
            const job = await findJobById(id);
            if (!job) return res.status(404).json({ error: 'Job not found' });
            if (job.Status !== 'active' || job.GermanRequired === true) {
                return res.status(404).json({ error: 'Job not found' });
            }

            const saved = await saveJob(req.user.id, id);
            res.status(200).json({ success: true, saved });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Unsave a job. Idempotent — unsaving something not saved returns removed:false.
    router.delete('/:id/save', verifyToken, async (req, res) => {
        try {
            const { id } = req.params;

            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: 'Invalid job ID' });
            }

            const removed = await unsaveJob(req.user.id, id);
            res.status(200).json({ success: true, removed });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // All saved job IDs — used to hydrate the bookmark state on load.
    router.get('/saved-ids', verifyToken, async (req, res) => {
        try {
            const ids = await getSavedJobIds(req.user.id);
            res.status(200).json({ ids });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Full saved jobs with details for the Profile page.
    router.get('/saved', verifyToken, async (req, res) => {
        try {
            const jobs = await getSavedJobsWithDetails(req.user.id);
            res.status(200).json({ success: true, jobs });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
