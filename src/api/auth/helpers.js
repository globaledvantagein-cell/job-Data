import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { linkVisitorToUser, getUserProfile } from '../../db/index.js';
import { GOOGLE_CLIENT_ID } from '../../env.js';
import { sendEmail } from '../../email/index.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

/**
 * Issue a JWT and link the current visitor (if any) to the user.
 */
export async function finalizeLogin(req, user) {
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

/**
 * Fire-and-forget email send. Never crashes the auth flow.
 */
export function sendEmailQuietly(emailData) {
    sendEmail(emailData).then(result => {
        if (result.ok) {
            console.log(`[Email] ✅ Sent "${emailData.subject}" to ${emailData.to}`);
        } else {
            console.error(`[Email] ❌ Failed "${emailData.subject}" to ${emailData.to}: ${result.error}`);
        }
    }).catch(err => {
        console.error(`[Email] ❌ Exception sending to ${emailData.to}:`, err.message);
    });
}

/**
 * Check if a user was created within the last 10 seconds (= new signup).
 * Avoids modifying findOrCreateGoogleUser's return value.
 */
export async function checkIfNewUser(userId) {
    try {
        const profile = await getUserProfile(userId);
        if (!profile?.createdAt) return false;
        const createdAt = new Date(profile.createdAt).getTime();
        return (Date.now() - createdAt) < 10_000; // within 10 seconds
    } catch {
        return false;
    }
}

/**
 * Minimal error page shown by GET /unsubscribe when the token is bad.
 */
export function unsubscribePage(message) {
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
