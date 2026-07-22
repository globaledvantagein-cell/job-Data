// All public read endpoints — serve from RAM cache for instant responses.
//
// Flow per request:
//   URL → req.query → filters object → cache helper → toTeaser map → JSON response
//
// No await on cache helpers — they're synchronous (instant from RAM).
import {
    getJobsPaginatedFromCache,
    getFilterCountsFromCache,
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
import { toTeaser, toPublicJob } from './helpers.js';
import { Analytics } from '../../models/analyticsModel.js';

// ─── Query-param validation whitelists ────────────────────────────────────
// Every value in req.query arrives as a STRING (or array of strings). Booleans
// are the literal string "true"; numbers must be parseInt'd. We validate hard
// against these lists so junk input can never reach the cache filter pipeline.
const VALID_WORKPLACE = ['remote', 'hybrid', 'onsite'];
const VALID_EXPERIENCE = ['entry', 'mid', 'senior', 'lead', 'executive'];
const VALID_EMPLOYMENT = ['fulltime', 'parttime', 'contract', 'internship'];
const VALID_SORT = ['newest', 'company', 'salary'];
const SALARY_LOWER_BOUND = 0;
const SALARY_UPPER_BOUND = 1000000;

// Normalize a repeated-key query param (?workplace=remote&workplace=hybrid) into
// a clean string array. Express gives a string for one value, an array for many.
// When `allowed` is supplied, drop anything not on the whitelist.
function toArrayParam(value, allowed) {
    let arr;
    if (!value) arr = [];
    else if (typeof value === 'string') arr = [value];
    else if (Array.isArray(value)) arr = value.filter(v => typeof v === 'string');
    else arr = [];
    return allowed ? arr.filter(v => allowed.includes(v)) : arr;
}

// parseInt a salary bound; return null unless it's a finite integer in range.
function parseSalaryBound(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < SALARY_LOWER_BOUND || parsed > SALARY_UPPER_BOUND) {
        return null;
    }
    return parsed;
}

// Shared parser for the main list + filter-counts routes. Takes req.query and
// returns the exact `filters` shape getJobsPaginatedFromCache / getFilterCounts
// expect. Plain function (not middleware) so both routes stay in sync.
function parseJobFilters(query) {
    const sort = VALID_SORT.includes(query.sort) ? query.sort : 'newest';

    let salaryMin = parseSalaryBound(query.salaryMin);
    let salaryMax = parseSalaryBound(query.salaryMax);
    // A min above the max is nonsensical — drop both rather than guess intent.
    if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
        salaryMin = null;
        salaryMax = null;
    }

    return {
        company:    toArrayParam(query.company),
        category:   toArrayParam(query.category),
        search:     query.search || '',
        date:       query.date   || 'All',
        sort,
        workplace:  toArrayParam(query.workplace,  VALID_WORKPLACE),
        experience: toArrayParam(query.experience, VALID_EXPERIENCE),
        employment: toArrayParam(query.employment, VALID_EMPLOYMENT),
        visa:       query.visa       === 'true' ? true : null,
        relocation: query.relocation === 'true' ? true : null,
        hasSalary:  query.hasSalary  === 'true' ? true : null,
        salaryMin,
        salaryMax,
    };
}

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

            const filters = parseJobFilters(req.query);

            const data = getJobsPaginatedFromCache(page, limit, filters);
            Analytics.increment('pageViews_jobs'); // fire-and-forget, non-blocking
            res.status(200).json({
                jobs: (data.jobs || []).map(toTeaser),
                totalJobs: data.totalJobs,
            });
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch jobs" });
        }
    });

    // ─── Facet counts — "(42)" badges beside each filter option ───────
    // Reads the SAME filters as GET / and returns per-facet counts of the
    // current result set. Public, no auth. MUST be registered before
    // `/:id/full` — otherwise Express matches "filter-counts" as :id.
    router.get('/filter-counts', (req, res) => {
        try {
            const filters = parseJobFilters(req.query);
            const counts = getFilterCountsFromCache(filters);
            res.status(200).json(counts);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch filter counts" });
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

            // Count real detail views (full, gated, or anon) — not 404s.
            Analytics.increment('pageViews_jobDetail'); // fire-and-forget

            // Authenticated user → always full access
            if (req.user?.id) {
                return res.status(200).json({ gated: false, job: toPublicJob(job) });
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
            return res.status(200).json({ gated: false, job: toPublicJob(job) });

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
