// ─── Resume Matcher — Resume Parsing ───────────────────────────────────────────
//
// Turns a resume (PDF/DOCX buffer or pasted text) into a structured profile via
// Gemini. Robust JSON parsing (strip fences → JSON.parse → regex fallback) and
// light validation so downstream steps get a predictable shape.

import { callGemini, callGeminiWithPdf } from './geminiClient.js';
import { getResumeParsePrompt } from './prompts.js';

const VALID_LEVELS = ['Entry', 'Mid', 'Senior', 'Lead', 'Executive'];

/**
 * Robustly parses a model JSON response.
 *   1. Strip ```json ... ``` fences.
 *   2. Try JSON.parse.
 *   3. Fall back to extracting the first {...} or [...] block via regex.
 * Throws a descriptive error if all attempts fail.
 */
function parseJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('[ResumeMatch] Empty response — cannot parse resume');
    }

    let cleaned = raw.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        // fall through
    }

    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch {
            // fall through
        }
    }

    throw new Error('[ResumeMatch] Failed to parse resume JSON from model response');
}

/**
 * Normalizes a value into an array (empty array if not an array).
 */
function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Validates and normalizes the raw parsed profile into a predictable shape.
 */
function validateProfile(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('[ResumeMatch] Parsed resume is not a JSON object');
    }

    const experienceYears = typeof parsed.experience_years === 'number'
        ? parsed.experience_years
        : null;

    const level = VALID_LEVELS.includes(parsed.level) ? parsed.level : null;

    return {
        name: typeof parsed.name === 'string' ? parsed.name : null,
        current_role: typeof parsed.current_role === 'string' ? parsed.current_role : null,
        experience_years: experienceYears,
        level,
        domain: typeof parsed.domain === 'string' ? parsed.domain : 'Other',
        skills: asArray(parsed.skills).filter(s => typeof s === 'string'),
        languages: asArray(parsed.languages).filter(l => l && typeof l === 'object'),
        location: typeof parsed.location === 'string' ? parsed.location : null,
        open_to_remote: typeof parsed.open_to_remote === 'boolean' ? parsed.open_to_remote : null,
        education: typeof parsed.education === 'string' ? parsed.education : null,
        certifications: asArray(parsed.certifications),
        industries: asArray(parsed.industries),
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
}

/**
 * Parses a resume from a PDF/DOCX buffer.
 *
 * @param {Buffer} pdfBuffer
 * @param {string} mimeType - e.g. 'application/pdf'
 * @returns {Promise<object>} validated profile
 * @throws on parse failure (caller handles)
 */
export async function parseResume(pdfBuffer, mimeType) {
    const base64 = pdfBuffer.toString('base64');
    const prompt = getResumeParsePrompt();

    const raw = await callGeminiWithPdf(base64, mimeType, prompt);
    const parsed = parseJsonResponse(raw);
    return validateProfile(parsed);
}

/**
 * Parses a resume from pasted plain text (fallback when no file / PDF fails).
 *
 * @param {string} text
 * @returns {Promise<object>} validated profile
 * @throws on parse failure (caller handles)
 */
export async function parseResumeFromText(text) {
    const raw = await callGemini(getResumeParsePrompt(), text);
    const parsed = parseJsonResponse(raw);
    return validateProfile(parsed);
}
