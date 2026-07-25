import jwt from 'jsonwebtoken';
import { getUserProfile } from '../db/users/auth.js';
import { isPremium } from '../db/users/subscription.js';

const JWT_SECRET = process.env.JWT_SECRET;

// Strict — REJECTS if no/invalid token
export const verifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: "Access Denied. No token provided." });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(400).json({ error: "Invalid Token" });
    }
};

// Admin guard — must run AFTER verifyToken
export const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Access Denied. Admins only." });
    }
};

// Soft — populates req.user IF a valid token is present, otherwise leaves
// req.user undefined and continues. Used by routes that behave differently
// for anonymous vs authenticated users (the gated job-detail endpoint).
export const softVerifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return next();
    try {
        req.user = jwt.verify(token, JWT_SECRET);
    } catch {
        // Invalid token → treat as anonymous, don't reject
    }
    next();
};

// Premium guard — must run AFTER verifyToken. Rejects with 403 unless the user
// has an active premium subscription. Admins are always treated as premium.
// The JWT only carries id/role, so premiumUntil is read from the user doc.
export const requirePremium = async (req, res, next) => {
    try {
        if (req.user?.role === 'admin') return next();

        const user = await getUserProfile(req.user?.id);
        if (isPremium(user)) return next();

        return res.status(403).json({
            error: 'premium_required',
            message: 'This feature requires a Premium subscription.',
        });
    } catch (err) {
        console.error('[requirePremium] Failed:', err.message);
        return res.status(403).json({
            error: 'premium_required',
            message: 'This feature requires a Premium subscription.',
        });
    }
};

// Soft premium flag — must run AFTER softVerifyToken. Never blocks; it just sets
// req.isPremium (boolean) so routes can behave differently for free vs premium
// users (e.g. the JD view endpoint). Anonymous → false; admins → true.
export const attachPremiumStatus = async (req, res, next) => {
    req.isPremium = false;
    try {
        if (req.user?.role === 'admin') {
            req.isPremium = true;
        } else if (req.user?.id) {
            const user = await getUserProfile(req.user.id);
            req.isPremium = isPremium(user);
        }
    } catch (err) {
        // Non-blocking — leave req.isPremium = false and continue.
        console.error('[attachPremiumStatus] Failed:', err.message);
    }
    next();
};