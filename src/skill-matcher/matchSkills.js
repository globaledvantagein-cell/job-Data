// ─── Skill Matcher ─────────────────────────────────────────────────────────────
//
// Pure programmatic skill matching — no AI, no API calls.
// Reads from the RAM jobs cache, compares user profile skills against
// parsedRequirements on each job, returns top N matches scored by overlap.
//
// Scoring (per job):
//   1. Skill overlap      — required match = 3pts, preferred = 1pt, tool = 1pt
//   2. Experience level   — penalise big seniority gaps (Entry↔Director)
//   3. Domain alignment   — boost same-domain jobs
//   Final score = (skill points / max skill points) * levelMultiplier * domainMultiplier
//
// Additional safeguards:
//   - Synonym map for ~100 common tech skill aliases
//   - Compound skill names (>4 words) excluded from denominator
//   - Thin profiles (<3 skills) return a dedicated reason
//   - Date-seeded tiebreaker for daily rotation

import { getAllJobs } from '../cache/jobsCache.js';

// ── Skill Synonym Map ────────────────────────────────────────────────────────
// Canonical → list of aliases (all lowercase, no dots/dashes/spaces).
// buildUserSkillSet and scoreJob both resolve through this map.
const SYNONYM_GROUPS = [
    ['javascript',     'js'],
    ['typescript',     'ts'],
    ['nodejs',         'node'],
    ['reactjs',        'react'],
    ['vuejs',          'vue'],
    ['angularjs',      'angular'],
    ['nextjs',         'next'],
    ['expressjs',      'express'],
    ['nestjs',         'nest'],
    ['postgresql',     'postgres', 'psql'],
    ['mongodb',        'mongo'],
    ['mysql',          'mariadb'],
    ['kubernetes',     'k8s'],
    ['docker',         'containers', 'containerization'],
    ['amazonwebservices', 'aws'],
    ['googlecloudplatform', 'gcp', 'googlecloud'],
    ['microsoftazure', 'azure'],
    ['machinelearning','ml'],
    ['artificialintelligence', 'ai'],
    ['naturallanguageprocessing', 'nlp'],
    ['deeplearning',   'dl'],
    ['largelanguagemodel', 'llm', 'llms'],
    ['continuousintegrationcontinuousdelivery', 'cicd', 'ci', 'cd'],
    ['csharp',         'c#', 'dotnet', 'net'],
    ['cplusplus',      'cpp', 'c++'],
    ['golang',         'go'],
    ['python3',        'python'],
    ['rubyonrails',    'rails', 'ror'],
    ['springboot',     'spring'],
    ['graphql',        'gql'],
    ['restapi',        'rest', 'restful', 'restapis'],
    ['terraform',      'tf'],
    ['figma',          'sketch', 'adobexd'],
    ['tailwindcss',    'tailwind'],
    ['sass',           'scss'],
    ['elasticsearch',  'elastic', 'es'],
    ['apachekafka',    'kafka'],
    ['rabbitmq',       'amqp'],
    ['redis',          'rediscache'],
    ['github',         'git'],
    ['gitlab',         'git'],
    ['bitbucket',      'git'],
    ['jira',           'atlassian'],
    ['dataanalysis',   'dataanalytics', 'analytics'],
    ['businessintelligence', 'bi'],
    ['powerbi',        'microsoftbi'],
    ['tableau',        'tableaudesktop'],
    ['sapfiori',       'sap'],
];

// Build a fast lookup: normalised name → canonical name
const synonymLookup = new Map();
for (const group of SYNONYM_GROUPS) {
    const canonical = group[0];
    for (const alias of group) {
        synonymLookup.set(alias, canonical);
    }
}

// ── Experience Level Hierarchy ───────────────────────────────────────────────
const LEVEL_RANK = {
    'entry':       0,
    'junior':      0,
    'intern':      0,
    'mid':         1,
    'midlevel':    1,
    'mid-level':   1,
    'senior':      2,
    'staff':       3,
    'principal':   3,
    'lead':        3,
    'manager':     3,
    'director':    4,
    'vp':          5,
    'head':        4,
    'c-level':     5,
    'executive':   5,
};

function getLevelRank(level) {
    if (!level) return -1;
    const key = String(level).toLowerCase().trim();
    return LEVEL_RANK[key] ?? -1;
}

// ── Normalisation ────────────────────────────────────────────────────────────
function normalizeSkillName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[.\-\/\s\(\)]+/g, '')
        .trim();
}

// Resolve a normalised skill name to its canonical form via synonyms
function toCanonical(normalised) {
    return synonymLookup.get(normalised) || normalised;
}

// Extract skill name from either string or { name } object
function extractName(item) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && typeof item.name === 'string') return item.name;
    return null;
}

// Check if a skill name is a vague compound phrase (>4 words) that will
// never match a user's specific skills and just inflates the denominator.
function isCompoundSkill(name) {
    if (!name) return false;
    return name.split(/\s+/).length > 4;
}

// ── Build user skill set ─────────────────────────────────────────────────────
function buildUserSkillSet(profileSkills) {
    const set = new Set();
    if (!Array.isArray(profileSkills)) return set;
    for (const skill of profileSkills) {
        const name = extractName(skill);
        if (name) {
            set.add(toCanonical(normalizeSkillName(name)));
        }
    }
    return set;
}

