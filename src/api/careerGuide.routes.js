// ─── Career Guide — public JSON API ───────────────────────────────────────
//
// Unauthenticated, read-only. Backs the server-rendered public pages at
// /career-guide* in the Next.js frontend. Returns PUBLISHED articles only —
// drafts never leave the admin API (which is behind verifyToken + verifyAdmin).
//
// This exists so SSR needs no admin credential: the previous design had the
// frontend call /api/admin/career-guide with a CAREER_GUIDE_SERVICE_TOKEN,
// which expired (7d JWTs) and silently emptied the public pages.
//
//   GET /api/career-guide             → all published articles
//
import { Router } from 'express';
import { getAllPublishedArticles } from '../db/index.js';

export const careerGuideRouter = Router();

// High limit — return the full published set so the frontend can build the
// hub, category, and article pages from a single fetch. Bump if the guide
// ever grows past this.
const PUBLIC_LIMIT = 500;

careerGuideRouter.get('/', async (req, res) => {
    try {
        const articles = await getAllPublishedArticles({ limit: PUBLIC_LIMIT });
        res.status(200).json({ success: true, articles });
    } catch (error) {
        console.error('[CareerGuide] public list failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load articles' });
    }
});
