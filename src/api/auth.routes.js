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
} from '../db/index.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { GOOGLE_CLIENT_ID } from '../env.js';

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
    body('domain').notEmpty(),
    body('location').optional(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const { email, name, domain, location } = req.body;

        const user = await registerUser({
            email, name, domain, location,
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
        if (error.message.includes('already exists')) {
            return res.status(200).json({ success: true, message: 'You are already on the list!' });
        }
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