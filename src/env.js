import dotenv from "dotenv";
dotenv.config();


// Gemini API Keys — round-robin rotation
// Set these in your .env file:
//   GEMINI_API_KEY_1=AIzaSy...
//   GEMINI_API_KEY_2=AIzaSy...
//   GEMINI_API_KEY_3=AIzaSy...

export const GEMINI_API_KEYS = [
    process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || null,
    process.env.GEMINI_API_KEY_2 || null,
    process.env.GEMINI_API_KEY_3 || null,
].filter(Boolean);

export const MONGO_URI = process.env.MONGO_URI;


// AWS SES config
export const SES_CONFIG = {
    region: process.env.AWS_SES_REGION || 'eu-west-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    fromEmail: process.env.SES_FROM_EMAIL || '"Job Scraper Bot" <noreply@englishjobsgermany.com>',
};