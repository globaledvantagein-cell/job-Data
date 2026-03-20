import dotenv from "dotenv";
dotenv.config();

// Groq API Keys — round-robin rotation
// Set these in your .env file:
//   GROQ_API_KEY_1=gsk_xxxxx
//   GROQ_API_KEY_2=gsk_yyyyy
//   GROQ_API_KEY_3=gsk_zzzzz
//
// Falls back to GEMINI_API_KEY for backward compatibility if the new keys are not set.
const fallbackKey = process.env.GEMINI_API_KEY || null;

export const GROQ_API_KEYS = [
    process.env.GROQ_API_KEY_1 || fallbackKey,
    process.env.GROQ_API_KEY_2 || null,
    process.env.GROQ_API_KEY_3 || null,
].filter(Boolean); // Remove any null/undefined entries

// If no new keys are set, this array will contain just the old fallback key (backward compatible)
// If 1 key is set, array has 1 entry. If 3 keys are set, array has 3 entries.

// Keep the old single export for any other code that might use it
export const GROQ_API_KEY = GROQ_API_KEYS[0] || null;

export const MONGO_URI = process.env.MONGO_URI;

export const EMAIL_CONFIG = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'ashar050488@gmail.com',
        pass: process.env.pass 
    },
    to: 'ashishar050488@gmail.com',
    from: '"Job Scraper Bot" <ashar050488@gmail.com>'
};