// ─── Resume Matcher — Orchestrator + Barrel ────────────────────────────────────
//
// Ties the pipeline together: parse → filter → score. Two public entry points:
//   matchResumeToJobs(pdfBuffer, mimeType) — for uploaded PDF/DOCX
//   matchResumeTextToJobs(text)            — for pasted resume text

import { parseResume, parseResumeFromText } from './parseResume.js';
import { filterJobs } from './filterJobs.js';
import { scoreJobs } from './scoreJobs.js';
import { getCacheStats } from '../cache/index.js';

/**
 * Builds the meta block for a match response.
 */
function buildMeta(totalJobsSearched, afterHardFilter, startTime) {
    // 1 parse call + ceil(filtered/20) Pass A batches + ~2 Pass B batches.
    const geminiCallsUsed = 1 + Math.ceil(afterHardFilter / 20) + 2;
    return {
        totalJobsSearched,
        afterHardFilter,
        processingTimeMs: Date.now() - startTime,
        geminiCallsUsed,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Shared pipeline driver — `parseFn` produces the profile, everything else is
 * identical for the PDF and text entry points.
 */
async function runPipeline(parseFn) {
    const startTime = Date.now();

    // Step 1 — parse the resume into a structured profile.
    const profile = await parseFn();

    // Step 2 — hard-filter active jobs from the RAM cache.
    const filteredJobs = filterJobs(profile);
    const totalJobsSearched = getCacheStats().size;

    if (filteredJobs.length === 0) {
        return {
            profile,
            results: [],
            meta: {
                totalJobsSearched,
                afterHardFilter: 0,
                processingTimeMs: Date.now() - startTime,
                geminiCallsUsed: 1,
                timestamp: new Date().toISOString(),
            },
        };
    }

    // Step 3 — score (Pass A coarse → Pass B deep).
    const results = await scoreJobs(profile, filteredJobs);

    return {
        profile,
        results,
        meta: buildMeta(totalJobsSearched, filteredJobs.length, startTime),
    };
}

/**
 * Match an uploaded resume file (PDF/DOCX) to active jobs.
 *
 * @param {Buffer} pdfBuffer
 * @param {string} mimeType
 * @returns {Promise<{profile: object, results: object[], meta: object}>}
 */
export async function matchResumeToJobs(pdfBuffer, mimeType) {
    return runPipeline(() => parseResume(pdfBuffer, mimeType));
}

/**
 * Match a pasted-text resume to active jobs.
 *
 * @param {string} text
 * @returns {Promise<{profile: object, results: object[], meta: object}>}
 */
export async function matchResumeTextToJobs(text) {
    return runPipeline(() => parseResumeFromText(text));
}

// ── Barrel re-exports ─────────────────────────────────────────────────────────
export { callGemini, callGeminiWithPdf } from './geminiClient.js';
export { parseResume, parseResumeFromText } from './parseResume.js';
export { filterJobs } from './filterJobs.js';
export { scoreJobs } from './scoreJobs.js';
export {
    getResumeParsePrompt,
    getPassASystemPrompt,
    getPassBSystemPrompt,
    buildPassAUserMessage,
    buildPassBUserMessage,
} from './prompts.js';
