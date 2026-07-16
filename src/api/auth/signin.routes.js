import { body, validationResult } from 'express-validator';
import {
    registerUser,
    loginUser,
    findOrCreateGoogleUser,
    linkVisitorToUser,
    updateUserPreferences,
} from '../../db/index.js';
import { GOOGLE_CLIENT_ID } from '../../env.js';
import {
    renderWelcomeEmail,
    renderSubscriptionConfirmation,
} from '../../email/index.js';
import {
    googleClient,
    finalizeLogin,
    sendEmailQuietly,
    checkIfNewUser,
} from './helpers.js';
import { Analytics } from '../../models/analyticsModel.js';

export function attachSigninRoutes(authRouter) {
    // ─── Talent Pool / Weekly Alerts ──────────────────────────────────────
    // NOT a signup. Email-alerts subscription only.
    authRouter.post('/talent-pool', [
        body('email').isEmail(),
        body('name').notEmpty(),
        body('location').optional(),
        body('desiredCategories').optional().isArray(),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            const { email, name, location, desiredCategories } = req.body;

            const user = await registerUser({
                email, name, location,
                desiredCategories: Array.isArray(desiredCategories) ? desiredCategories : [],
                role: 'user',
                isWaitlist: true,
                password: null,
            });

            try {
                const visitor = await req.resolveVisitor?.();
                if (visitor?._id && user?.id) {
                    await linkVisitorToUser(visitor._id, user.id);
                }
            } catch (err) {
                console.warn('[Auth] Failed to link visitor on talent-pool:', err.message);
            }

            // Send subscription confirmation email
            try {
                const { subject, html, text } = renderSubscriptionConfirmation({
                    name: name || 'there',
                    email,
                    categories: Array.isArray(desiredCategories) ? desiredCategories : [],
                });
                sendEmailQuietly({ to: email, subject, html, text });
            } catch (emailErr) {
                console.error('[Auth] Failed to render subscription email:', emailErr.message);
            }

            res.status(201).json({
                success: true,
                message: 'Successfully joined the talent pool',
            });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // ─── Emergency Password Login (admin-only fallback) ───────────────────
    // UI no longer exposes this. Kept so you can recover admin access if
    // Google OAuth breaks.
    authRouter.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = await loginUser(email, password);
            const token = await finalizeLogin(req, user);
            res.status(200).json({ token, user });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // ─── Google Sign-In — primary auth path for everyone ──────────────────
    //
    // Frontend sends:
    //   { credential: <ID token from @react-oauth/google>,
    //     acceptedTerms: <boolean>,
    //     subscribeToDigest?: <boolean>,
    //     desiredCategories?: <string[]> }
    //
    // First-time users MUST have acceptedTerms === true. Returning users
    // (already in DB) don't need to re-accept.
    authRouter.post('/google', async (req, res) => {
        if (!googleClient) {
            return res.status(503).json({ error: 'Google login not configured on server' });
        }

        try {
            const { credential, acceptedTerms, subscribeToDigest, desiredCategories } = req.body;
            if (!credential) return res.status(400).json({ error: 'Missing credential' });

            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();

            const user = await findOrCreateGoogleUser(payload, {
                acceptedTerms: Boolean(acceptedTerms),
            });
            const token = await finalizeLogin(req, user);

            // Handle optional digest subscription during signup
            const wantsDigest = Boolean(subscribeToDigest);
            const cats = Array.isArray(desiredCategories) ? desiredCategories : [];

            if (wantsDigest && cats.length > 0) {
                try {
                    await updateUserPreferences(user.id, {
                        desiredCategories: cats,
                        isSubscribed: true,
                    });
                } catch (prefErr) {
                    console.error('[Auth/Google] Failed to set digest preferences:', prefErr.message);
                }
            }

            // Determine if this is a NEW user (first sign-in)
            const isNewUser = await checkIfNewUser(user.id);

            if (isNewUser) {
                // New signup via Google — fire-and-forget counters.
                Analytics.increment('signups');
                Analytics.increment('signups_google');

                // Send welcome email
                try {
                    const { subject, html, text } = renderWelcomeEmail({
                        name: user.name || payload.name || 'there',
                        email: user.email || payload.email,
                        isSubscribed: wantsDigest && cats.length > 0,
                        categories: cats,
                    });
                    sendEmailQuietly({ to: user.email || payload.email, subject, html, text });
                } catch (emailErr) {
                    console.error('[Auth/Google] Failed to render welcome email:', emailErr.message);
                }

                // Send separate subscription confirmation if opted in
                if (wantsDigest && cats.length > 0) {
                    try {
                        const { subject, html, text } = renderSubscriptionConfirmation({
                            name: user.name || payload.name || 'there',
                            email: user.email || payload.email,
                            categories: cats,
                        });
                        sendEmailQuietly({ to: user.email || payload.email, subject, html, text });
                    } catch (emailErr) {
                        console.error('[Auth/Google] Failed to render subscription email:', emailErr.message);
                    }
                }
            }

            res.status(200).json({ token, user });
        } catch (error) {
            console.error('[Auth/Google] Failed:', error.message);
            if (error.message?.includes('accept the Terms')) {
                return res.status(400).json({ error: error.message });
            }
            res.status(401).json({ error: 'Google sign-in failed' });
        }
    });
}
