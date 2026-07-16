// ─── Background Extractor ──────────────────────────────────────────────────────
//
// Fire-and-forget wrapper used at admin-approval time: extract structured
// requirements via Gemma 4 31B and persist them onto the job document.
//
// Designed to be called WITHOUT await — callers should attach a .catch().
// Uses the native MongoDB driver (db.collection pattern), like the rest of the
// codebase. Separate from src/gemini/.

import { connectToDb } from '../db/connection.js';
import { extractRequirements } from './extractRequirements.js';

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

    const db = await connectToDb();
    await db.collection('jobs').updateOne(
        { _id: job._id },
        { $set: { parsedRequirements: result, ...salaryUpdate } }
    );

    const salaryNote = Object.keys(salaryUpdate).length > 0
        ? ` (+salary ${salaryUpdate.SalaryMin ?? '?'}-${salaryUpdate.SalaryMax ?? '?'} ${salaryUpdate.SalaryCurrency}/${salaryUpdate.SalaryInterval})`
        : '';
    console.log(`[Gemma] Stored parsedRequirements for ${job._id} | ${job.JobTitle}${salaryNote}`);
    return true;
}
