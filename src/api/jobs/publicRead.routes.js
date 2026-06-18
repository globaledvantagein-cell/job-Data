// All public read endpoints — serve from RAM cache for instant responses.
//
// Flow per request:
//   URL → req.query → filters object → cache helper → toTeaser map → JSON response
//
// No await on cache helpers — they're synchronous (instant from RAM).
import {
    getJobsPaginatedFromCache,
    getCompanyNamesFromCache,
    getCategoryCountsFromCache,
    getPublicBaitJobsFromCache,
} from '../../cache/index.js';

import {
    getCompanyDirectoryStats,
    findJobByIdOrJobID,
    shouldGate,
    recordJobView,
} from '../../db/index.js';
import { softVerifyToken } from '../../middleware/authMiddleware.js';
import { toTeaser } from './helpers.js';

export function attachPublicReadRoutes(router) {

    // ─── Homepage bait — 9 newest jobs for non-logged-in visitors ──────
    router.get('/public-bait', (req, res) => {
        try {
            const jobs = getPublicBaitJobsFromCache();
            res.status(200).json(jobs.map(toTeaser));
        } catch (error) {
            res.status(500).json({ error: "Failed to load bait jobs" });
        }
    });

    // ─── Main jobs list — filtered, sorted, paginated ─────────────────
    router.get('/', (req, res) => {
        try {
            const page  = parseInt(req.query.page)  || 1;
            const limit = Math.min(parseInt(req.query.limit) || 30, 100);

            // `company` can arrive as a single string OR an array
            // (?company=Stripe&company=Shopify → Express gives us an array)
            let company = req.query.company;
            if (!company)                        company = [];
            else if (typeof company === 'string') company = company ? [company] : [];

            let category = req.query.category;
            if (!category)                        category = [];
            else if (typeof category === 'string') category = category ? [category] : [];

            const filters = {
                company,
                category,
                search: req.query.search  || '',
                date:   req.query.date    || 'All',
                sort:   req.query.sort    || 'newest',
            };

            const data = getJobsPaginatedFromCache(page, limit, filters);
            res.status(200).json({
                jobs: (data.jobs || []).map(toTeaser),
                totalJobs: data.totalJobs,
            });
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch jobs" });
        }
    });

    // ─── GATED FULL-DETAIL ENDPOINT ───────────────────────────────────
    // Returns the full job (description, apply URL, salary) IF:
    //   - the user is authenticated, OR
    //   - the visitor is under the free view limit.
    // Otherwise returns { gated: true, teaser: {...} } with no sensitive data.
    //
    // Note: this still hits MongoDB via findJobByIdOrJobID because the route
    // accepts BOTH ObjectId and JobID strings. The cache is keyed by JobID
    // only, so an _id lookup would miss. Cheap to fall back here.
    router.get('/:id/full', softVerifyToken, async (req, res) => {
        try {
            const { id } = req.params;
            const job = await findJobByIdOrJobID(id);
            if (!job) return res.status(404).json({ error: 'Job not found' });

            // Only surface active, English jobs through this endpoint
            if (job.Status !== 'active' || job.GermanRequired === true) {
                return res.status(404).json({ error: 'Job not found' });
            }

            // Authenticated user → always full access
            if (req.user?.id) {
                return res.status(200).json({ gated: false, job });
            }

            // Anonymous → resolve visitor and check gate
            const visitor = await req.resolveVisitor();
            const jobIdString = String(job._id);

            if (shouldGate(visitor, jobIdString)) {
                return res.status(200).json({
                    gated: true,
                    teaser: toTeaser(job),
                });
            }

            await recordJobView(visitor._id, jobIdString);
            return res.status(200).json({ gated: false, job });

        } catch (error) {
            console.error('[Jobs/full] Error:', error);
            res.status(500).json({ error: 'Failed to load job' });
        }
    });

    // ─── Filter dropdown — distinct company names alphabetical ────────
    router.get('/company-names', (req, res) => {
        try {
            const names = getCompanyNamesFromCache();
            res.status(200).json(names);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch company names" });
        }
    });

    // ─── Filter dropdown — counts per category ────────────────────────
    router.get('/category-counts', (req, res) => {
        try {
            const counts = getCategoryCountsFromCache();
            res.status(200).json(counts);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch category counts" });
        }
    });

    // ─── Company directory (scraped + manual companies merged) ────────
    // Still served from MongoDB. It aggregates across two collections
    // (jobs + manual_companies), which the cache doesn't hold. Not worth
    // caching since the directory page is low-traffic.
    router.get('/directory', async (req, res) => {
        try {
            const directory = await getCompanyDirectoryStats();
            res.status(200).json(directory);
        } catch (error) {
            res.status(500).json({ error: "Failed to load directory" });
        }
    });
}
