// Diagnostic ONLY — no writes. Verifies that the in-RAM jobs cache does not
// hold heavyweight fields (Description, DescriptionHtml, parsedRequirements)
// after the cache-load projection is in place. Loads the cache through the
// exact same code path the server uses, then inspects every cached job.
//
//   node src/migrations/cleanup-cache-fields.js

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const HEAVY_FIELDS = ['Description', 'DescriptionHtml', 'parsedRequirements'];

async function run() {
    console.log('🔎 Cache field diagnostic (read-only)...\n');

    const { initJobsCache, getAllJobs } = await import('../cache/jobsCache.js');

    const before = process.memoryUsage().heapUsed;
    await initJobsCache();
    const after = process.memoryUsage().heapUsed;

    const jobs = getAllJobs();
    console.log(`Cache loaded: ${jobs.length} jobs, ~${Math.round((after - before) / 1048576)}MB heap delta\n`);

    const offenders = {};
    for (const field of HEAVY_FIELDS) offenders[field] = 0;

    for (const job of jobs) {
        for (const field of HEAVY_FIELDS) {
            if (job[field] !== undefined && job[field] !== null && job[field] !== '') {
                offenders[field]++;
            }
        }
    }

    let clean = true;
    for (const field of HEAVY_FIELDS) {
        if (offenders[field] > 0) {
            clean = false;
            console.log(`❌ ${offenders[field]}/${jobs.length} cached jobs still carry "${field}"`);
        } else {
            console.log(`✅ No cached job carries "${field}"`);
        }
    }

    console.log(clean
        ? '\n🎉 Cache is lean — the load projection is working.'
        : '\n⚠️  Heavy fields are still loaded — the cache-load projection is missing or incomplete.');

    process.exit(clean ? 0 : 1);
}

run().catch(err => {
    console.error('❌ Diagnostic failed:', err);
    process.exit(1);
});
