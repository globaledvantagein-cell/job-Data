// ─── Extract Requirements ──────────────────────────────────────────────────────
//
// Uses Gemma 4 31B to extract structured requirements from a job description.
// Returns a validated object, or null if extraction fails after retries — the
// caller decides how to handle failures.
//
// Separate from src/gemini/ — does not import from it.

import { callGemma } from './gemmaClient.js';

const VALID_EXPERIENCE_LEVELS = ['Entry', 'Mid', 'Senior', 'Lead', 'Executive'];
const VALID_EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];

const SYSTEM_PROMPT = `You are a job description parser. Extract structured requirements from the job description below.

Return ONLY valid JSON, no markdown fences, no preamble, no explanation.

{
  "required_skills": ["list of explicitly required technical and professional skills"],
  "preferred_skills": ["list of nice-to-have or preferred skills"],
  "min_experience_years": <number or null if not mentioned>,
  "required_education": "<highest education requirement or null>",
  "experience_level": "<Entry | Mid | Senior | Lead | Executive | null>",
  "employment_type": "<Full-time | Part-time | Contract | Internship | null>",
  "key_responsibilities": ["top 3-5 core responsibilities, short phrases"]
}

RULES:
- Extract skills as they appear. "React" stays "React", "SQL" stays "SQL". Do not infer skills not mentioned.
- For min_experience_years: look for patterns like "3+ years", "minimum 5 years", "at least 2 years". If a range like "3-5 years" is given, use the minimum (3). If not mentioned, return null.
- For required_education: look for "Bachelor's", "Master's", "PhD", "degree in CS", etc. Return the specific requirement or null.
- For experience_level: infer from job title and years required if not explicitly stated.
  Junior/Associate/Entry = Entry
  Mid-level/Intermediate/no prefix = Mid
  Senior/Staff = Senior
  Lead/Principal/Head = Lead
  Director/VP/C-level = Executive
- For employment_type: look for Full-time, Part-time, Contract, Freelance, Internship.
- For key_responsibilities: pick the 3-5 most important duties. Keep them short (under 10 words each).
- Keep arrays empty (not null) if nothing found.
- Do NOT include soft skills like "team player" or "good communication" in required_skills — only technical/professional skills.`;

/**
 * Strips HTML tags from a description and collapses whitespace.
 */
function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Robustly parses Gemma's JSON response.
 *   1. Strip markdown fences if present.
 *   2. Try JSON.parse directly.
 *   3. Fall back to extracting the first {...} object via regex.
 * Throws a descriptive error if all attempts fail.
 */
function parseJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('[Gemma] Empty response — nothing to parse');
    }

    // Strip ```json ... ``` or ``` ... ``` fences.
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        // Fall through to regex extraction.
    }

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch {
            // Fall through to throw.
        }
    }

    throw new Error('[Gemma] Failed to parse JSON from response');
}

/**
 * Normalizes a value into a string array (drops non-strings).
 */
function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => typeof item === 'string');
}

/**
 * Coerces a value into an enum member or null.
 */
function normalizeEnum(value, allowed) {
    return allowed.includes(value) ? value : null;
}

/**
 * Validates and normalizes the parsed model output into the canonical shape.
 */
function validateResult(parsed) {
    const minYears = parsed?.min_experience_years;
    const normalizedMinYears = typeof minYears === 'number' ? minYears : null;

    const education = parsed?.required_education;
    const normalizedEducation = typeof education === 'string' && education.trim()
        ? education
        : null;

    return {
        required_skills: normalizeStringArray(parsed?.required_skills),
        preferred_skills: normalizeStringArray(parsed?.preferred_skills),
        min_experience_years: normalizedMinYears,
        required_education: normalizedEducation,
        experience_level: normalizeEnum(parsed?.experience_level, VALID_EXPERIENCE_LEVELS),
        employment_type: normalizeEnum(parsed?.employment_type, VALID_EMPLOYMENT_TYPES),
        key_responsibilities: normalizeStringArray(parsed?.key_responsibilities),
    };
}

/**
 * Extracts structured requirements from a job document via Gemma 4 31B.
 *
 * @param {{ Description?: string, JobTitle?: string, Company?: string }} job
 * @returns {Promise<object|null>} validated requirements + extractedAt, or null on failure
 */
export async function extractRequirements(job) {
    const description = stripHtml(job?.Description);
    if (!description) {
        console.warn('[Gemma] extractRequirements — empty description, skipping');
        return null;
    }

    const jobTitle = job?.JobTitle || '';
    const company = job?.Company || '';
    const userMessage =
        `Job Title: ${jobTitle}\n` +
        `Company: ${company}\n\n` +
        `Job Description:\n${description}`;

    try {
        const raw = await callGemma(SYSTEM_PROMPT, userMessage);
        const parsed = parseJsonResponse(raw);
        const validated = validateResult(parsed);

        return {
            ...validated,
            extractedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error(
            `[Gemma] extractRequirements failed for "${jobTitle}" @ ${company}: ${error.message}`
        );
        return null;
    }
}
