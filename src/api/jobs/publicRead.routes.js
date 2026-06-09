import {
    getJobsPaginated,
    getCompanyNames,
    getCategoryCounts,
    getPublicBaitJobs,
    getCompanyDirectoryStats,
    findJobByIdOrJobID,
    shouldGate,
    recordJobView,
} from '../../db/index.js';
import { softVerifyToken } from '../../middleware/authMiddleware.js';
import { toTeaser } from './helpers.js';

export function attachPublicReadRoutes(router) {
    router.get('/public-bait', async (req, res) => {
        try {
            const jobs = await getPublicBaitJobs();
            res.status(200).json(jobs.map(toTeaser));
        } catch (error) {
            res.status(500).json({ error: "Failed to load bait jobs" });
        }
    });

    router.get('/', async (req, res) => {
        try {
            const page  = parseInt(req.query.page)  || 1;
            const limit = Math.min(parseInt(req.query.limit) || 30, 100); // hard-cap at 100

            // `company` can arrive as a single string OR as an array
            // (?company=Stripe&company=Shopify → Express gives us an array automatically)
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

            const data = await getJobsPaginated(page, limit, filters);
            res.status(200).json({
                jobs: (data.jobs || []).map(toTeaser),
                totalJobs: data.totalJobs,
            });
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch jobs" });
        }
    });

    // ─── GATED FULL-DETAIL ENDPOINT ─────────────────────────────────────────
    // Returns the full job (description, apply URL, salary) IF:
    //   - the user is authenticated, OR
    //   - the visitor is under the free view limit.
    // Otherwise returns { gated: true, teaser: {...} } with no sensitive data.
    //
    // IMPORTANT: We never include the limit number, remaining count, or any
    // hint of how the gate works. Response is binary: gated or not.
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

            // Under limit → record the view (idempotent) and return full job
            await recordJobView(visitor._id, jobIdString);
            return res.status(200).json({ gated: false, job });

        } catch (error) {
            console.error('[Jobs/full] Error:', error);
            res.status(500).json({ error: 'Failed to load job' });
        }
    });

    // Active company names — populates the filter dropdown.
    router.get('/company-names', async (req, res) => {
        try {
            const names = await getCompanyNames();
            res.status(200).json(names);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch company names" });
        }
    });

    // Per-category job counts — populates the category dropdown.
    // e.g. { software: 533, data: 92, product_tech: 53, ... }
    router.get('/category-counts', async (req, res) => {
        try {
            const counts = await getCategoryCounts();
            res.status(200).json(counts);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch category counts" });
        }
    });

    router.get('/directory', async (req, res) => {
        try {
            const directory = await getCompanyDirectoryStats();
            res.status(200).json(directory);
        } catch (error) {
            res.status(500).json({ error: "Failed to load directory" });
        }
    });
}
