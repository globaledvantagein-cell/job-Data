import { ObjectId } from 'mongodb';
import {
    findJobById,
    trackApplyClick,
    confirmApplied,
    getAppliedJobIds,
    getAppliedJobsWithDetails,
    getUserProfile,
    isPremium,
    incrementApplyClicks,
} from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';
import { Analytics } from '../../models/analyticsModel.js';

// Per-week apply-click allowance for signed-up free users (premium unlimited).
const FREE_APPLY_LIMIT = 15;

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

            // Global analytics counter fires for EVERY click attempt, including
            // ones that get gated below — keeps the raw metric intact.
            Analytics.increment('applyClicks_total'); // fire-and-forget

            // ── Apply-click metering ─────────────────────────────────────
            const isAdmin = req.user.role === 'admin';
            // Admins skip the DB read; free/premium need the doc for isPremium
            // + weekResetAt (surfaced in the gated usage payload).
            const user = isAdmin ? null : await getUserProfile(req.user.id);

            // Free (non-premium) users are metered. Increment first, then check
            // the RETURNED count: on the 16th click the counter reads 16 (> 15),
            // so we gate WITHOUT tracking the click or leaking the apply URL.
            // Their 15th click was tracked and returned normally.
            if (!isAdmin && !isPremium(user)) {
                const used = await incrementApplyClicks(req.user.id);
                if (used > FREE_APPLY_LIMIT) {
                    return res.status(403).json({
                        gated: true,
                        gateReason: 'apply_limit',
                        usage: { used, limit: FREE_APPLY_LIMIT, resetsAt: user?.weekResetAt ?? null },
                    });
                }
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