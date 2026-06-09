import { body, validationResult } from 'express-validator';
import {
    getUserProfile,
    updateUserPreferences,
} from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';
import {
    renderSubscriptionConfirmation,
    renderUnsubscribeConfirmation,
} from '../../email/index.js';
import { sendEmailQuietly } from './helpers.js';

export function attachProfileRoutes(authRouter) {
    // ─── Current user ─────────────────────────────────────────────────────
    authRouter.get('/me', verifyToken, async (req, res) => {
        try {
            const user = await getUserProfile(req.user.id);
            if (!user) return res.status(404).json({ error: 'User not found' });
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Update email preferences (Profile page) ──────────────────────────
    // PATCH /api/auth/preferences
    // Body: { desiredCategories?: string[], isSubscribed?: boolean }
    //
    // Detects subscription state changes and sends confirmation emails.
    authRouter.patch('/preferences', verifyToken, [
        body('desiredCategories').optional().isArray(),
        body('isSubscribed').optional().isBoolean(),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            const { desiredCategories, isSubscribed } = req.body;

            // Get current state BEFORE updating, to detect subscription changes
            const before = await getUserProfile(req.user.id);
            if (!before) return res.status(404).json({ error: 'User not found' });

            const updated = await updateUserPreferences(req.user.id, {
                desiredCategories,
                isSubscribed,
            });
            if (!updated) return res.status(404).json({ error: 'User not found' });

            // Send confirmation emails on subscription changes
            const wasSubscribed = Boolean(before.isSubscribed);
            const nowSubscribed = typeof isSubscribed === 'boolean' ? isSubscribed : wasSubscribed;

            if (!wasSubscribed && nowSubscribed) {
                // Just subscribed → subscription confirmation
                try {
                    const cats = Array.isArray(desiredCategories)
                        ? desiredCategories
                        : (updated.desiredCategories || []);
                    const { subject, html, text } = renderSubscriptionConfirmation({
                        name: updated.name || 'there',
                        email: updated.email,
                        categories: cats,
                    });
                    sendEmailQuietly({ to: updated.email, subject, html, text });
                } catch (emailErr) {
                    console.error('[Auth/preferences] Failed to render subscription email:', emailErr.message);
                }
            } else if (wasSubscribed && !nowSubscribed) {
                // Just unsubscribed → unsubscribe confirmation
                try {
                    const { subject, html, text } = renderUnsubscribeConfirmation({
                        name: updated.name || 'there',
                        email: updated.email,
                    });
                    sendEmailQuietly({ to: updated.email, subject, html, text });
                } catch (emailErr) {
                    console.error('[Auth/preferences] Failed to render unsubscribe email:', emailErr.message);
                }
            }

            res.json(updated);
        } catch (error) {
            console.error('[Auth/preferences] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });
}