// ── Score a single job ───────────────────────────────────────────────────────
function scoreJob(job, userSkills) {
    const req = job.parsedRequirements;
    if (!req) return null;

    const required  = Array.isArray(req.required_skills)  ? req.required_skills  : [];
    const preferred = Array.isArray(req.preferred_skills)  ? req.preferred_skills  : [];
    const tools     = Array.isArray(req.tools_and_platforms) ? req.tools_and_platforms : [];

    let rawPoints = 0;
    let maxPoints = 0;
    let totalSkillCount = 0;
    const matchedSkills = [];
    const seen = new Set();

    function checkSkill(skill, weight) {
        const name = extractName(skill);
        if (!name) return;

        // Skip vague compound skills — they inflate the denominator
        if (isCompoundSkill(name)) return;

        totalSkillCount++;
        const canonical = toCanonical(normalizeSkillName(name));
        maxPoints += weight;

        if (userSkills.has(canonical) && !seen.has(canonical)) {
            rawPoints += weight;
            matchedSkills.push(name);
            seen.add(canonical);
        }
    }

    for (const s of required)  checkSkill(s, 3);
    for (const s of preferred) checkSkill(s, 1);
    for (const s of tools)     checkSkill(s, 1);

    if (totalSkillCount === 0 || rawPoints === 0) return null;

    return {
        skillScore: maxPoints > 0 ? rawPoints / maxPoints : 0,
        rawPoints,
        maxPoints,
        matchedSkills,
        matchedCount: matchedSkills.length,
        totalSkillCount,
    };
}

// ── Experience Level Penalty ─────────────────────────────────────────────────
// Returns a multiplier 0.0–1.0 that penalises large seniority gaps.
// Same level = 1.0, 1 level apart = 0.85, 2 = 0.6, 3+ = 0.3
function levelMultiplier(profileLevel, jobLevel) {
    const pRank = getLevelRank(profileLevel);
    const jRank = getLevelRank(jobLevel);

    // If either is unknown, don't penalise — give benefit of the doubt
    if (pRank < 0 || jRank < 0) return 1.0;

    const gap = Math.abs(pRank - jRank);
    if (gap === 0) return 1.0;
    if (gap === 1) return 0.85;
    if (gap === 2) return 0.6;
    return 0.3; // 3+ levels apart (e.g. Entry ↔ Director)
}

// ── Domain Alignment Boost ───────────────────────────────────────────────────
// Returns 1.0 for same domain, 0.85 for cross-domain.
// Not a hard filter — a software engineer CAN get data roles — just ranked lower.
function domainMultiplier(profileDomain, jobDomain) {
    if (!profileDomain || !jobDomain) return 1.0;
    const p = profileDomain.toLowerCase();
    const j = jobDomain.toLowerCase();
    if (p === j) return 1.0;
    // Technical ↔ Non-Technical is a bigger gap
    if ((p === 'technical' && j === 'non-technical') ||
        (p === 'non-technical' && j === 'technical')) return 0.75;
    return 0.85;
}

// ── Date-seeded tiebreaker ───────────────────────────────────────────────────
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

// ── Main entry point ─────────────────────────────────────────────────────────
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

    // Thin profile guard — fewer than 3 skills produces noisy results
    if (profileSkills.length < 3) {
        return { matches: [], meta: { reason: 'too_few_skills', userSkillCount: profileSkills.length } };
    }

    const userSkills = buildUserSkillSet(profileSkills);
    if (userSkills.size === 0) {
        return { matches: [], meta: { reason: 'no_skills' } };
    }

    // Guard: if the cache hasn't loaded yet, return empty gracefully
    let allJobs;
    try {
        allJobs = getAllJobs();
    } catch {
        return { matches: [], meta: { reason: 'cache_not_ready' } };
    }

    const profileLevel  = parsedProfile.seniority_level || parsedProfile.experience_level || null;
    const profileDomain = parsedProfile.domain || null;
    const seed = dateSeed();
    const scored = [];
    let jobsWithRequirements = 0;

    for (const job of allJobs) {
        if (!job.parsedRequirements) continue;
        jobsWithRequirements++;

        const result = scoreJob(job, userSkills);
        if (!result) continue;

        // Apply experience level and domain multipliers
        const lvlMult = levelMultiplier(profileLevel, job.ExperienceLevel);
        const domMult = domainMultiplier(profileDomain, job.Domain);
        const finalScore = result.skillScore * lvlMult * domMult;

        scored.push({
            _id:             job._id,
            JobID:           job.JobID,
            JobTitle:        job.JobTitle,
            Company:         job.Company,
            Location:        job.Location,
            WorkplaceType:   job.WorkplaceType,
            ExperienceLevel: job.ExperienceLevel,
            Category:        job.Category,
            PostedDate:      job.PostedDate,
            scrapedAt:       job.scrapedAt,
            isEntryLevel:    job.isEntryLevel,
            applyClicks:     job.applyClicks || 0,
            // Match info
            score:           finalScore,
            rawPoints:       result.rawPoints,
            matchedSkills:   result.matchedSkills,
            matchedCount:    result.matchedCount,
            totalSkillCount: result.totalSkillCount,
            // Tiebreaker
            _tiebreaker:     hashForShuffle(String(job.JobID), seed),
        });
    }

    // Sort: highest score first, then tiebreaker for daily rotation
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a._tiebreaker - b._tiebreaker;
    });

    const matches = scored.slice(0, limit).map(({ _tiebreaker, ...rest }) => rest);

    return {
        matches,
        meta: {
            reason: matches.length === 0 ? 'no_matches' : 'ok',
            totalJobsScanned: allJobs.length,
            jobsWithRequirements,
            userSkillCount: userSkills.size,
        },
    };
}