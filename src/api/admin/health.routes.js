/**
 * Admin health/status API — backs the /admin status dashboard.
 *
 * GET /api/admin/health  (verifyToken + verifyAdmin)
 *
 * Runs a battery of checks — internal (DB, config, data freshness) and
 * self-HTTP pings against the real public endpoints. Self-pings carry the
 * `x-health-check: 1` header, which:
 *   - makes attachVisitor return null (no visitor records are ever created)
 *   - skips the pageViews analytics counters
 * so continuous monitoring never pollutes traffic stats.
 *
 * Statuses per check: 'ok' | 'warn' | 'fail'. Overall:
 *   any critical fail → 'down'; any warn/non-critical fail → 'degraded';
 *   else 'operational'.
 */
import { Router } from 'express';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { connectToDb } from '../../db/connection.js';
import { validatePromoCode } from '../../db/promoCodeQueries.js';
import { BETA_PROMO_CODE, GOOGLE_CLIENT_ID, RESEND_API_KEY } from '../../env.js';

export const adminHealthRouter = Router();
adminHealthRouter.use(verifyToken, verifyAdmin);

const SELF_ORIGIN = process.env.SELF_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
const PING_TIMEOUT_MS = 5000;

/** Timed wrapper: runs fn, returns { status, latencyMs, detail }. */
async function timed(fn) {
    const t0 = Date.now();
    try {
        const result = await fn();
        return { latencyMs: Date.now() - t0, ...result };
    } catch (err) {
        return { status: 'fail', latencyMs: Date.now() - t0, detail: err.message };
    }
}

/** Self-ping a public endpoint with the health header. */
async function pingEndpoint(path, { expectJson = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
        const res = await fetch(`${SELF_ORIGIN}${path}`, {
            headers: { 'x-health-check': '1' },
            signal: controller.signal,
        });
        if (!res.ok) return { status: 'fail', detail: `HTTP ${res.status}` };
        if (expectJson) await res.json();
        return { status: 'ok', detail: `HTTP ${res.status}` };
    } catch (err) {
        return { status: 'fail', detail: err.name === 'AbortError' ? `timeout after ${PING_TIMEOUT_MS}ms` : err.message };
    } finally {
        clearTimeout(timer);
    }
}

// Check definitions. `critical: true` failures mark the whole system 'down'.
const CHECKS = [
    {
        key: 'database', label: 'MongoDB', group: 'Core', critical: true,
        run: async () => {
            const db = await connectToDb();
            await db.command({ ping: 1 });
            return { status: 'ok', detail: 'ping ok' };
        },
    },
    {
        key: 'jobs_api', label: 'Jobs API (list)', group: 'Public API', critical: true,
        run: () => pingEndpoint('/api/jobs?limit=1'),
    },
    {
        key: 'filter_counts_api', label: 'Jobs API (filter counts)', group: 'Public API', critical: false,
        run: () => pingEndpoint('/api/jobs/filter-counts'),
    },
    {
        key: 'career_guide_api', label: 'Career Guide API', group: 'Public API', critical: false,
        run: () => pingEndpoint('/api/career-guide/public'),
    },
    {
        key: 'jobs_data', label: 'Active jobs in DB', group: 'Data', critical: true,
        run: async () => {
            const db = await connectToDb();
            const n = await db.collection('jobs').countDocuments({ Status: 'active' });
            if (n === 0) return { status: 'fail', detail: '0 active jobs' };
            if (n < 20) return { status: 'warn', detail: `only ${n} active jobs` };
            return { status: 'ok', detail: `${n} active jobs` };
        },
    },
    {
        key: 'scraper_freshness', label: 'Scraper freshness', group: 'Data', critical: false,
        run: async () => {
            const db = await connectToDb();
            const [latest] = await db.collection('jobs')
                .find({}, { projection: { scrapedAt: 1 } })
                .sort({ scrapedAt: -1 }).limit(1).toArray();
            if (!latest?.scrapedAt) return { status: 'warn', detail: 'no scrapedAt found' };
            const hours = (Date.now() - new Date(latest.scrapedAt).getTime()) / 3.6e6;
            if (hours > 48) return { status: 'fail', detail: `last scrape ${Math.round(hours)}h ago` };
            if (hours > 30) return { status: 'warn', detail: `last scrape ${Math.round(hours)}h ago` };
            return { status: 'ok', detail: `last scrape ${Math.round(hours)}h ago` };
        },
    },
    {
        key: 'users', label: 'User accounts', group: 'Data', critical: false,
        run: async () => {
            const db = await connectToDb();
            const n = await db.collection('users').estimatedDocumentCount();
            return { status: 'ok', detail: `${n} users` };
        },
    },
    {
        key: 'auth_config', label: 'Auth config', group: 'Config', critical: true,
        run: async () => {
            if (!process.env.JWT_SECRET) return { status: 'fail', detail: 'JWT_SECRET missing' };
            if (!GOOGLE_CLIENT_ID) return { status: 'fail', detail: 'GOOGLE_CLIENT_ID missing' };
            return { status: 'ok', detail: 'JWT + Google OAuth configured' };
        },
    },
    {
        key: 'email_config', label: 'Email (Resend)', group: 'Config', critical: false,
        run: async () => (RESEND_API_KEY
            ? { status: 'ok', detail: 'API key present' }
            : { status: 'fail', detail: 'RESEND_API_KEY missing' }),
    },
    {
        key: 'promo_code', label: `Promo ${BETA_PROMO_CODE}`, group: 'Premium', critical: false,
        run: async () => {
            const check = await validatePromoCode(BETA_PROMO_CODE);
            if (!check.valid) return { status: 'fail', detail: `code ${check.reason}` };
            return { status: 'ok', detail: `redeemable · used ${check.promo.usedCount}×` };
        },
    },
    {
        key: 'digest_cron', label: 'Weekly digest cron', group: 'Cron', critical: false,
        run: async () => {
            const db = await connectToDb();
            const [last] = await db.collection('digestRuns')
                .find({}, { projection: { finishedAt: 1, startedAt: 1 } })
                .sort({ startedAt: -1 }).limit(1).toArray();
            if (!last) return { status: 'warn', detail: 'no digest runs recorded yet' };
            const days = (Date.now() - new Date(last.startedAt).getTime()) / 8.64e7;
            if (days > 8) return { status: 'warn', detail: `last run ${Math.round(days)}d ago` };
            return { status: 'ok', detail: `last run ${Math.round(days)}d ago` };
        },
    },
];

adminHealthRouter.get('/', async (req, res) => {
    const results = await Promise.all(CHECKS.map(async c => {
        const r = await timed(c.run);
        return {
            key: c.key, label: c.label, group: c.group, critical: c.critical,
            status: r.status, latencyMs: r.latencyMs, detail: r.detail || '',
        };
    }));

    const criticalFail = results.some(r => r.critical && r.status === 'fail');
    const anyIssue = results.some(r => r.status !== 'ok');
    const overall = criticalFail ? 'down' : anyIssue ? 'degraded' : 'operational';

    res.status(200).json({
        overall,
        timestamp: new Date().toISOString(),
        checks: results,
    });
});
