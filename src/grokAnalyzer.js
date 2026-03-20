import Groq from "groq-sdk";
import { GROQ_API_KEY } from './env.js';
import { sleep,StripHtml } from './utils.js';

const groq = new Groq({ apiKey: GROQ_API_KEY });

const MODEL_NAME = "llama-3.1-8b-instant"; 
const MAX_RETRIES = 5;

// ─── Requirements Section Extractor ───────────────────────────────────────
// Tries to find and extract the "Requirements" / "Qualifications" section
// from a job description. This is where language requirements are usually stated.

function extractRequirementsSection(text) {
    if (!text) return null;

    // Common section headers that contain language requirements
    // Order matters — more specific patterns first
    const sectionPatterns = [
        // English headers
        /(?:^|\n)\s*(?:requirements|what you['']ll bring|what we['']re looking for|your profile|qualifications|what you bring|your expertise|who you are|must[- ]?have|minimum requirements|required skills|key requirements|what we expect|your skills|skills and experience|about you|what you need|desired qualifications|preferred qualifications)\s*[:\-]?\s*\n/im,
        // German headers (for descriptions mixing languages)
        /(?:^|\n)\s*(?:anforderungen|was du mitbringst|dein profil|qualifikationen|was wir erwarten|deine skills|voraussetzungen|das bringst du mit|was sie mitbringen|ihr profil)\s*[:\-]?\s*\n/im,
    ];

    for (const pattern of sectionPatterns) {
        const match = text.match(pattern);
        if (!match) continue;

        // Found a section header — extract from here to the next section or 2000 chars
        const startIndex = match.index + match[0].length;
        const remainingText = text.substring(startIndex);

        // Look for the NEXT section header (signals end of requirements section)
        const nextSectionPattern = /\n\s*(?:benefits|what we offer|how we['']ll take care|our commitment|about us|about the|the team|your responsibilities|what you['']ll do|our offer|was wir bieten|unser angebot|location|salary|compensation|perks|why join|why us|apply|how to apply|nice to have|bonus points)\s*[:\-]?\s*\n/im;

        const nextMatch = remainingText.match(nextSectionPattern);
        let endIndex;

        if (nextMatch) {
            endIndex = nextMatch.index;
        } else {
            // No clear end — take up to 2000 chars
            endIndex = Math.min(remainingText.length, 2000);
        }

        const section = remainingText.substring(0, endIndex).trim();

        // Only return if it's a meaningful section (not just a one-liner)
        if (section.length >= 100) {
            return section;
        }
    }

    // No section headers found — try a simpler approach:
    // Search for language-related keywords and extract surrounding context
    const languagePatterns = [
        /german|deutsch|german\s*(?:language|proficiency|fluency|skills|required|mandatory|native|b[12]|c[12])/i,
        /fließend|muttersprachler|deutschkenntnisse|sprachkenntnisse/i,
    ];

    for (const pattern of languagePatterns) {
        const match = text.match(pattern);
        if (!match) continue;

        // Found a language mention — extract 500 chars before and 500 chars after
        const matchStart = match.index;
        const contextStart = Math.max(0, matchStart - 500);
        const contextEnd = Math.min(text.length, matchStart + match[0].length + 500);

        return text.substring(contextStart, contextEnd).trim();
    }

    // Nothing found
    return null;
}

/**
 * IMPROVED VERSION - Analyzes job description using Groq for German language requirements
 * 
 * KEY IMPROVEMENTS:
 * - Recognizes "Fluency in German" as requirement (not just "nice to have")
 * - Catches "German native speaker" patterns
 * - Detects "professional fluency in German"
 * - Finds "(required)" in parentheses
 * - Detects "(mandatory)" in parentheses
 */
