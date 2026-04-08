import { StripHtml } from '../utils.js';

// ─── Boilerplate Stripper ─────────────────────────────────────────────────────
// Removes junk text that wastes token budget and displaces language requirements.
// Run this BEFORE any snippet extraction.

export function stripBoilerplate(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove LinkedIn tracking tags: #LI-MR3, #LI-Remote, #LI-Hybrid, #LI-DNI, etc.
    cleaned = cleaned.replace(/#LI-[A-Za-z0-9]+/g, '');

    // Remove common trailing boilerplate (equal opportunity, AEDT, etc.)
    // We keep the FIRST match only (some descriptions have multiple)
    const boilerplateStarts = [
        /\n\s*(?:we are (?:proud to be )?an equal opportunity employer)/i,
        /\n\s*(?:equal employment opportunity)/i,
        /\n\s*(?:AEDT|automated employment decision tool)/i,
        /\n\s*(?:pursuant to the (?:san francisco|los angeles|new york))/i,
    ];

    for (const pattern of boilerplateStarts) {
        const match = cleaned.match(pattern);
        if (match && match.index > cleaned.length * 0.7) {
            // Only strip if it's in the last 30% of the text
            cleaned = cleaned.substring(0, match.index).trim();
            break;
        }
    }

    // Clean up extra whitespace left behind
    cleaned = cleaned.replace(/\s{3,}/g, '\n\n').trim();

    return cleaned;
}

// ─── German-Word Context Scanner ─────────────────────────────────────────────
// Scans the FULL description for German trigger words. If found, extracts
// 1000 chars before + 1000 chars after the match — focused context for the AI.
// This is the user's approach: find German first, then give AI only the relevant part.
//
// Returns a ~2000 char snippet, or null if no German trigger found.

const GERMAN_SCAN_PATTERNS = [
    // Language requirement phrases
    /\b(?:fluent|fluency|proficien(?:t|cy)|native)[\s\-]+(?:in\s+)?german/i,
    /\bgerman[\s\-]+(?:fluent|native|required|mandatory|essential|speaker|proficiency)/i,
    /\bgerman\s*\((?:fluent|native|required|mandatory|C[12]|B[12])\)/i,
    /\bcommunication(?:\s+skills?)?\s+(?:in\s+)?(?:both\s+)?(?:english\s+and\s+)?german/i,
    /\bgerman\s+(?:and|&|\+)\s+english/i,
    /\benglish\s+(?:and|&|\+)\s+german/i,

    // CEFR levels with German
    /\bgerman\s*[\(\-]?\s*(?:A[12]|B[12]|C[12])[\+\)]?/i,
    /\b(?:A[12]|B[12]|C[12])[\+\-]?\s*(?:level\s+)?(?:in\s+)?german/i,

    // German-language phrases
    /\bDeutschkenntnisse/i,
    /\bVerhandlungssichere?s?\s*Deutsch/i,
    /\bflie[ßs]end(?:e[srnm]?)?\s*Deutsch/i,
    /\bMuttersprachler(?:in)?\b/i,
    /\bDu\s+sprichst\b/i,
    /\bDu\s+verf[üu]gst\b/i,
    /\bgute[rns]?\s+Deutsch/i,
    /\bSprachkenntnisse/i,
];

export function scanForGermanContext(fullText) {
    if (!fullText || fullText.length < 100) return null;

    for (const pattern of GERMAN_SCAN_PATTERNS) {
        const match = fullText.match(pattern);
        if (!match) continue;

        // Found a German trigger — grab 1000 chars before + 1000 chars after
        const matchPos = match.index;
        const contextStart = Math.max(0, matchPos - 1000);
        const contextEnd = Math.min(fullText.length, matchPos + match[0].length + 1000);
        const context = fullText.substring(contextStart, contextEnd).trim();

        console.log(`[Snippet] 🎯 German trigger found: "${match[0]}" at position ${matchPos} — using focused 2000-char context`);
        return context;
    }

    return null;
}

// ─── Requirements Section Extractor (improved) ───────────────────────────────
// Only used as FALLBACK when no German trigger word is found.

export function extractRequirementsSection(text) {
    if (!text) return null;

    const sectionPatterns = [
        // English headers (expanded — added missing ones from the report)
        /(?:^|\n)\s*(?:requirements|what you['']ll bring|what we['']re looking for|your profile|qualifications|what you bring|your expertise|who you are|must[- ]?have|minimum requirements|required skills|key requirements|what we expect|your skills|skills and experience|about you|what you need|desired qualifications|preferred qualifications|you have|humble expectations|technical qualifications|core competencies|essential skills|your background|key qualifications|what you['']ll need|experience and skills|our requirements)\s*[:\-]?\s*\n/im,
        // German headers (expanded)
        /(?:^|\n)\s*(?:anforderungen|was du mitbringst|dein profil|qualifikationen|was wir erwarten|deine skills|voraussetzungen|das bringst du mit|was sie mitbringen|ihr profil|das solltest du mitbringen|deine qualifikationen|das zeichnet dich aus|das erwarten wir|dein hintergrund)\s*[:\-]?\s*\n/im,
    ];

    for (const pattern of sectionPatterns) {
        const match = text.match(pattern);
        if (!match) continue;

        const startIndex = match.index + match[0].length;
        const remainingText = text.substring(startIndex);

        const nextSectionPattern = /\n\s*(?:benefits|what we offer|how we['']ll take care|our commitment|about us|about the|the team|your responsibilities|what you['']ll do|our offer|was wir bieten|unser angebot|location|salary|compensation|perks|why join|why us|apply|how to apply|nice to have|bonus points|unsere benefits|was wir dir bieten)\s*[:\-]?\s*\n/im;
        const nextMatch = remainingText.match(nextSectionPattern);
        const endIndex = nextMatch ? nextMatch.index : Math.min(remainingText.length, 3000);
        const section = remainingText.substring(0, endIndex).trim();

        if (section.length >= 100) return section;
    }

    return null;
}

/**
 * Builds the description snippet to send to the AI.
 * Applies: boilerplate stripping → German context scanning → section extraction → fallback.
 */
export function buildDescriptionSnippet(description) {
    const cleanDescription = stripBoilerplate(StripHtml(description));

    // Step 1: Try German-word-first approach on the full text
    const germanContext = scanForGermanContext(cleanDescription);
    if (germanContext) {
        return germanContext;
    }

    if (cleanDescription.length <= 4000) {
        return cleanDescription;
    }

    // Long description, no German trigger — use improved section extraction
    const requirementsSection = extractRequirementsSection(cleanDescription);
    if (requirementsSection && requirementsSection.length >= 100) {
        const intro = cleanDescription.substring(0, 1000);
        const outro = cleanDescription.slice(-1000);
        let snippet = intro + "\n\n--- REQUIREMENTS SECTION ---\n" + requirementsSection + "\n--- END REQUIREMENTS ---\n\n" + outro;
        if (snippet.length > 5500) snippet = snippet.substring(0, 5500);
        return snippet;
    }

    // Fallback: first 1500 + last 2500
    const first = cleanDescription.substring(0, 1500);
    const last = cleanDescription.slice(-2500);
    return first + "\n...\n" + last;
}
