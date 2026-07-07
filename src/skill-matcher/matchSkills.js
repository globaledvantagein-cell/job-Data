// ─── Skill Matcher ─────────────────────────────────────────────────────────────
//
// Pure programmatic skill matching — no AI, no API calls.
// Reads from the RAM jobs cache, compares user profile skills against
// parsedRequirements on each job, returns top N matches scored by overlap.
//
// Scoring:
//   - Required skill match  = 3 points
//   - Preferred skill match = 1 point
//   - Tool/platform match   = 1 point
//   - Final score is (raw points / max possible points) so jobs needing
//     2 of your skills rank higher than jobs needing 3 of 20.
//
// Daily rotation: among same-score jobs, a date-seeded hash shuffles
// the order so users see different picks each day.

import { getAllJobs } from '../cache/jobsCache.js';

// ── Normalisation ──────────────────────────────────────────────────────────────
// "Node.js" → "nodejs", "Express.js" → "expressjs", "CI/CD" → "cicd"
function normalizeSkillName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[.\-\/\s]+/g, '')
        .trim();
}

// Extract skill name from either string or { name } object
function extractName(item) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && typeof item.name === 'string') return item.name;
    return null;
}

// ── Build user skill set ───────────────────────────────────────────────────────
function buildUserSkillSet(profileSkills) {
    const set = new Set();
    if (!Array.isArray(profileSkills)) return set;
    for (const skill of profileSkills) {
        const name = extractName(skill);
        if (name) set.add(normalizeSkillName(name));
    }
    return set;
}

// ── Score a single job ─────────────────────────────────────────────────────────
function scoreJob(job, userSkills) {
    const req = job.parsedRequirements;
    if (!req) return null;

    const required  = Array.isArray(req.required_skills)  ? req.required_skills  : [];
    const preferred = Array.isArray(req.preferred_skills)  ? req.preferred_skills  : [];
    const tools     = Array.isArray(req.tools_and_platforms) ? req.tools_and_platforms : [];

    // If job has zero skills to match against, skip it
    const totalSkillCount = required.length + preferred.length + tools.length;
    if (totalSkillCount === 0) return null;

    let rawPoints = 0;
    let maxPoints = 0;
    const matchedSkills = [];

    // Required skills: 3 points each
    for (const skill of required) {
        const name = extractName(skill);
        if (!name) continue;
        maxPoints += 3;
        if (userSkills.has(normalizeSkillName(name))) {
            rawPoints += 3;
            matchedSkills.push(name);
        }
    }

    // Preferred skills: 1 point each
    for (const skill of preferred) {
        const name = extractName(skill);
        if (!name) continue;
        maxPoints += 1;
        if (userSkills.has(normalizeSkillName(name))) {
            rawPoints += 1;
            matchedSkills.push(name);
        }
    }

    // Tools/platforms: 1 point each
    for (const tool of tools) {
        const name = extractName(tool);
        if (!name) continue;
        maxPoints += 1;
        if (userSkills.has(normalizeSkillName(name))) {
            rawPoints += 1;
            matchedSkills.push(name);
        }
    }

    // No matches at all → skip
    if (rawPoints === 0) return null;

    return {
        score: maxPoints > 0 ? rawPoints / maxPoints : 0,
        rawPoints,
        maxPoints,
        matchedSkills,
        matchedCount: matchedSkills.length,
        totalSkillCount,
    };
}

// ── Date-seeded tiebreaker ─────────────────────────────────────────────────────
// Simple hash so same-score jobs shuffle daily
function dateSeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function hashForShuffle(str, seed) {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}

// ── Main entry point ───────────────────────────────────────────────────────────
/**
 * Match a user's profile skills against all active jobs in the RAM cache.
 *
 * @param {object} parsedProfile - User's parsedProfile from the DB
 * @param {number} limit - Number of results to return (default 5)
 * @returns {{ matches: object[], meta: object }}
 */
export function getSkillMatches(parsedProfile, limit = 5) {
    if (!parsedProfile) {
        return { matches: [], meta: { reason: 'no_profile' } };
    }

    const profileSkills = parsedProfile.skills;
    if (!Array.isArray(profileSkills) || profileSkills.length === 0) {
        return { matches: [], meta: { reason: 'no_skills' } };
    }

    const userSkills = buildUserSkillSet(profileSkills);
    if (userSkills.size === 0) {
        return { matches: [], meta: { reason: 'no_skills' } };
    }

    const allJobs = getAllJobs();
    const seed = dateSeed();
    const scored = [];

    for (const job of allJobs) {
        // Skip jobs without parsedRequirements
        if (!job.parsedRequirements) continue;

        const result = scoreJob(job, userSkills);
        if (!result) continue;

        scored.push({
            _id:            job._id,
            JobID:          job.JobID,
            JobTitle:       job.JobTitle,
            Company:        job.Company,
            Location:       job.Location,
            WorkplaceType:  job.WorkplaceType,
            ExperienceLevel: job.ExperienceLevel,
            Category:       job.Category,
            PostedDate:     job.PostedDate,
            scrapedAt:      job.scrapedAt,
            isEntryLevel:   job.isEntryLevel,
            applyClicks:    job.applyClicks || 0,
            // Match info
            score:          result.score,
            rawPoints:      result.rawPoints,
            matchedSkills:  result.matchedSkills,
            matchedCount:   result.matchedCount,
            totalSkillCount: result.totalSkillCount,
            // Tiebreaker
            _tiebreaker:    hashForShuffle(String(job.JobID), seed),
        });
    }

    // Sort: highest score first, then tiebreaker for daily rotation
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a._tiebreaker - b._tiebreaker;
    });

    // Take top N, strip internal fields
    const matches = scored.slice(0, limit).map(({ _tiebreaker, ...rest }) => rest);

    return {
        matches,
        meta: {
            reason: matches.length === 0 ? 'no_matches' : 'ok',
            totalJobsScanned: allJobs.length,
            jobsWithRequirements: scored.length + allJobs.filter(j => j.parsedRequirements && !scoreJob(j, userSkills)).length,
            userSkillCount: userSkills.size,
        },
    };
}