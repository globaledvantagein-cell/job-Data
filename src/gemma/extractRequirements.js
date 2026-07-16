// ─── Extract Requirements ──────────────────────────────────────────────────────
//
// Uses Gemma 4 to extract structured requirements from a job description.
// Returns a validated object, or null if extraction fails — caller decides.

import { callGemma } from './gemmaClient.js';

const VALID_EXPERIENCE_LEVELS = ['Entry', 'Mid', 'Senior', 'Lead', 'Executive'];
const VALID_EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
const VALID_SKILL_CATEGORIES = ['Language', 'Framework', 'Database', 'Cloud', 'DevOps', 'Tool', 'Domain', 'Other'];
const VALID_SPONSORSHIP = ['available', 'not_available', 'not_mentioned'];
const VALID_REMOTE = ['fully_remote', 'hybrid', 'on_site', 'not_mentioned'];
const VALID_RELOCATION = ['available', 'not_available', 'not_mentioned'];
const VALID_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const VALID_SALARY_INTERVALS = ['yearly', 'monthly', 'hourly'];

// Plausible ranges per interval. Gemma reads "70k" as 70 about as often as
// 70000, so an unbounded number would put "€0K" on a job card. Anything
// outside these bounds is treated as a misread and dropped rather than shown.
const SALARY_BOUNDS = {
    yearly:  { min: 10000, max: 1000000 },
    monthly: { min: 800,   max: 100000 },
    hourly:  { min: 5,     max: 2000 },
};

const SYSTEM_PROMPT = `You are a job description parser for a German job market platform. Extract structured requirements from the job description below.

Return ONLY valid JSON, no markdown fences, no preamble.

{
  "required_skills": [{ "name": "skill name", "category": "Language | Framework | Database | Cloud | DevOps | Tool | Domain | Other" }],
  "preferred_skills": [{ "name": "skill name", "category": "category" }],
  "tools_and_platforms": ["Jira", "Confluence", "Figma"],
  "min_experience_years": <number or null>,
  "max_experience_years": <number or null>,
  "required_education": "<education requirement or null>",
  "experience_level": "<Entry | Mid | Senior | Lead | Executive | null>",
  "employment_type": "<Full-time | Part-time | Contract | Internship | null>",
  "german_level_detail": "<e.g. 'C1 required' | 'B2 preferred' | 'nice to have' | 'not mentioned'>",
  "visa_sponsorship": "<available | not_available | not_mentioned>",
  "remote_policy_detail": "<fully_remote | hybrid | on_site | not_mentioned>",
  "relocation_support": "<available | not_available | not_mentioned>",
  "team_context": "<e.g. 'team of 5 engineers' | 'cross-functional squad' | null>",
  "key_responsibilities": ["top 3-5 duties, short phrases"],
  "salary_min": <number or null>,
  "salary_max": <number or null>,
  "salary_currency": "<EUR | USD | GBP | CHF | null>",
  "salary_interval": "<yearly | monthly | hourly | null>"
}

RULES:
- Skill categories: Language (JS, Python, Java), Framework (React, Django, Spring), Database (PostgreSQL, MongoDB), Cloud (AWS, GCP, Azure), DevOps (Docker, Kubernetes, CI/CD), Tool (Git, VS Code), Domain (ML, NLP, FinTech), Other.
- tools_and_platforms: project management and collaboration tools (Jira, Confluence, Slack, Figma, Salesforce). NOT programming languages or frameworks.
- min/max_experience_years: "3-5 years" → min 3, max 5. "5+ years" → min 5, max null. Not mentioned → both null.
- german_level_detail: look for "Deutsch", "German", CEFR levels (A1-C2), "Deutschkenntnisse", "fließend Deutsch". Distinguish "required/mandatory/erforderlich" vs "preferred/nice to have/von Vorteil" vs not mentioned.
- visa_sponsorship: look for "visa sponsorship", "work authorization", "EU work permit", "Aufenthaltserlaubnis". If mentions "EU citizens only" → not_available.
- remote_policy_detail: look for "remote", "hybrid", "on-site", "Homeoffice", "work from home". "2-3 days office" = hybrid.
- relocation_support: look for "relocation package", "relocation assistance", "moving support".
- Extract salary/compensation if explicitly mentioned in the JD. Look for patterns like €60,000-€80,000, 70k EUR, competitive salary of €65,000. Return null if no salary is mentioned — do NOT guess.
- salary_min/salary_max: return the FULL number, not shorthand. "70k" → 70000, NOT 70. "€60,000-€80,000" → min 60000, max 80000. A single figure ("salary of €65,000") → min 65000, max 65000. "from €70k" → min 70000, max null.
- salary_currency: infer from the symbol — € → EUR, $ → USD, £ → GBP, CHF → CHF. Null if no salary.
- salary_interval: "per year"/"p.a."/"annually"/"Jahresgehalt" → yearly. "per month"/"monatlich" → monthly. "per hour"/"/h"/"Stundenlohn" → hourly. If a salary is given with no stated period, assume yearly.
- "competitive salary", "attractive compensation", "market rate" with NO number → all salary fields null.
- Do NOT include soft skills in required_skills.
- Keep arrays empty (not null) if nothing found.`;

