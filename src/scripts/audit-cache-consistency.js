// ─── Audit 3 (index↔data consistency) + Audit 5 (edge cases) ───────────────
//
// Read-only. Initializes the cache, then verifies the inverted indexes are a
// faithful partition of jobsArray, and exercises tricky filter inputs.
//
//   node src/scripts/audit-cache-consistency.js
import 'dotenv/config';
import {
    initJobsCache, getCacheStats, getAllJobs, getJobsArray,
    getWorkplaceIndex, getExperienceIndex, getEmploymentIndex,
    getCategoryIndex, getCompanyIndex, getSalaryTierIndex,
} from '../cache/jobsCache.js';
import { getJobsPaginatedFromCache, getFilterCountsFromCache } from '../cache/jobsQuery.js';
import { client } from '../db/connection.js';

let issues = 0;
const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'ISSUE'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) issues++;
};
const sumSets = (map) => { let n = 0; for (const s of map.values()) n += s.size; return n; };

async function run() {
    await initJobsCache();
    const total = getAllJobs().length;             // non-tombstone jobs
    const mapSize = getCacheStats().size;           // jobsMap.size
    const jobsArr = getJobsArray();

    console.log('─'.repeat(70));
    console.log(`AUDIT 3 — index ↔ data consistency (total live jobs: ${total})`);

    // A
    check('A jobsMap size === jobsArray non-tombstone count', mapSize === total, `map=${mapSize} arr=${total}`);
    // B–E: full-partition indexes (every job buckets into exactly one key incl _null)
    check('B Σ workplaceIndex sets === total',  sumSets(getWorkplaceIndex())  === total, `Σ=${sumSets(getWorkplaceIndex())}`);
    check('C Σ experienceIndex sets === total', sumSets(getExperienceIndex()) === total, `Σ=${sumSets(getExperienceIndex())}`);
    check('D Σ categoryIndex sets === total',   sumSets(getCategoryIndex())   === total, `Σ=${sumSets(getCategoryIndex())}`);
    check('E Σ companyIndex sets === total',    sumSets(getCompanyIndex())    === total, `Σ=${sumSets(getCompanyIndex())}`);
    // (employment is also a full partition — check it too)
    check('E2 Σ employmentIndex sets === total', sumSets(getEmploymentIndex()) === total, `Σ=${sumSets(getEmploymentIndex())}`);

    // F: every indexed idx points at a live (non-null, in-bounds) job
    const allIndexes = [
        ['workplace', getWorkplaceIndex()], ['experience', getExperienceIndex()],
        ['employment', getEmploymentIndex()], ['category', getCategoryIndex()],
        ['company', getCompanyIndex()], ['salaryTier', getSalaryTierIndex()],
    ];
    let danglers = 0;
    for (const [, idxMap] of allIndexes) {
        for (const set of idxMap.values()) {
            for (const idx of set) {
                if (idx < 0 || idx >= jobsArr.length || jobsArr[idx] == null) danglers++;
            }
        }
    }
    check('F every indexed position exists and is non-null', danglers === 0, `${danglers} dangling refs`);

    // G: within a facet, no job appears in more than one value-set
    let gViolations = 0;
    for (const [facet, idxMap] of allIndexes) {
        const seen = new Map(); // idx -> value key
        for (const [key, set] of idxMap.entries()) {
            for (const idx of set) {
                if (seen.has(idx)) { gViolations++; console.log(`    dup in ${facet}: idx ${idx} in "${seen.get(idx)}" and "${key}"`); }
                else seen.set(idx, key);
            }
        }
    }
    check('G no job in >1 value-set within a facet', gViolations === 0, `${gViolations} violations`);

    // ── Audit 5: edge cases ────────────────────────────────────────────────
    console.log('─'.repeat(70));
    console.log('AUDIT 5 — edge cases');

    // A: regex-special search must not throw
    let aOk = true, aDetail = '';
    try {
        const r1 = getJobsPaginatedFromCache(1, 30, { search: 'C++' });
        const r2 = getJobsPaginatedFromCache(1, 30, { search: 'node.js' });
        aDetail = `C++→${r1.totalJobs}, node.js→${r2.totalJobs}`;
    } catch (e) { aOk = false; aDetail = 'threw: ' + e.message; }
    check('A regex-special search escaped (no crash)', aOk, aDetail);

    // B: invalid workplace value ignored → same as remote-only
    const remoteOnly = getJobsPaginatedFromCache(1, 30, { workplace: ['remote'] }).totalJobs;
    const remotePlusJunk = getJobsPaginatedFromCache(1, 30, { workplace: ['remote', 'invalid_value'] }).totalJobs;
    check('B invalid workplace value ignored', remoteOnly === remotePlusJunk, `remote=${remoteOnly} remote+junk=${remotePlusJunk}`);

    // C: absurd salaryMin → 0 results, no error
    let cOk = true, cTotal = -1;
    try { cTotal = getJobsPaginatedFromCache(1, 30, { salaryMin: 999999999 }).totalJobs; } catch (e) { cOk = false; cTotal = e.message; }
    check('C salaryMin=999999999 → 0 jobs, no error', cOk && cTotal === 0, `total=${cTotal}`);

    // D: visa AND relocation → intersection (every result has BOTH)
    const bothRes = getJobsPaginatedFromCache(1, 500, { visa: true, relocation: true });
    const allBoth = bothRes.jobs.every(j => j.filterVisa === 'available' && j.filterRelocation === 'available');
    const visaOnly = getJobsPaginatedFromCache(1, 500, { visa: true }).totalJobs;
    const relOnly = getJobsPaginatedFromCache(1, 500, { relocation: true }).totalJobs;
    check('D visa AND relocation intersect', allBoth && bothRes.totalJobs <= Math.min(visaOnly, relOnly),
        `both=${bothRes.totalJobs} (visa=${visaOnly}, reloc=${relOnly}), all-have-both=${allBoth}`);

    // E: filter-counts on a zero-result filter → all-zero, no error
    let eOk = true, eDetail = '';
    try {
        const c = getFilterCountsFromCache({ company: ['__does_not_exist__'] });
        const allZero = c.totalJobs === 0
            && Object.values(c.workplace).every(v => v === 0)
            && Object.values(c.experience).every(v => v === 0)
            && c.visa.available === 0 && c.hasSalary.count === 0;
        eOk = allZero;
        eDetail = `totalJobs=${c.totalJobs}`;
    } catch (e) { eOk = false; eDetail = 'threw: ' + e.message; }
    check('E filter-counts with 0 results → all-zero, no error', eOk, eDetail);

    console.log('─'.repeat(70));
    console.log(issues === 0 ? '✅ AUDIT 3+5 RESULT: all checks PASS' : `⚠️  AUDIT 3+5 RESULT: ${issues} issue(s)`);
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).finally(async () => { await client.close(); process.exit(process.exitCode || 0); });
