// Public read endpoints for the REMOTE jobs vertical (/api/remote-jobs).
//
// Mirrors publicRead.routes.js in shape, with two deliberate product differences:
//
//   1. NO GATES. Remote jobs are the free volume play — no premium filter
//      stripping, no JD-view metering, no anonymous view limit, no apply-click
//      metering. softVerifyToken still runs so analytics/premium badges can see
//      who's browsing, but it never blocks or degrades the response.
//   2. A `country` filter German jobs don't have (?country=US&country=GB).
//
// The German /api/jobs pipeline is untouched — separate router, separate cache.
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import {
    getRemoteJobsPaginatedFromCache,
    getRemoteFilterCountsFromCache,
    getRemoteCompanyNamesFromCache,
    getRemoteCategoryCountsFromCache,
    getRemotePublicBaitJobsFromCache,
} from '../../cache/index.js';
import { connectToDb } from '../../db/connection.js';
import { softVerifyToken } from '../../middleware/authMiddleware.js';
import { toTeaser, toPublicJob } from './helpers.js';
import { Analytics } from '../../models/analyticsModel.js';

// ─── Query-param validation whitelists ────────────────────────────────────
const VALID_WORKPLACE = ['remote', 'hybrid', 'onsite'];
const VALID_EXPERIENCE = ['entry', 'mid', 'senior', 'lead', 'executive'];
const VALID_EMPLOYMENT = ['fulltime', 'parttime', 'contract', 'internship'];
const VALID_SORT = ['newest', 'company', 'salary'];
// The countries the remote scraper collects. Anything else is dropped rather
// than passed through to the cache.
const VALID_COUNTRY = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'SG'];
const SALARY_LOWER_BOUND = 0;
const SALARY_UPPER_BOUND = 1000000;

// Normalize a repeated-key query param (?country=US&country=GB) into a clean
// string array. Express gives a string for one value, an array for many.
function toArrayParam(value, allowed) {
    let arr;
    if (!value) arr = [];
    else if (typeof value === 'string') arr = [value];
    else if (Array.isArray(value)) arr = value.filter(v => typeof v === 'string');
    else arr = [];
    return allowed ? arr.filter(v => allowed.includes(v)) : arr;
}

// Country codes are case-insensitive on the wire ("?country=us"), upper-cased
// before the whitelist check so the cache index (upper-case keys) matches.
function toCountryParam(value) {
    let arr;
    if (!value) arr = [];
    else if (typeof value === 'string') arr = [value];
    else if (Array.isArray(value)) arr = value.filter(v => typeof v === 'string');
    else arr = [];
    return arr.map(v => v.trim().toUpperCase()).filter(v => VALID_COUNTRY.includes(v));
}

function parseSalaryBound(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < SALARY_LOWER_BOUND || parsed > SALARY_UPPER_BOUND) {
        return null;
    }
    return parsed;
}

// Shared parser for the list + filter-counts routes, so both stay in sync.
function parseRemoteJobFilters(query) {
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
        country:    toCountryParam(query.country),
        search:     query.search || '',
        date:       query.date   || 'All',
        sort,
        workplace:  toArrayParam(query.workplace,  VALID_WORKPLACE),
        experience: toArrayParam(query.experience, VALID_EXPERIENCE),
        employment: toArrayParam(query.employment, VALID_EMPLOYMENT),
        hasSalary:  query.hasSalary === 'true' ? true : null,
        salaryMin,
        salaryMax,
    };
}

// Single-doc lookup against the remoteJobs collection. Accepts BOTH an ObjectId
// and a JobID string, same contract as the German /:id/full route.
async function findRemoteJobByIdOrJobID(idOrJobID) {
    const db = await connectToDb();
    const collection = db.collection('remoteJobs');

    if (ObjectId.isValid(idOrJobID)) {
        const byObjectId = await collection.findOne({ _id: new ObjectId(idOrJobID) });
        if (byObjectId) return byObjectId;
    }

    return await collection.findOne({ JobID: idOrJobID });
}

export const remoteJobsRouter = Router();

// ─── Homepage/SEO bait — 9 newest remote jobs ─────────────────────────
remoteJobsRouter.get('/public-bait', (req, res) => {
    try {
        const jobs = getRemotePublicBaitJobsFromCache();
        res.status(200).json(jobs.map(toTeaser));
    } catch (error) {
        res.status(500).json({ error: 'Failed to load remote bait jobs' });
    }
});

// ─── Main remote jobs list — filtered, sorted, paginated ──────────────
// softVerifyToken is analytics-only here: it populates req.user when a token is
// present and is a no-op otherwise. Nothing about the response is gated, and
// salary insights ship to everyone — remote is the free tier.
remoteJobsRouter.get('/', softVerifyToken, (req, res) => {
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);

        const filters = parseRemoteJobFilters(req.query);

        const data = getRemoteJobsPaginatedFromCache(page, limit, filters);
        if (!req.isHealthCheck) Analytics.increment('pageViews_remoteJobs'); // fire-and-forget
        res.status(200).json({
            jobs: (data.jobs || []).map(job => toTeaser(job, { includeSalaryInsights: true })),
            totalJobs: data.totalJobs,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch remote jobs' });
    }
});

// ─── Facet counts — "(42)" badges beside each filter option ───────────
// MUST be registered before `/:id/full` — otherwise Express matches
// "filter-counts" as :id.
remoteJobsRouter.get('/filter-counts', (req, res) => {
    try {
        const filters = parseRemoteJobFilters(req.query);
        const counts = getRemoteFilterCountsFromCache(filters);
        res.status(200).json(counts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch remote filter counts' });
    }
});

// ─── Filter dropdown — distinct company names alphabetical ────────────
remoteJobsRouter.get('/company-names', (req, res) => {
    try {
        res.status(200).json(getRemoteCompanyNamesFromCache());
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch remote company names' });
    }
});

// ─── Filter dropdown — counts per category ────────────────────────────
remoteJobsRouter.get('/category-counts', (req, res) => {
    try {
        res.status(200).json(getRemoteCategoryCountsFromCache());
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch remote category counts' });
    }
});

// ─── UNGATED FULL-DETAIL ENDPOINT ─────────────────────────────────────
// Always returns the full job. The `gated: false` envelope is kept so the
// frontend can share one response shape with the German detail endpoint.
// Read from MongoDB (not the cache) because this accepts an ObjectId too, and
// run through toPublicJob for the same data lockdown the German route uses.
remoteJobsRouter.get('/:id/full', softVerifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const job = await findRemoteJobByIdOrJobID(id);
        if (!job || job.Status !== 'active') {
            return res.status(404).json({ error: 'Job not found' });
        }

        if (!req.isHealthCheck) Analytics.increment('pageViews_remoteJobDetail'); // fire-and-forget

        return res.status(200).json({ gated: false, job: toPublicJob(job) });
    } catch (error) {
        console.error('[RemoteJobs/full] Error:', error);
        res.status(500).json({ error: 'Failed to load remote job' });
    }
});
