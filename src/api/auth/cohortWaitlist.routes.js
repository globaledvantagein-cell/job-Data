// Cohort coaching waitlist — demand-testing feature. The cohort is never real:
// the homepage CTA always shows "this cohort is full, join the waitlist" and we
// measure signups. No email is sent; entries are just stored for the admin.

import { Router } from 'express';
import { connectToDb } from '../../db/connection.js';
import { getUserProfile } from '../../db/index.js';
import { softVerifyToken, verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { Analytics } from '../../models/analyticsModel.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function attachCohortWaitlistRoutes(authRouter) {
    // ─── Join the cohort waitlist ─────────────────────────────────────────
    // POST /api/auth/cohort-waitlist — anonymous allowed (softVerifyToken).
    // Body: { email: string, name?: string }
    authRouter.post('/cohort-waitlist', softVerifyToken, async (req, res) => {
        try {
            const email = String(req.body?.email || '').toLowerCase().trim();
            if (!EMAIL_REGEX.test(email)) {
                return res.status(400).json({ error: 'Please enter a valid email address' });
            }

            let name = typeof req.body?.name === 'string' && req.body.name.trim()
                ? req.body.name.trim()
                : null;
            const userId = req.user?.id || null;

            // Logged-in user without a name in the body → fall back to profile name.
            if (userId && !name) {
                try {
                    const profile = await getUserProfile(userId);
                    name = profile?.name || null;
                } catch { /* profile lookup is best-effort */ }
            }

            const db = await connectToDb();
            const cohortWaitlist = db.collection('cohortWaitlist');

            const existing = await cohortWaitlist.findOne({ email });
            if (existing) {
                return res.status(200).json({
                    alreadyJoined: true,
                    message: "You're already on the waitlist. We'll email you when the next cohort opens.",
                });
            }

            await cohortWaitlist.insertOne({
                email,
                name,
                userId,
                joinedAt: new Date(),
                source: 'homepage',
            });

            await Analytics.increment('totalCohortWaitlist');

            return res.status(200).json({
                success: true,
                message: "You're on the waitlist! We'll email you when the next cohort opens.",
            });
        } catch (error) {
            // Unique-index race (double submit): treat as already joined.
            if (error?.code === 11000) {
                return res.status(200).json({
                    alreadyJoined: true,
                    message: "You're already on the waitlist. We'll email you when the next cohort opens.",
                });
            }
            console.error('[Auth/cohort-waitlist] Failed:', error.message);
            return res.status(500).json({ error: 'Server Error' });
        }
    });
}

// ─── Admin: view the waitlist ─────────────────────────────────────────────
// GET /api/admin/cohort-waitlist — who joined, newest first.
export const cohortWaitlistAdminRouter = Router();

cohortWaitlistAdminRouter.get('/', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();
        const waitlist = await db.collection('cohortWaitlist')
            .find({}, { projection: { _id: 0, email: 1, name: 1, joinedAt: 1, source: 1 } })
            .sort({ joinedAt: -1 })
            .toArray();
        res.status(200).json({ total: waitlist.length, waitlist });
    } catch (error) {
        console.error('[Admin/cohort-waitlist] Failed:', error.message);
        res.status(500).json({ error: 'Server Error' });
    }
});
