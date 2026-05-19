import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { OAuth2Client } from 'google-auth-library';
import {
    registerUser,
    loginUser,
    getUserProfile,
    findOrCreateGoogleUser,
    linkVisitorToUser,
    unsubscribeUser,
    updateUserPreferences,
} from '../db/index.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { GOOGLE_CLIENT_ID } from '../env.js';
import { verifyUnsubscribeToken } from '../email/index.js';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET;

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

/**
 * Issue a JWT and link the current visitor (if any) to the user.
 */
async function finalizeLogin(req, user) {
    try {
        const visitor = await req.resolveVisitor?.();
        if (visitor?._id) {
            await linkVisitorToUser(visitor._id, user.id);
        }
    } catch (err) {
        console.warn('[Auth] Failed to link visitor:', err.message);
    }
    return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// ─── Talent Pool / Weekly Alerts ──────────────────────────────────────────
// NOT a signup. This is the email-alerts subscription. Kept as-is.
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

        res.status(201).json({
            success: true,
            message: 'Successfully joined the talent pool',
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ─── Emergency Password Login (admin-only fallback) ───────────────────────
// UI no longer exposes this. Kept so you can recover admin access if
// Google OAuth breaks. To use: hit this route directly with curl/Postman.
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

// ─── Google Sign-In — primary auth path for everyone ──────────────────────
//
// Frontend sends:
//   { credential: <ID token from @react-oauth/google>,
//     acceptedTerms: <boolean — true if Terms checkbox was ticked> }
//
// First-time users MUST have acceptedTerms === true. Returning users
// (already in DB) don't need to re-accept — we already have their consent.
authRouter.post('/google', async (req, res) => {
    if (!googleClient) {
        return res.status(503).json({ error: 'Google login not configured on server' });
    }

    try {
        const { credential, acceptedTerms } = req.body;
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

        res.status(200).json({ token, user });
    } catch (error) {
        console.error('[Auth/Google] Failed:', error.message);
        // Surface the terms-rejection message so the frontend can show it
        if (error.message?.includes('accept the Terms')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(401).json({ error: 'Google sign-in failed' });
    }
});

// ─── Current user ─────────────────────────────────────────────────────────
authRouter.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await getUserProfile(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// ─── Update email preferences (Profile page) ──────────────────────────────
// PATCH /api/auth/preferences
// Body: { desiredCategories?: string[], isSubscribed?: boolean }
authRouter.patch('/preferences', verifyToken, [
    body('desiredCategories').optional().isArray(),
    body('isSubscribed').optional().isBoolean(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const { desiredCategories, isSubscribed } = req.body;
        const updated = await updateUserPreferences(req.user.id, {
            desiredCategories,
            isSubscribed,
        });
        if (!updated) return res.status(404).json({ error: 'User not found' });
        res.json(updated);
    } catch (error) {
        console.error('[Auth/preferences] Failed:', error.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ─── Unsubscribe (one-click from email link) ─────────────────────────────
// GET /api/auth/unsubscribe?token=xxx
// No login required. Token is a signed JWT with { email, action: 'unsubscribe' }.
// On success, redirects to the frontend homepage with ?unsubscribed=true so the
// UI can show a toast. On failure, shows a minimal error page.

authRouter.get('/unsubscribe', async (req, res) => {
    const { token } = req.query;
    const baseUrl = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

    if (!token) {
        return res.status(400).send(unsubscribePage('Missing token.'));
    }

    try {
        const email = verifyUnsubscribeToken(token);
        const ok = await unsubscribeUser(email);

        if (!ok) {
            return res.status(404).send(unsubscribePage('Email not found or already unsubscribed.'));
        }

        console.log(`[Unsubscribe] ${email} unsubscribed from weekly digest.`);
        return res.redirect(`${baseUrl}/?unsubscribed=true`);

    } catch (error) {
        console.error('[Unsubscribe] Error:', error.message);
        return res.status(400).send(unsubscribePage('Invalid or expired link. Please contact support@englishjobsgermany.com.'));
    }
});

function unsubscribePage(message) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribe — English Jobs Germany</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e0e0e0;}
.card{text-align:center;max-width:400px;padding:48px 32px;background:#151515;border:1px solid #2a2a2a;border-radius:16px;}
h2{font-size:1.4rem;margin:0 0 12px;}
p{color:#999;line-height:1.6;margin:0 0 24px;font-size:0.9rem;}
a{color:#6C9CFF;text-decoration:none;font-weight:600;}</style></head>
<body><div class="card">
<h2>Oops</h2>
<p>${message}</p>
<a href="https://englishjobsgermany.com">Back to English Jobs Germany</a>
</div></body></html>`;
}