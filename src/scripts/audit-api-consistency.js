// ─── Audit 4: API response consistency / data lockdown ─────────────────────
//
// Mounts the REAL jobs router in-process (same wiring as server.js) against the
// live cache + DB, then hits the public endpoints over HTTP and asserts that
// filter* fields are present and internal fields never leak.
//
//   node src/scripts/audit-api-consistency.js
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import { initJobsCache, getAllJobs } from '../cache/jobsCache.js';
import { jobsApiRouter } from '../api/jobs.routes.js';
import { attachVisitor } from '../middleware/visitorMiddleware.js';
import { client } from '../db/connection.js';

const LEAK_FIELDS = ['ATSPlatform', 'sourceSite', 'ConfidenceScore', 'parsedRequirements', 'Status', 'RejectionReason', 'GermanRequired'];
const FILTER_FIELDS = ['filterWorkplace', 'filterExperience', 'filterEmployment', 'filterVisa', 'filterRelocation', 'filterSalaryTier'];

let issues = 0;
const check = (label, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'ISSUE'}  ${label}${detail ? '  — ' + detail : ''}`); if (!ok) issues++; };

function get(port, path) {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${path}`, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad JSON from ' + path + ': ' + d.slice(0, 120))); } });
        }).on('error', reject);
    });
}

const leaksIn = (obj) => LEAK_FIELDS.filter(f => f in obj);
const filtersMissing = (obj) => FILTER_FIELDS.filter(f => !(f in obj));

async function run() {
    await initJobsCache();
    const firstId = getAllJobs()[0]?._id;

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(attachVisitor);
    app.use('/api/jobs', jobsApiRouter);
    const server = app.listen(0);
    const port = server.address().port;

    console.log('─'.repeat(70));
    console.log('AUDIT 4 — API response consistency');

    // A: list endpoint
    const list = await get(port, '/api/jobs/?limit=5');
    const jobsArr = Array.isArray(list.jobs) ? list.jobs : [];
    const listLeaks = jobsArr.flatMap(leaksIn);
    const listMissing = jobsArr.flatMap(filtersMissing);
    check('A GET /?limit=5 returns jobs', jobsArr.length > 0, `${jobsArr.length} jobs`);
    check('A every list job has filter* fields', listMissing.length === 0, listMissing.length ? [...new Set(listMissing)].join(',') : '');
    check('A no list job leaks internal fields', listLeaks.length === 0, listLeaks.length ? [...new Set(listLeaks)].join(',') : '');

    // B: full detail endpoint
    if (firstId) {
        const full = await get(port, `/api/jobs/${firstId}/full`);
        if (full.gated) {
            const t = full.teaser || {};
            check('B /:id/full (gated) teaser has no leaks', leaksIn(t).length === 0, leaksIn(t).join(','));
        } else {
            const j = full.job || {};
            check('B /:id/full job has filter* fields', filtersMissing(j).length === 0, filtersMissing(j).join(','));
            check('B /:id/full job leaks no internal fields', leaksIn(j).length === 0, leaksIn(j).join(','));
            check('B /:id/full job includes Description+ApplicationURL', 'Description' in j && 'ApplicationURL' in j, '');
        }
    } else check('B /:id/full', false, 'no job id available');

    // C: filter-counts shape
    const counts = await get(port, '/api/jobs/filter-counts');
    const requiredKeys = ['workplace', 'experience', 'employment', 'visa', 'relocation', 'hasSalary'];
    const missingKeys = requiredKeys.filter(k => !(k in counts));
    check('C filter-counts has all facet keys', missingKeys.length === 0, missingKeys.join(','));
    const numericOk = typeof counts.totalJobs === 'number'
        && typeof counts.visa?.available === 'number'
        && typeof counts.hasSalary?.count === 'number'
        && typeof counts.workplace?.remote === 'number';
    check('C filter-counts values are numeric', numericOk, `total=${counts.totalJobs}`);

    server.close();
    console.log('─'.repeat(70));
    console.log(issues === 0 ? '✅ AUDIT 4 RESULT: all checks PASS' : `⚠️  AUDIT 4 RESULT: ${issues} issue(s)`);
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).finally(async () => { await client.close(); process.exit(process.exitCode || 0); });
