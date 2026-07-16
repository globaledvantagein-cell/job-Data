// ─── SEO Landing Pages ────────────────────────────────────────────────────
//
// Server-rendered HTML (not JSON, not React) so crawlers get real markup in
// the first response. Mounted at the ROOT of the app, not under /api, because
// these are public URLs Google indexes:
//
//   GET /city/:cityName       → English Jobs in {City}
//   GET /category/:categoryName → English {Category} Jobs in Germany
//   GET /sitemap.xml          → every static + city + category URL
//
// DEPLOYMENT: nginx serves the React SPA at these paths today. It must proxy
// /city/, /category/ and /sitemap.xml to this server, and the static
// /var/www/html/sitemap.xml must be removed, or these routes are unreachable.
//
// All three read the RAM cache — no DB round-trip, so crawler traffic is cheap.
import { Router } from 'express';
import { getAllJobs } from '../cache/index.js';
import { CATEGORY_LABELS } from '../core/categorize.js';
import { getCategories, getAllPublishedArticles } from '../db/index.js';
import { findCityBySlug, matchesCity, renderCityPage, renderCategoryPage, renderSitemap } from '../seo/index.js';

export const seoRouter = Router();

// Cap the rendered list. Crawlers don't need every role on one page, and an
// unbounded list would make a 500-job city page enormous.
const MAX_JOBS_PER_PAGE = 100;

/** Newest-first, public-safe jobs from the cache. */
function getPublicJobs() {
    return getAllJobs()
        .filter(job => job.GermanRequired === false)
        .sort((a, b) => {
            const aTime = a.PostedDate ? new Date(a.PostedDate).getTime() : 0;
            const bTime = b.PostedDate ? new Date(b.PostedDate).getTime() : 0;
            return bTime - aTime;
        });
}

seoRouter.get('/city/:cityName', (req, res) => {
    try {
        const city = findCityBySlug(req.params.cityName);
        if (!city) return res.status(404).type('html').send('<!DOCTYPE html><html><head><title>City not found</title><meta name="robots" content="noindex"></head><body><h1>City not found</h1><p><a href="/jobs">Browse all jobs</a></p></body></html>');

        // Count BEFORE slicing — the page reports the true total, not the cap.
        const matched = getPublicJobs().filter(job => matchesCity(job.Location, city));

        res.status(200)
            .type('html')
            .set('Cache-Control', 'public, max-age=3600')
            .send(renderCityPage(city, matched.slice(0, MAX_JOBS_PER_PAGE), matched.length));
    } catch (error) {
        console.error('[SEO/city] Failed:', error.message);
        res.status(500).type('html').send('<!DOCTYPE html><html><body><h1>Something went wrong</h1></body></html>');
    }
});

seoRouter.get('/category/:categoryName', (req, res) => {
    try {
        const category = String(req.params.categoryName || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, category)) {
            return res.status(404).type('html').send('<!DOCTYPE html><html><head><title>Category not found</title><meta name="robots" content="noindex"></head><body><h1>Category not found</h1><p><a href="/jobs">Browse all jobs</a></p></body></html>');
        }

        // Count BEFORE slicing — see the city route.
        const matched = getPublicJobs().filter(job => job.Category === category);

        res.status(200)
            .type('html')
            .set('Cache-Control', 'public, max-age=3600')
            .send(renderCategoryPage(category, matched.slice(0, MAX_JOBS_PER_PAGE), matched.length));
    } catch (error) {
        console.error('[SEO/category] Failed:', error.message);
        res.status(500).type('html').send('<!DOCTYPE html><html><body><h1>Something went wrong</h1></body></html>');
    }
});

seoRouter.get('/sitemap.xml', async (req, res) => {
    try {
        // Career-guide entries come from Mongo; cities/categories are static.
        const [guideCategories, guideArticles] = await Promise.all([
            getCategories(),
            getAllPublishedArticles({ limit: 5000 }),
        ]);

        res.status(200)
            .type('application/xml')
            .set('Cache-Control', 'public, max-age=86400')
            .send(renderSitemap({ guideCategories, guideArticles }));
    } catch (error) {
        console.error('[SEO/sitemap] Failed:', error.message);
        res.status(500).type('text/plain').send('Failed to generate sitemap');
    }
});