function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('[Gemma] Empty response — nothing to parse');
    }
    let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
    throw new Error('[Gemma] Failed to parse JSON from response');
}

function normalizeSkillArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (typeof item === 'string') return { name: item, category: 'Other' };
        if (item && typeof item === 'object' && typeof item.name === 'string') {
            return {
                name: item.name,
                category: VALID_SKILL_CATEGORIES.includes(item.category) ? item.category : 'Other',
            };
        }
        return null;
    }).filter(Boolean);
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => typeof item === 'string');
}

function normalizeEnum(value, allowed, fallback = null) {
    return allowed.includes(value) ? value : fallback;
}

const NO_SALARY = { salary_min: null, salary_max: null, salary_currency: null, salary_interval: null };

/**
 * Validates Gemma's salary output. Returns all-null unless the numbers are
 * genuinely usable — a wrong salary on a job card is worse than none.
 *
 * Rejects: non-numbers, zero/negative, values outside SALARY_BOUNDS for the
 * interval, and unknown currencies. Swaps min/max if the model inverts them.
 */
function normalizeSalary(parsed) {
    const rawMin = typeof parsed?.salary_min === 'number' && Number.isFinite(parsed.salary_min) ? parsed.salary_min : null;
    const rawMax = typeof parsed?.salary_max === 'number' && Number.isFinite(parsed.salary_max) ? parsed.salary_max : null;
    if (rawMin === null && rawMax === null) return { ...NO_SALARY };

    // An amount with no period is meaningless to render, and the prompt says
    // to assume yearly — so mirror that here rather than dropping the data.
    const interval = normalizeEnum(parsed?.salary_interval, VALID_SALARY_INTERVALS) || 'yearly';
    const currency = normalizeEnum(
        typeof parsed?.salary_currency === 'string' ? parsed.salary_currency.toUpperCase() : null,
        VALID_CURRENCIES,
    );

    // Currency-less numbers can't be displayed correctly (€60k vs $60k differ).
    if (!currency) return { ...NO_SALARY };

    const bounds = SALARY_BOUNDS[interval];
    const inBounds = (v) => v === null || (v >= bounds.min && v <= bounds.max);
    if (!inBounds(rawMin) || !inBounds(rawMax)) return { ...NO_SALARY };

    let min = rawMin;
    let max = rawMax;
    if (min !== null && max !== null && min > max) [min, max] = [max, min];

    return { salary_min: min, salary_max: max, salary_currency: currency, salary_interval: interval };
}

function validateResult(parsed) {
    const minYears = typeof parsed?.min_experience_years === 'number' ? parsed.min_experience_years : null;
    const maxYears = typeof parsed?.max_experience_years === 'number' ? parsed.max_experience_years : null;
    const education = typeof parsed?.required_education === 'string' && parsed.required_education.trim()
        ? parsed.required_education : null;
    const germanDetail = typeof parsed?.german_level_detail === 'string' && parsed.german_level_detail.trim()
        ? parsed.german_level_detail : 'not mentioned';
    const teamContext = typeof parsed?.team_context === 'string' && parsed.team_context.trim()
        ? parsed.team_context : null;

    return {
        required_skills:      normalizeSkillArray(parsed?.required_skills),
        preferred_skills:     normalizeSkillArray(parsed?.preferred_skills),
        tools_and_platforms:  normalizeStringArray(parsed?.tools_and_platforms),
        min_experience_years: minYears,
        max_experience_years: maxYears,
        required_education:   education,
        experience_level:     normalizeEnum(parsed?.experience_level, VALID_EXPERIENCE_LEVELS),
        employment_type:      normalizeEnum(parsed?.employment_type, VALID_EMPLOYMENT_TYPES),
        german_level_detail:  germanDetail,
        visa_sponsorship:     normalizeEnum(parsed?.visa_sponsorship, VALID_SPONSORSHIP, 'not_mentioned'),
        remote_policy_detail: normalizeEnum(parsed?.remote_policy_detail, VALID_REMOTE, 'not_mentioned'),
        relocation_support:   normalizeEnum(parsed?.relocation_support, VALID_RELOCATION, 'not_mentioned'),
        team_context:         teamContext,
        key_responsibilities: normalizeStringArray(parsed?.key_responsibilities),
        ...normalizeSalary(parsed),
    };
}

export async function extractRequirements(job) {
    const description = stripHtml(job?.Description);
    if (!description) {
        console.warn('[Gemma] extractRequirements — empty description, skipping');
        return null;
    }
    const userMessage = `Job Title: ${job?.JobTitle || ''}\nCompany: ${job?.Company || ''}\n\nJob Description:\n${description}`;
    try {
        const raw = await callGemma(SYSTEM_PROMPT, userMessage);
        const parsed = parseJsonResponse(raw);
        return { ...validateResult(parsed), extractedAt: new Date().toISOString() };
    } catch (error) {
        console.error(`[Gemma] extractRequirements failed for "${job?.JobTitle}" @ ${job?.Company}: ${error.message}`);
        return null;
    }
}