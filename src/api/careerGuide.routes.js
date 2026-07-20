// ─── Career Guide — public JSON API ───────────────────────────────────────
//
// Unauthenticated, read-only. Backs the server-rendered public pages at
// /career-guide* in the Next.js frontend. Returns PUBLISHED articles only —
// drafts never leave the admin API (which is behind verifyToken + verifyAdmin).
//
// This exists so SSR needs NO admin credential: the previous design had the
// frontend call /api/admin/career-guide with a CAREER_GUIDE_SERVICE_TOKEN
// (a 7-day JWT) that expired and silently emptied the public pages.
//
//   GET /api/career-guide/public                  → all published articles
//   GET /api/career-guide/public/:category        → published in a category
//   GET /api/career-guide/public/article/:slug    → single published article
//
import { Router } from 'express';
import {
    getAllPublishedArticles,
    getArticlesByCategory,
    getArticleBySlug,
} from '../db/index.js';

export const careerGuideRouter = Router();

// High limit — return the full published set so the frontend can build the
// hub and category pages from a single fetch. Bump if the guide ever grows past this.
const PUBLIC_LIMIT = 500;

careerGuideRouter.get('/public', async (req, res) => {
    try {
        const articles = await getAllPublishedArticles({ limit: PUBLIC_LIMIT });
        res.status(200).json({ success: true, articles });
    } catch (error) {
        console.error('[CareerGuide] public list failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load articles' });
    }
});

// Single article by slug. Placed before the /:category route is irrelevant
// (different path depth), but the "article" segment keeps the two unambiguous.
careerGuideRouter.get('/public/article/:slug', async (req, res) => {
    try {
        const article = await getArticleBySlug(req.params.slug);
        if (!article) return res.status(404).json({ success: false, error: 'Article not found' });
        res.status(200).json({ success: true, article });
    } catch (error) {
        console.error('[CareerGuide] public article failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load article' });
    }
});

careerGuideRouter.get('/public/:category', async (req, res) => {
    try {
        const articles = await getArticlesByCategory(req.params.category, { limit: PUBLIC_LIMIT });
        res.status(200).json({ success: true, articles });
    } catch (error) {
        console.error('[CareerGuide] public category failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load articles' });
    }
});
