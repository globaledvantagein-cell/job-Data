// ─── Resume Matcher — Scoring (Pass A + Pass B) ────────────────────────────────
//
// Step 3 of the pipeline. Two passes, both SEQUENTIAL (Gemini RPM limits):
//   Pass A — coarse: batches of 20, returns top 20 by score.
//   Pass B — deep:   batches of 10 over those 20, full descriptions, top 15.
//
// A single bad batch (Gemini error / unparseable JSON) is logged and SKIPPED.
// Only when EVERY batch in a pass fails do we throw.

import { connectToDb } from '../db/connection.js';
import { callGemini } from './geminiClient.js';
import {
    getPassASystemPrompt,
    getPassBSystemPrompt,
} from './prompts.js';
import {
    buildPassAUserMessage,
    buildPassBUserMessage,
} from './promptBuilders.js';

const PASS_A_BATCH_SIZE = 50;
const PASS_B_BATCH_SIZE = 10;
const PASS_A_TOP_N = 20;
const PASS_B_TOP_N = 15;
const DELAY_BETWEEN_BATCHES_MS = 500;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Robustly parses a model response into a JSON array.
 *   strip fences → JSON.parse → regex-extract [...] → JSON.parse
 * Throws if nothing parses into an array.
 */
function parseJsonArray(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('[ResumeMatch] Empty scoring response');
    }

    let cleaned = raw.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) return parsed;
    } catch {
        // fall through
    }

    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
    }

    throw new Error('[ResumeMatch] Scoring response was not a JSON array');
}

/**
 * Splits an array into fixed-size chunks.
 */
function chunk(items, size) {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
        batches.push(items.slice(i, i + size));
    }
    return batches;
}

/**
 * Maps a tier label from a numeric score.
 */
function tierFromScore(score) {
    if (score >= 85) return 'strong';
    if (score >= 65) return 'good';
    return 'partial';
}

/**
 * Ensures each job has a Description; cached jobs normally do, but if one is
 * missing (e.g. stripped), fetch it from the DB by _id.
 */
async function ensureDescriptions(jobs) {
    const missing = jobs.filter(job => !job.Description);
    if (missing.length === 0) return jobs;

    const db = await connectToDb();
    const collection = db.collection('jobs');

    await Promise.all(missing.map(async (job) => {
        const full = await collection.findOne(
            { _id: job._id },
            { projection: { Description: 1 } }
        );
        if (full?.Description) job.Description = full.Description;
    }));

    return jobs;
}

/**
 * Pass A — coarse scoring. Returns the top PASS_A_TOP_N jobs (job + score + reason),
 * sorted by score descending.
 */
async function runPassA(profile, jobs) {
    const batches = chunk(jobs, PASS_A_BATCH_SIZE);
    const scored = [];
    let failedBatches = 0;

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        try {
            const raw = await callGemini(getPassASystemPrompt(), buildPassAUserMessage(profile, batch));
            const rows = parseJsonArray(raw);

            for (const row of rows) {
                const job = batch[row.index];      // index is batch-relative
                if (!job) continue;                // ignore hallucinated indexes
                const score = Number(row.score);
                if (Number.isNaN(score)) continue;
                scored.push({ job, score, reason: row.reason || '' });
            }
        } catch (error) {
            failedBatches++;
            console.warn(`[ResumeMatch] Pass A batch ${b + 1}/${batches.length} failed: ${error.message}`);
        }

        if (b < batches.length - 1) await sleep(DELAY_BETWEEN_BATCHES_MS);
    }

    if (failedBatches === batches.length) {
        throw new Error('[ResumeMatch] Pass A failed — all batches errored');
    }

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, PASS_A_TOP_N);
}

/**
 * Pass B — deep scoring over the shortlist. Returns up to PASS_B_TOP_N enriched
 * results sorted by score descending.
 */
async function runPassB(profile, shortlistedJobs) {
    await ensureDescriptions(shortlistedJobs);

    const batches = chunk(shortlistedJobs, PASS_B_BATCH_SIZE);
    const results = [];
    let failedBatches = 0;

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        try {
            const raw = await callGemini(getPassBSystemPrompt(), buildPassBUserMessage(profile, batch));
            const rows = parseJsonArray(raw);

            for (const row of rows) {
                const job = batch[row.index];      // index is batch-relative
                if (!job) continue;
                const score = Number(row.score);
                if (Number.isNaN(score)) continue;

                results.push({
                    jobId: String(job._id),
                    score,
                    tier: tierFromScore(score),
                    matched_skills: Array.isArray(row.matched_skills) ? row.matched_skills : [],
                    missing_skills: Array.isArray(row.missing_skills) ? row.missing_skills : [],
                    bonus_skills: Array.isArray(row.bonus_skills) ? row.bonus_skills : [],
                    experience_fit: row.experience_fit || null,
                    location_fit: row.location_fit || null,
                    german_fit: row.german_fit || null,
                    visa_fit: row.visa_fit || null,
                    reasoning: row.reasoning || '',
                    job: {
                        JobTitle: job.JobTitle,
                        Company: job.Company,
                        Location: job.Location,
                        IsRemote: job.IsRemote,
                        ApplicationURL: job.ApplicationURL,
                    },
                });
            }
        } catch (error) {
            failedBatches++;
            console.warn(`[ResumeMatch] Pass B batch ${b + 1}/${batches.length} failed: ${error.message}`);
        }

        if (b < batches.length - 1) await sleep(DELAY_BETWEEN_BATCHES_MS);
    }

    if (failedBatches === batches.length) {
        throw new Error('[ResumeMatch] Pass B failed — all batches errored');
    }

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, PASS_B_TOP_N);
}

/**
 * Scores filtered jobs against the candidate profile (Pass A → Pass B).
 *
 * @param {object} profile
 * @param {Array<object>} jobs - the hard-filtered job set
 * @returns {Promise<Array<object>>} ranked, enriched results (top 15)
 */
export async function scoreJobs(profile, jobs) {
    const shortlist = await runPassA(profile, jobs);
    if (shortlist.length === 0) return [];

    const shortlistedJobs = shortlist.map(entry => entry.job);
    return runPassB(profile, shortlistedJobs);
}