// ─── Career Guide — public SSR pages ──────────────────────────────────────
//
// Server-rendered HTML, root-mounted (NOT under /api) because these are public
// URLs Google indexes. Same pattern as the /city and /category SEO routes:
//
//   GET /career-guide                   → hub (categories + recent articles)
//   GET /career-guide/:category         → all published articles in a category
//   GET /career-guide/:category/:slug   → full article
//
// DEPLOYMENT: nginx serves the React SPA at these paths today. It must proxy
// /career-guide and /career-guide/ to this server or these are unreachable.
import { Router } from 'express';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import {
    getCategories,
    getAllPublishedArticles,
    getArticlesByCategory,
    getArticleBySlug,
    CAREER_GUIDE_CATEGORY_LABELS,
} from '../db/index.js';
import {
    renderGuideHub,
    renderGuideCategory,
    renderGuideArticle,
} from '../seo/careerGuideTemplates.js';

export const careerGuideRouter = Router();

const RECENT_ON_HUB = 6;

// marked renders markdown → HTML but does NOT sanitise: a raw <script> in the
// content would execute for every visitor. sanitize-html runs on the output
// with a blog allowlist — links and images survive, scripts and handlers don't.
const SANITIZE_OPTIONS = {
    allowedTags: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'ul', 'ol', 'li', 'br', 'hr',
        'strong', 'em', 'b', 'i', 'del', 'blockquote',
        'a', 'img', 'code', 'pre',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
        a: ['href', 'title', 'target', 'rel'],
        img: ['src', 'alt', 'title', 'loading'],
        code: ['class'],   // marked adds language-* for syntax highlighting
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Outbound links open in a new tab and can't reach window.opener.
    transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
        img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }),
    },
};

/** Markdown → safe HTML. The only place article content becomes markup. */
export function renderMarkdown(markdown) {
    const rawHtml = marked.parse(String(markdown || ''), { async: false });
    return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}

function notFoundPage(heading) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title><meta name="robots" content="noindex"></head><body><h1>${heading}</h1><p><a href="/career-guide">Back to the Career Guide</a></p></body></html>`;
}

const CACHE_HEADER = 'public, max-age=3600';

careerGuideRouter.get('/career-guide', async (req, res) => {
    try {
        const [categories, recent] = await Promise.all([
            getCategories(),
            getAllPublishedArticles({ limit: RECENT_ON_HUB }),
        ]);

        res.status(200)
            .type('html')
            .set('Cache-Control', CACHE_HEADER)
            .send(renderGuideHub(categories, recent));
    } catch (error) {
        console.error('[CareerGuide/hub] Failed:', error.message);
        res.status(500).type('html').send(notFoundPage('Something went wrong'));
    }
});

careerGuideRouter.get('/career-guide/:category', async (req, res) => {
    try {
        const category = String(req.params.category || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(CAREER_GUIDE_CATEGORY_LABELS, category)) {
            return res.status(404).type('html').send(notFoundPage('Category not found'));
        }

        const articles = await getArticlesByCategory(category);

        res.status(200)
            .type('html')
            .set('Cache-Control', CACHE_HEADER)
            .send(renderGuideCategory(category, articles));
    } catch (error) {
        console.error('[CareerGuide/category] Failed:', error.message);
        res.status(500).type('html').send(notFoundPage('Something went wrong'));
    }
});

careerGuideRouter.get('/career-guide/:category/:slug', async (req, res) => {
    try {
        const category = String(req.params.category || '').trim().toLowerCase();
        const article = await getArticleBySlug(req.params.slug);

        // Unknown slug, or a draft (getArticleBySlug filters to published).
        if (!article) {
            return res.status(404).type('html').send(notFoundPage('Article not found'));
        }

        // Slug is globally unique, so a mismatched category means a stale or
        // hand-edited URL. Redirect to the canonical one rather than serving
        // the same article on two URLs (duplicate content).
        if (article.category !== category) {
            return res.redirect(301, `/career-guide/${article.category}/${article.slug}`);
        }

        res.status(200)
            .type('html')
            .set('Cache-Control', CACHE_HEADER)
            .send(renderGuideArticle(article, renderMarkdown(article.content)));
    } catch (error) {
        console.error('[CareerGuide/article] Failed:', error.message);
        res.status(500).type('html').send(notFoundPage('Something went wrong'));
    }
});