export async function analyzeJobWithGroq(jobTitle, description) {
    if (!description || description.length < 50) return null;

    const cleanDescription = StripHtml(description);
    let descriptionSnippet;

    if (cleanDescription.length <= 4000) {
        // Short enough — send everything
        descriptionSnippet = cleanDescription;
    } else {
        // Long description — smart extraction
        // Step 1: Try to find the Requirements/Qualifications section
        const requirementsSection = extractRequirementsSection(cleanDescription);

        if (requirementsSection && requirementsSection.length >= 100) {
            // We found a meaningful requirements section
            // Send: first 1000 chars (job intro) + full requirements section + last 500 chars (salary/benefits)
            const intro = cleanDescription.substring(0, 1000);
            const outro = cleanDescription.slice(-500);
            descriptionSnippet = intro + "\n\n--- REQUIREMENTS SECTION ---\n" + requirementsSection + "\n--- END REQUIREMENTS ---\n\n" + outro;

            // Cap at 5000 chars to avoid token waste
            if (descriptionSnippet.length > 5000) {
                descriptionSnippet = descriptionSnippet.substring(0, 5000);
            }
        } else {
            // No clear requirements section found — fall back to old approach
            const first = cleanDescription.substring(0, 1500);
            const last = cleanDescription.slice(-2500);
            descriptionSnippet = first + "\n...\n" + last;
        }
    }

    const prompt = `
Does this job REQUIRE German language skills? Look ONLY at the DESCRIPTION text below.
If ANY pattern from the REQUIRED list appears in the description, you MUST return german_required: true. Do not overthink or second-guess a match. If you quote a German requirement in your evidence, you MUST return true.


        // ─── Requirements Section Extractor ───────────────────────────────────────
        // Tries to find and extract the "Requirements" / "Qualifications" section
        // from a job description. This is where language requirements are usually stated.

        function extractRequirementsSection(text) {
            if (!text) return null;

            // Common section headers that contain language requirements
            // Order matters — more specific patterns first
            const sectionPatterns = [
                // English headers
                /(?:^|\n)\s*(?:requirements|what you['']ll bring|what we['']re looking for|your profile|qualifications|what you bring|your expertise|who you are|must[- ]?have|minimum requirements|required skills|key requirements|what we expect|your skills|skills and experience|about you|what you need|desired qualifications|preferred qualifications)\s*[:\-]?\s*\n/im,
                // German headers (for descriptions mixing languages)
                /(?:^|\n)\s*(?:anforderungen|was du mitbringst|dein profil|qualifikationen|was wir erwarten|deine skills|voraussetzungen|das bringst du mit|was sie mitbringen|ihr profil)\s*[:\-]?\s*\n/im,
            ];

            for (const pattern of sectionPatterns) {
                const match = text.match(pattern);
                if (!match) continue;

                // Found a section header — extract from here to the next section or 2000 chars
                const startIndex = match.index + match[0].length;
                const remainingText = text.substring(startIndex);

                // Look for the NEXT section header (signals end of requirements section)
                const nextSectionPattern = /\n\s*(?:benefits|what we offer|how we['']ll take care|our commitment|about us|about the|the team|your responsibilities|what you['']ll do|our offer|was wir bieten|unser angebot|location|salary|compensation|perks|why join|why us|apply|how to apply|nice to have|bonus points)\s*[:\-]?\s*\n/im;

                const nextMatch = remainingText.match(nextSectionPattern);
                let endIndex;

                if (nextMatch) {
                    endIndex = nextMatch.index;
                } else {
                    // No clear end — take up to 2000 chars
                    endIndex = Math.min(remainingText.length, 2000);
                }

                const section = remainingText.substring(0, endIndex).trim();

                // Only return if it's a meaningful section (not just a one-liner)
                if (section.length >= 100) {
                    return section;
                }
            }

            // No section headers found — try a simpler approach:
            // Search for language-related keywords and extract surrounding context
            const languagePatterns = [
                /german|deutsch|german\s*(?:language|proficiency|fluency|skills|required|mandatory|native|b[12]|c[12])/i,
                /fließend|muttersprachler|deutschkenntnisse|sprachkenntnisse/i,
            ];

            for (const pattern of languagePatterns) {
                const match = text.match(pattern);
                if (!match) continue;

                // Found a language mention — extract 500 chars before and 500 chars after
                const matchStart = match.index;
                const contextStart = Math.max(0, matchStart - 500);
                const contextEnd = Math.min(text.length, matchStart + match[0].length + 500);

                return text.substring(contextStart, contextEnd).trim();
            }

            // Nothing found
            return null;
        }

REQUIRED (return true):
- "Fluent in German" or "Fluency in German" in requirements
- "German native speaker" or "Native German"
- "German (mandatory)" or "German (required)"
- "German required" or "must speak German"
- German not mentioned at all
- Job is LOCATED in Germany but does not require German language skills
- "Technical": Software, Data, AI, DevOps, Engineering, IT
- "Non-Technical": Product, Marketing, Sales, HR, Finance
- "Unclear": If ambiguous

  "domain": "Technical" or "Non-Technical",
  "sub_domain": "specific area like Sales, Backend, Marketing",
  "confidence": 0.0 to 1.0,
  "evidence": {
    "german_reason": "quote the exact text that proves your answer"
  }
}
`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a JSON-only API. Return pure JSON." },
                    { role: "user", content: prompt }
                ],
                model: MODEL_NAME,
                temperature: 0, 
                response_format: { type: "json_object" } 
            });

            const content = chatCompletion.choices[0]?.message?.content;
            if (!content) throw new Error("Empty response from Groq");

            const data = JSON.parse(content);
            
            const normalizedData = {
                german_required: data.german_required === true || data.german_required === "true",
                domain: data.domain,
                sub_domain: data.sub_domain,
                confidence: Number(data.confidence) || 0,
                evidence: data.evidence || {
                    german_reason: "No reason provided"
                }
            };
            
            console.log(`[AI] ${jobTitle.substring(0, 20)}... | Ger: ${normalizedData.german_required}`);
            return normalizedData;

        } catch (err) {
            if (err.status === 429 || err.message.includes('429')) {
                let waitTime = 60000;

                if (err.headers && err.headers['retry-after']) {
                    const retryHeader = parseInt(err.headers['retry-after'], 10);
                    if (!isNaN(retryHeader)) {
                        waitTime = (retryHeader * 1000) + 1000;
                    }
                } else {
                    const match = err.message.match(/try again in ([\d.]+)s/);
                    if (match && match[1]) {
                        waitTime = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
                    }
                }

                console.warn(`[AI] Groq Rate Limit. Waiting ${waitTime/1000}s...`);
                await sleep(waitTime);
            } else {
                console.warn(`[AI] Error: ${err.message}`);
                if (attempt === MAX_RETRIES) return null;
                await sleep(2000);
            }
        }
    }
    return null;
}

export async function isGermanRequired(description, jobTitle) {
    const result = await analyzeJobWithGroq(jobTitle, description);
    return result ? result.german_required : true; 
}