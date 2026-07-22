// ─── Audit 2: filter pipeline benchmark ────────────────────────────────────
//
// Initializes the RAM cache from the DB, then times getJobsPaginatedFromCache
// and getFilterCountsFromCache across representative filter combinations.
// 1000 iterations each; reports average microseconds. Flags anything > 5ms.
//
//   node src/scripts/benchmark-filters.js
import 'dotenv/config';
import { initJobsCache, getCacheStats } from '../cache/jobsCache.js';
import { getJobsPaginatedFromCache, getFilterCountsFromCache } from '../cache/jobsQuery.js';
import { client } from '../db/connection.js';

const ITER = 1000;

const COMBOS = [
    ['no filters (baseline)',        {}],
    ['workplace=remote',             { workplace: ['remote'] }],
    ['workplace+experience',         { workplace: ['remote'], experience: ['senior'] }],
    ['workplace+experience+employ',  { workplace: ['remote'], experience: ['senior'], employment: ['fulltime'] }],
    ['search="engineer"',            { search: 'engineer' }],
    ['salaryMin=50000',              { salaryMin: 50000 }],
    ['ALL combined',                 { workplace: ['remote'], experience: ['senior'], employment: ['fulltime'], visa: true, search: 'engineer', salaryMin: 50000 }],
    ['category=[software]',          { category: ['software'] }],
    ['company=[SAP]',                { company: ['SAP'] }],
];

function bench(fn, filters) {
    // Warm-up so JIT/first-alloc doesn't skew the average.
    for (let i = 0; i < 50; i++) fn(1, 30, filters);
    const t0 = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < ITER; i++) { const r = fn(1, 30, filters); sink += r.totalJobs ?? r.totalJobs ?? 0; }
    const t1 = process.hrtime.bigint();
    void sink;
    return Number(t1 - t0) / ITER / 1000; // microseconds/op
}

function benchCounts(filters) {
    for (let i = 0; i < 50; i++) getFilterCountsFromCache(filters);
    const t0 = process.hrtime.bigint();
    let sink = 0;
    for (let i = 0; i < ITER; i++) sink += getFilterCountsFromCache(filters).totalJobs;
    const t1 = process.hrtime.bigint();
    void sink;
    return Number(t1 - t0) / ITER / 1000;
}

async function run() {
    await initJobsCache();
    const stats = getCacheStats();
    console.log(`\nCache: ${stats.size} jobs | indexes:`, JSON.stringify(stats.indexes));
    console.log(`Iterations per combo: ${ITER}\n`);

    const rows = [];
    for (const [name, filters] of COMBOS) {
        const list = bench(getJobsPaginatedFromCache, filters);
        const counts = benchCounts(filters);
        const total = getJobsPaginatedFromCache(1, 30, filters).totalJobs;
        rows.push({ name, list, counts, total });
    }

    const flag = (us) => us > 5000 ? '  ⚠️ >5ms' : us > 2000 ? '  ⚠ >2ms' : '';
    console.log('─'.repeat(78));
    console.log('combination'.padEnd(32) + 'results'.padStart(8) + 'list µs'.padStart(12) + 'counts µs'.padStart(12) + '  flag');
    console.log('─'.repeat(78));
    for (const r of rows) {
        console.log(
            r.name.padEnd(32) +
            String(r.total).padStart(8) +
            r.list.toFixed(1).padStart(12) +
            r.counts.toFixed(1).padStart(12) +
            (flag(r.list) || flag(r.counts)),
        );
    }
    console.log('─'.repeat(78));

    const slow = rows.filter(r => r.list > 5000 || r.counts > 5000);
    const overTarget = rows.filter(r => r.list > 2000 || r.counts > 2000);
    if (slow.length) console.log(`⚠️  AUDIT 2 RESULT: ${slow.length} combo(s) over 5ms — PERFORMANCE ISSUE`);
    else if (overTarget.length) console.log(`⚠  AUDIT 2 RESULT: all under 5ms, but ${overTarget.length} over the 2ms target`);
    else console.log('✅ AUDIT 2 RESULT: every query under the 2ms target');
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).finally(async () => { await client.close(); process.exit(process.exitCode || 0); });
