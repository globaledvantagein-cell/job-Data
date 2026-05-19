import dotenv from "dotenv";
dotenv.config();


// Gemini API Keys — round-robin rotation
export const GEMINI_API_KEYS = [
    process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || null,
    process.env.GEMINI_API_KEY_2 || null,
    process.env.GEMINI_API_KEY_3 || null,
].filter(Boolean);

export const MONGO_URI = process.env.MONGO_URI;


// AWS SES config
export const SES_CONFIG = {
    region: process.env.SES_REGION || 'eu-central-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    fromEmail: process.env.SES_FROM_EMAIL || 'noreply@englishjobsgermany.com',
    fromName: process.env.SES_FROM_NAME || 'English Jobs Germany',
};


// ── Signup Gate ───────────────────────────────────────────────────────────
// FREE_VIEW_LIMIT: distinct full-job views before gating. NEVER expose to client.
// NEW_VISITOR_RATE_LIMIT_PER_HOUR: anti-bypass rate limit on new visitor creation.
// VISITOR_IP_SALT: REQUIRED random string for hashing IPs.
//   Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// FRONTEND_ORIGIN: needed for CORS with credentials (cookies + JWT).
export const FREE_VIEW_LIMIT = Number(process.env.FREE_VIEW_LIMIT) || 20;
export const NEW_VISITOR_RATE_LIMIT_PER_HOUR = Number(process.env.NEW_VISITOR_RATE_LIMIT_PER_HOUR) || 20;
export const VISITOR_IP_SALT = process.env.VISITOR_IP_SALT;
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// ── Google OAuth ──────────────────────────────────────────────────────────
// Web Client ID from Google Cloud Console. Same value as VITE_GOOGLE_CLIENT_ID.
// We use the ID-token flow, so no client secret is needed.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!VISITOR_IP_SALT) {
    console.warn('[env] ⚠️  VISITOR_IP_SALT not set — IP hashing will be insecure.');
}
if (!GOOGLE_CLIENT_ID) {
    console.warn('[env] ⚠️  GOOGLE_CLIENT_ID not set — Google login will not work.');
}