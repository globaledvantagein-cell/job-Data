// ─── Background Extractor ──────────────────────────────────────────────────────
//
// Fire-and-forget wrapper used at admin-approval time: extract structured
// requirements via Gemma 4 31B and persist them onto the job document.
//
// Designed to be called WITHOUT await — callers should attach a .catch().
// Uses the native MongoDB driver (db.collection pattern), like the rest of the
// codebase. Separate from src/gemini/.
//
// TODO(filters): the reanalysis flow (updateJobAfterReanalysis in
// db/jobs/reviewQueries.js) does NOT currently rewrite parsedRequirements or any
// ATS filter-source field (WorkplaceType/ExperienceLevel/EmploymentType/Salary),
// so filter* fields stay valid across a reanalysis and need no recompute there.
// If that ever changes — e.g. reanalysis starts re-extracting requirements — it
// must also call resolveAll() and $set the filter* fields, like this module does.

import { connectToDb } from '../db/connection.js';
import { extractRequirements } from './extractRequirements.js';
import { resolveAll } from '../utils/filterNormalizer.js';
import { upsertJob } from '../cache/jobsCache.js';

/**
 * Maps Gemma's salary output onto the job document's flat Salary* fields —
 * but ONLY where the ATS extractor left a gap.
 *
 * The ATS is the more trustworthy source (structured field vs. text inference),
 * so an existing SalaryMin is never overwritten. Returns {} when there's
 * nothing to add, so callers can spread it into a $set unconditionally.
 *
 * Exported for the backfill migration, which applies the same rule.
 */
export function buildSalaryUpdate(job, parsedRequirements) {
    if (job?.SalaryMin !== null && job?.SalaryMin !== undefined) return {};
    if (!parsedRequirements) return {};

    const { salary_min, salary_max, salary_currency, salary_interval } = parsedRequirements;
    if (salary_min === null && salary_max === null) return {};

    return {
        SalaryMin: salary_min,
        SalaryMax: salary_max,
        SalaryCurrency: salary_currency,
        SalaryInterval: salary_interval,
    };
}

/**
 * Extracts requirements for a single job and stores them as `parsedRequirements`.
 *
 * Skips work if the job already has `parsedRequirements` (defensive against
 * re-approval). Silently no-ops if extraction fails — the job stays live with
 * its existing fields and the migration script can catch it later.
 *
 * @param {object} job - the live job document (must include _id)
 * @returns {Promise<boolean>} true if a result was stored, false otherwise
 */
export async function extractAndStoreRequirements(job) {
    if (!job || !job._id) return false;
    if (job.parsedRequirements) return false;

    const result = await extractRequirements(job);
    if (!result) return false; // extractRequirements returns null on failure

    // Same Gemma call now yields salary too — fill it in only if the ATS
    // extractor found none. No extra AI call.
    const salaryUpdate = buildSalaryUpdate(job, result);

    // Compute canonical filter* fields from what the document will look like
    // AFTER this write: the original ATS fields + the fresh Gemma extraction +
    // any salary we're about to fill in. resolveAll then applies the trust
    // hierarchy across both sources. Pure in-memory Map lookups (~0ms).
    const mergedJob = {
        ...job,
        parsedRequirements: result,
        ...(Object.keys(salaryUpdate).length > 0 ? salaryUpdate : {}),
    };
    const filterFields = resolveAll(mergedJob);

    const db = await connectToDb();
    await db.collection('jobs').updateOne(
        { _id: job._id },
        { $set: { parsedRequirements: result, ...salaryUpdate, ...filterFields } }
    );

    // Cache sync: the job entered the RAM cache at approval time WITHOUT
    // parsedRequirements or filter* fields (this runs fire-and-forget, seconds
    // to minutes later). Re-fetch the now-updated doc and upsert so the public
    // list reflects the new filters. Wrapped so a cache miss can't crash the
    // extraction flow — the DB is already correct, and the next refresh recovers.
    try {
        const updated = await db.collection('jobs').findOne({ _id: job._id });
        if (updated) upsertJob(updated);
    } catch (cacheErr) {
        console.warn(`[Gemma] Cache sync failed for ${job._id}: ${cacheErr.message}`);
    }

    const salaryNote = Object.keys(salaryUpdate).length > 0
        ? ` (+salary ${salaryUpdate.SalaryMin ?? '?'}-${salaryUpdate.SalaryMax ?? '?'} ${salaryUpdate.SalaryCurrency}/${salaryUpdate.SalaryInterval})`
        : '';
    console.log(
        `[Gemma] Stored parsedRequirements for ${job._id} | ${job.JobTitle}${salaryNote} ` +
        `(workplace: ${filterFields.filterWorkplace ?? 'null'}, ` +
        `experience: ${filterFields.filterExperience ?? 'null'}, ` +
        `salary: ${filterFields.filterSalaryTier ?? 'null'})`,
    );
    return true;
}
