// ─── Resume Matcher — Orchestrator + Barrel ────────────────────────────────────
//
// Ties the pipeline together: parse → filter → score.
// Saves the parsed profile on the user doc (with hash) so re-uploads of the
// same resume skip the Gemini parse call entirely.

import crypto from 'crypto';
import { parseResume, parseResumeFromText } from './parseResume.js';
import { filterJobs } from './filterJobs.js';
import { scoreJobs } from './scoreJobs.js';
import { getCacheStats } from '../cache/index.js';
import { saveMatchProfile, getMatchProfile } from '../db/index.js';

function md5(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

function buildMeta(totalJobsSearched, afterHardFilter, startTime, skippedParse) {
    const parseCalls = skippedParse ? 0 : 1;
    const geminiCallsUsed = parseCalls + Math.ceil(afterHardFilter / 50) + 2;
    return {
        totalJobsSearched,
        afterHardFilter,
        processingTimeMs: Date.now() - startTime,
        geminiCallsUsed,
        profileReused: skippedParse,
        timestamp: new Date().toISOString(),
    };
}

async function runPipeline(parseFn, userId, resumeHash) {
    const startTime = Date.now();
    let profile;
    let skippedParse = false;

    // ── Try to reuse stored profile if hash matches (or no hash = "use stored") ──
    if (userId) {
        try {
            const stored = await getMatchProfile(userId);
            if (stored?.parsedProfile) {
                const hashMatches = !resumeHash || stored.lastResumeHash === resumeHash;
                if (hashMatches) {
                    profile = stored.parsedProfile;
                    skippedParse = true;
                    console.log('[ResumeMatch] Reusing stored profile');
                }
            }
        } catch { /* fall through to fresh parse */ }
    }

    // ── Parse resume if no stored profile ──────────────────────────────
    if (!profile) {
        profile = await parseFn();

        // Save to user doc for reuse
        if (userId) {
            saveMatchProfile(userId, profile, resumeHash || null).catch(err =>
                console.warn('[ResumeMatch] Failed to save profile:', err.message)
            );
        }
    }

    // ── Merge job preferences from user doc ────────────────────────────
    if (userId) {
        try {
            const stored = await getMatchProfile(userId);
            if (stored?.jobPreferences) {
                profile._jobPreferences = stored.jobPreferences;
            }
        } catch { /* preferences are optional */ }
    }

    // ── Filter ─────────────────────────────────────────────────────────
    const filteredJobs = filterJobs(profile);
    const totalJobsSearched = getCacheStats().size;

    if (filteredJobs.length === 0) {
        return {
            profile,
            results: [],
            meta: { totalJobsSearched, afterHardFilter: 0, processingTimeMs: Date.now() - startTime, geminiCallsUsed: skippedParse ? 0 : 1, profileReused: skippedParse, timestamp: new Date().toISOString() },
        };
    }

    // ── Score ───────────────────────────────────────────────────────────
    const results = await scoreJobs(profile, filteredJobs);

    return {
        profile,
        results,
        meta: buildMeta(totalJobsSearched, filteredJobs.length, startTime, skippedParse),
    };
}

export async function matchResumeToJobs(pdfBuffer, mimeType, userId) {
    const resumeHash = md5(pdfBuffer);
    return runPipeline(() => parseResume(pdfBuffer, mimeType), userId, resumeHash);
}

export async function matchResumeTextToJobs(text, userId) {
    // text === null means "use stored profile, don't parse"
    if (!text) {
        return runPipeline(async () => {
            throw new Error('No text provided and no stored profile found');
        }, userId, null);
    }
    const resumeHash = md5(Buffer.from(text, 'utf8'));
    return runPipeline(() => parseResumeFromText(text), userId, resumeHash);
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
} from './prompts.js';
export {
    buildPassAUserMessage,
    buildPassBUserMessage,
} from './promptBuilders.js';