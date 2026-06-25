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

    const db = await connectToDb();
    await db.collection('jobs').updateOne(
        { _id: job._id },
        { $set: { parsedRequirements: result } }
    );

    console.log(`[Gemma] Stored parsedRequirements for ${job._id} | ${job.JobTitle}`);
    return true;
}
