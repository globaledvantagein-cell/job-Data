// ─── Audit 1: filter* data accuracy vs. raw source fields ──────────────────
//
// Read-only. Compares each stored filter* field against the raw ATS + Gemma
// sources AND against a fresh resolveAll() recomputation (catching stale/buggy
// stored values). Reports PASS/ISSUE — fixes nothing.
//
//   node src/scripts/audit-filter-accuracy.js
import 'dotenv/config';
import { connectToDb, client } from '../db/connection.js';
import { resolveAll, resolveSalary } from '../utils/filterNormalizer.js';

const log = (...a) => console.log(...a);
const hr = () => log('─'.repeat(70));

async function run() {
    const db = await connectToDb();
    const jobs = db.collection('jobs');
    const PROJ = { projection: {
        JobTitle: 1, Company: 1, WorkplaceType: 1, ExperienceLevel: 1, EmploymentType: 1,
        IsRemote: 1, isEntryLevel: 1, Location: 1,
        SalaryMin: 1, SalaryMax: 1, SalaryCurrency: 1, SalaryInterval: 1,
        parsedRequirements: 1,
        filterWorkplace: 1, filterExperience: 1, filterEmployment: 1,
        filterVisa: 1, filterRelocation: 1,
        filterSalaryMin: 1, filterSalaryMax: 1, filterSalaryCurrency: 1,
        filterSalaryInterval: 1, filterSalaryTier: 1,
    } };
    let issues = 0;

    // ── A: filterWorkplace='remote' where ATS WorkplaceType is NOT remote ──
    hr(); log('AUDIT 1A — Gemma remote override (filterWorkplace=remote, ATS≠Remote)');
    const aDocs = await jobs.find({
        Status: 'active', filterWorkplace: 'remote',
        WorkplaceType: { $nin: ['Remote', 'remote', 'REMOTE', 'Fully Remote'] },
    }, PROJ).limit(5).toArray();
    if (aDocs.length === 0) log('  (no such jobs — every remote came from an ATS "Remote" value)');
    for (const j of aDocs) {
        const rp = j.parsedRequirements?.remote_policy_detail;
        const locRemote = String(j.Location || '').toLowerCase().includes('remote');
        const ok = rp === 'fully_remote' || locRemote;
        if (!ok) { issues++; log(`  ISSUE  WorkplaceType=${JSON.stringify(j.WorkplaceType)} remote_policy=${rp} loc=${JSON.stringify(j.Location)} — no valid source for 'remote' [${j.JobTitle}]`); }
        else log(`  PASS   src=${rp === 'fully_remote' ? 'gemma:fully_remote' : 'location'}  ATS=${JSON.stringify(j.WorkplaceType)}  [${j.JobTitle}]`);
    }

    // ── B: filterExperience='entry' — which source drove it, consistent? ──
    hr(); log('AUDIT 1B — filterExperience=entry source attribution');
    const bDocs = await jobs.find({ Status: 'active', filterExperience: 'entry' }, PROJ).limit(5).toArray();
    for (const j of bDocs) {
        const gemma = j.parsedRequirements?.experience_level;
        const recomputed = resolveAll(j).filterExperience;
        let source;
        // Mirror the trust hierarchy to attribute the source.
        if (resolveAll({ parsedRequirements: { experience_level: gemma } }).filterExperience === 'entry' && gemma) source = `gemma:${gemma}`;
        else if (resolveAll({ ExperienceLevel: j.ExperienceLevel }).filterExperience === 'entry') source = `ats:${j.ExperienceLevel}`;
        else if (j.isEntryLevel === true) source = 'isEntryLevel:true';
        else source = 'UNKNOWN';
        const consistent = recomputed === 'entry';
        if (!consistent || source === 'UNKNOWN') { issues++; log(`  ISSUE  stored=entry recomputed=${recomputed} source=${source} [${j.JobTitle}]`); }
        else log(`  PASS   source=${source}  (gemma=${gemma ?? '-'} ats=${JSON.stringify(j.ExperienceLevel)} isEntry=${j.isEntryLevel}) [${j.JobTitle}]`);
    }

    // ── C: every filterSalaryTier='ats' — SalaryMin/Max present + values match ──
    hr(); log('AUDIT 1C — all filterSalaryTier=ats verified against resolveSalary()');
    const cDocs = await jobs.find({ Status: 'active', filterSalaryTier: 'ats' }, PROJ).toArray();
    log(`  found ${cDocs.length} ats-tier jobs`);
    let cBad = 0;
    for (const j of cDocs) {
        const hasRaw = (j.SalaryMin != null && j.SalaryMin > 0) || (j.SalaryMax != null && j.SalaryMax > 0);
        const exp = resolveSalary(j); // recompute expected canonical
        const matches = exp.tier === 'ats'
            && (exp.min ?? null) === (j.filterSalaryMin ?? null)
            && (exp.max ?? null) === (j.filterSalaryMax ?? null);
        if (!hasRaw || !matches) {
            cBad++; issues++;
            log(`  ISSUE  raw=${j.SalaryMin}/${j.SalaryMax} ${j.SalaryCurrency}/${j.SalaryInterval}  stored=${j.filterSalaryMin}/${j.filterSalaryMax}  expected=${exp.min}/${exp.max}(${exp.tier})  [${j.JobTitle}]`);
        }
    }
    log(cBad === 0 ? `  PASS   all ${cDocs.length} ats-tier jobs have raw salary and matching converted filter values` : `  ${cBad} mismatches above`);

    // ── D: filterSalaryTier='jd' should be 0 ──
    hr(); log('AUDIT 1D — filterSalaryTier=jd count (expected 0)');
    const dCount = await jobs.countDocuments({ Status: 'active', filterSalaryTier: 'jd' });
    if (dCount === 0) log('  PASS   0 jd-tier jobs');
    else {
        log(`  INFO   ${dCount} jd-tier jobs found (Gemma-only salary). Investigating a sample:`);
        for (const j of await jobs.find({ Status: 'active', filterSalaryTier: 'jd' }, PROJ).limit(3).toArray()) {
            log(`    ATS min/max=${j.SalaryMin}/${j.SalaryMax}  gemma=${j.parsedRequirements?.salary_min}/${j.parsedRequirements?.salary_max} ${j.parsedRequirements?.salary_currency} → filter=${j.filterSalaryMin}/${j.filterSalaryMax} [${j.JobTitle}]`);
        }
        // Not necessarily a bug — jd is a legitimate tier. Report as INFO.
    }

    // ── E: visa mismatch both directions ──
    hr(); log('AUDIT 1E — filterVisa vs parsedRequirements.visa_sponsorship');
    const eForward = await jobs.countDocuments({ Status: 'active', 'parsedRequirements.visa_sponsorship': 'available', filterVisa: null });
    const eBackward = await jobs.countDocuments({ Status: 'active', filterVisa: 'available', $or: [
        { 'parsedRequirements.visa_sponsorship': { $ne: 'available' } },
        { 'parsedRequirements.visa_sponsorship': { $exists: false } },
    ] });
    if (eForward === 0 && eBackward === 0) log('  PASS   0 visa mismatches (both directions)');
    else { issues++; log(`  ISSUE  gemma-available-but-filter-null: ${eForward} | filter-available-but-gemma-not: ${eBackward}`); }

    hr(); log(issues === 0 ? '✅ AUDIT 1 RESULT: all checks PASS (no accuracy bugs)' : `⚠️  AUDIT 1 RESULT: ${issues} issue group(s) — see above`);
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1; }).finally(async () => { await client.close(); process.exit(process.exitCode || 0); });
