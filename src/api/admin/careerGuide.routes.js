// ─── Career Guide — admin JSON API ────────────────────────────────────────
//
// JSON (not SSR) — this backs the React admin editor at /admin/career-guide.
// Every route is behind verifyToken + verifyAdmin.
//
//   GET    /api/admin/career-guide             → all articles incl. drafts
//   GET    /api/admin/career-guide/:id         → single article for editing
//   POST   /api/admin/career-guide             → create
//   PATCH  /api/admin/career-guide/:id         → update
//   DELETE /api/admin/career-guide/:id         → delete
//   PATCH  /api/admin/career-guide/:id/publish → status=published
//   PATCH  /api/admin/career-guide/:id/unpublish → status=draft
import { Router } from 'express';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import {
    createArticle,
    updateArticle,
    deleteArticle,
    getArticleById,
    getAllArticlesAdmin,
    publishArticle,
    unpublishArticle,
} from '../../db/index.js';

export const adminCareerGuideRouter = Router();

// Guard the whole router rather than repeating the pair on every route.
adminCareerGuideRouter.use(verifyToken, verifyAdmin);

adminCareerGuideRouter.get('/', async (req, res) => {
    try {
        const articles = await getAllArticlesAdmin();
        res.status(200).json({ success: true, articles });
    } catch (error) {
        console.error('[Admin/CareerGuide] list failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load articles' });
    }
});

adminCareerGuideRouter.get('/:id', async (req, res) => {
    try {
        const article = await getArticleById(req.params.id);
        if (!article) return res.status(404).json({ success: false, error: 'Article not found' });
        res.status(200).json({ success: true, article });
    } catch (error) {
        console.error('[Admin/CareerGuide] get failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load article' });
    }
});

adminCareerGuideRouter.post('/', async (req, res) => {
    try {
        const article = await createArticle(req.body || {});
        res.status(201).json({ success: true, article });
    } catch (error) {
        // createArticle throws on missing title / bad category — that's a 400,
        // not a server fault.
        console.error('[Admin/CareerGuide] create failed:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

adminCareerGuideRouter.patch('/:id', async (req, res) => {
    try {
        const existing = await getArticleById(req.params.id);
        if (!existing) return res.status(404).json({ success: false, error: 'Article not found' });

        const article = await updateArticle(req.params.id, req.body || {});
        res.status(200).json({ success: true, article });
    } catch (error) {
        console.error('[Admin/CareerGuide] update failed:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

adminCareerGuideRouter.delete('/:id', async (req, res) => {
    try {
        const deleted = await deleteArticle(req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: 'Article not found' });
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[Admin/CareerGuide] delete failed:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

adminCareerGuideRouter.patch('/:id/publish', async (req, res) => {
    try {
        const article = await publishArticle(req.params.id);
        if (!article) return res.status(404).json({ success: false, error: 'Article not found' });
        res.status(200).json({ success: true, article });
    } catch (error) {
        console.error('[Admin/CareerGuide] publish failed:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

adminCareerGuideRouter.patch('/:id/unpublish', async (req, res) => {
    try {
        const article = await unpublishArticle(req.params.id);
        if (!article) return res.status(404).json({ success: false, error: 'Article not found' });
        res.status(200).json({ success: true, article });
    } catch (error) {
        console.error('[Admin/CareerGuide] unpublish failed:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});
