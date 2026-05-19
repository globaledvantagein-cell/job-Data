/**
 * One-click unsubscribe tokens.
 *
 * Each digest email contains a personalized unsubscribe URL signed with our
 * JWT_SECRET. When a user clicks, the backend verifies the token, flips
 * isSubscribed: false on their user doc, and shows a confirmation page.
 *
 * No login required. Tokens expire after 1 year — plenty of time, and any
 * legitimate digest email will use a fresh one anyway.
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '365d';

if (!JWT_SECRET) {
    console.warn('[email/unsubscribe] JWT_SECRET not set — unsubscribe links will fail.');
}

/**
 * Generate a signed unsubscribe token for an email address.
 * @param {string} email
 * @returns {string} JWT
 */
export function generateUnsubscribeToken(email) {
    return jwt.sign({ email, action: 'unsubscribe' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * Verify an unsubscribe token. Throws if invalid/expired.
 * @param {string} token
 * @returns {string} the email address from the token
 */
export function verifyUnsubscribeToken(token) {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.action !== 'unsubscribe' || !payload.email) {
        throw new Error('Invalid unsubscribe token payload');
    }
    return payload.email;
}

/**
 * Build the full unsubscribe URL the user clicks in the email.
 */
export function buildUnsubscribeUrl(email, baseUrl) {
    const token = generateUnsubscribeToken(email);
    const base = baseUrl || process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';
    return `${base}/api/auth/unsubscribe?token=${encodeURIComponent(token)}`;
}