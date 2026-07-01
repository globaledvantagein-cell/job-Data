// ─── Resume Matcher — Resume Parsing ───────────────────────────────────────────
//
// Turns a resume (PDF/DOCX or pasted text) into a structured profile via Gemini.
// Robust JSON parsing and validation so downstream steps get a predictable shape.

import { callGemini, callGeminiWithPdf } from './geminiClient.js';
import { getResumeParsePrompt } from './prompts.js';

const VALID_LEVELS = ['Entry', 'Mid', 'Senior', 'Lead', 'Executive'];
const VALID_SKILL_CATEGORIES = ['Language', 'Framework', 'Database', 'Cloud', 'DevOps', 'Tool', 'Domain', 'Other'];

function parseJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('[ResumeMatch] Empty response — cannot parse resume');
    }
    let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
    throw new Error('[ResumeMatch] Failed to parse resume JSON from model response');
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeSkillArray(value) {
    return asArray(value).map(item => {
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

function normalizeExperience(value) {
    return asArray(value).filter(e => e && typeof e === 'object').map(e => ({
        company: typeof e.company === 'string' ? e.company : '',
        title: typeof e.title === 'string' ? e.title : '',
        startDate: typeof e.startDate === 'string' ? e.startDate : null,
        endDate: typeof e.endDate === 'string' ? e.endDate : null,
        isCurrent: typeof e.isCurrent === 'boolean' ? e.isCurrent : false,
        responsibilities: asArray(e.responsibilities).filter(r => typeof r === 'string'),
        technologies: asArray(e.technologies).filter(t => typeof t === 'string'),
    }));
}

function normalizeEducation(value) {
    return asArray(value).filter(e => e && typeof e === 'object').map(e => ({
        institution: typeof e.institution === 'string' ? e.institution : '',
        degree: typeof e.degree === 'string' ? e.degree : '',
        field: typeof e.field === 'string' ? e.field : '',
        endDate: typeof e.endDate === 'string' ? e.endDate : null,
    }));
}

function normalizeProjects(value) {
    return asArray(value).filter(p => p && typeof p === 'object').map(p => ({
        name: typeof p.name === 'string' ? p.name : '',
        description: typeof p.description === 'string' ? p.description : '',
        technologies: asArray(p.technologies).filter(t => typeof t === 'string'),
    }));
}

function validateProfile(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('[ResumeMatch] Parsed resume is not a JSON object');
    }

    const totalYears = typeof parsed.total_experience_years === 'number'
        ? parsed.total_experience_years
        : (typeof parsed.experience_years === 'number' ? parsed.experience_years : null);
    const level = VALID_LEVELS.includes(parsed.seniority_level)
        ? parsed.seniority_level
        : (VALID_LEVELS.includes(parsed.level) ? parsed.level : null);

    return {
        name:                  typeof parsed.name === 'string' ? parsed.name : null,
        email:                 typeof parsed.email === 'string' ? parsed.email : null,
        phone:                 typeof parsed.phone === 'string' ? parsed.phone : null,
        linkedin_url:          typeof parsed.linkedin_url === 'string' ? parsed.linkedin_url : null,
        summary:               typeof parsed.summary === 'string' ? parsed.summary : '',
        experience:            normalizeExperience(parsed.experience),
        education:             normalizeEducation(parsed.education),
        skills:                normalizeSkillArray(parsed.skills),
        projects:              normalizeProjects(parsed.projects),
        total_experience_years: totalYears,
        seniority_level:       level,
        domain:                typeof parsed.domain === 'string' ? parsed.domain : 'Other',
        sub_domain:            typeof parsed.sub_domain === 'string' ? parsed.sub_domain : null,
        languages:             asArray(parsed.languages).filter(l => l && typeof l === 'object'),
        location:              typeof parsed.location === 'string' ? parsed.location : null,
        open_to_remote:        typeof parsed.open_to_remote === 'boolean' ? parsed.open_to_remote : null,
        open_to_relocate:      typeof parsed.open_to_relocate === 'boolean' ? parsed.open_to_relocate : null,
        visa_required:         typeof parsed.visa_required === 'boolean' ? parsed.visa_required : null,
        certifications:        asArray(parsed.certifications).filter(c => typeof c === 'string'),
    };
}

export async function parseResume(pdfBuffer, mimeType) {
    const base64 = pdfBuffer.toString('base64');
    const raw = await callGeminiWithPdf(base64, mimeType, getResumeParsePrompt());
    return validateProfile(parseJsonResponse(raw));
}

export async function parseResumeFromText(text) {
    const raw = await callGemini(getResumeParsePrompt(), text);
    return validateProfile(parseJsonResponse(raw));
}