import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEYS } from './env.js';
import { sleep, StripHtml } from './utils.js';

// ─── Model Selection ───────────────────────────────────────────────────────────
// gemini-3.1-flash-lite: 500 RPD | 15 RPM | 250K TPM  ← stable, same limits as preview
// gemini-2.5-flash-lite:  20 RPD | 10 RPM | 250K TPM  ← old (was our bottleneck)
// gemini-2.5-flash:       20 RPD |  5 RPM | 250K TPM  ← fewer RPM too
const MODEL_NAME = 'gemini-3.1-flash-lite-preview';

// ─── Per-key state tracker ─────────────────────────────────────────────────────
//
// Instead of a simple round-robin index, we track per-key metadata so we can:
//   1. Skip keys that are in an RPM or RPD cooldown
//   2. Auto-fall-through to the next healthy key immediately on 429
//   3. Re-enable keys after their cooldown window has elapsed
//   4. Distribute load evenly (pick the key with the fewest requests this minute)
//
const MAX_RETRIES_PER_CALL = 3;  // Retries across ALL keys for one job
const RPM_COOLDOWN_MS    = 62_000;   // 62s cooldown when RPM limit hit
const RPD_COOLDOWN_MS    = 24 * 60 * 60 * 1_000; // 24h cooldown when RPD exhausted

class KeyState {
    constructor(apiKey, index) {
        this.apiKey  = apiKey;
        this.index   = index;  // for logging
        this.model   = null;   // initialized lazily

        // Cooldown timestamps (null = not in cooldown)
        this.rpmCooldownUntil = null;
        this.rpdCooldownUntil = null;

        // Per-minute request window (rolling)
        this.requestsThisMinute = 0;
        this.minuteWindowStart  = Date.now();
    }

    getModel() {
        if (!this.model) {
            const genAI = new GoogleGenerativeAI(this.apiKey);
            this.model = genAI.getGenerativeModel({
                model: MODEL_NAME,
                generationConfig: {
                    temperature: 0,
                    responseMimeType: 'application/json',
                },
            });
        }
        return this.model;
    }

    // Returns the number of milliseconds until this key is available (0 if ready now)
    cooldownRemaining() {
        const now = Date.now();

        if (this.rpdCooldownUntil && now < this.rpdCooldownUntil) {
            return this.rpdCooldownUntil - now;
        }
        if (this.rpmCooldownUntil && now < this.rpmCooldownUntil) {
            return this.rpmCooldownUntil - now;
        }

        // Clear expired cooldowns
        if (this.rpdCooldownUntil && now >= this.rpdCooldownUntil) this.rpdCooldownUntil = null;
        if (this.rpmCooldownUntil && now >= this.rpmCooldownUntil) this.rpmCooldownUntil = null;

        return 0;
    }

    isRpdExhausted() {
        return this.rpdCooldownUntil !== null && Date.now() < this.rpdCooldownUntil;
    }

    // Count this request in the rolling per-minute window
    recordRequest() {
        const now = Date.now();
        if (now - this.minuteWindowStart > 60_000) {
            // New minute window
            this.requestsThisMinute = 0;
            this.minuteWindowStart  = now;
        }
        this.requestsThisMinute++;
    }

    markRpmLimit(retryAfterMs) {
        const cooldown = retryAfterMs || RPM_COOLDOWN_MS;
        this.rpmCooldownUntil = Date.now() + cooldown;
        console.warn(`[AI] Key #${this.index + 1} RPM limited — cooldown ${Math.round(cooldown / 1000)}s`);
    }

    markRpdLimit() {
        this.rpdCooldownUntil = Date.now() + RPD_COOLDOWN_MS;
        console.error(`[AI] Key #${this.index + 1} RPD EXHAUSTED — disabled for 24h`);
    }
}

// Build state for each configured key
if (GEMINI_API_KEYS.length === 0) {
    throw new Error('[AI] No Gemini API keys configured. Set GEMINI_API_KEY_1, _2, _3 in .env');
}
const keyStates = GEMINI_API_KEYS.map((k, i) => new KeyState(k, i));

console.log(`[AI] Initialized ${keyStates.length} API key(s) with model: ${MODEL_NAME}`);

// ─── Key Selection ─────────────────────────────────────────────────────────────

/**
 * Returns the best available KeyState, or null if ALL keys are exhausted/in cooldown.
 *
 * Strategy: prefer the key with the fewest requests in the current minute
 * (among keys not in any cooldown).
 */
function getBestAvailableKey() {
    const now = Date.now();
    let best = null;

    for (const ks of keyStates) {
        // Skip RPD-exhausted keys entirely
        if (ks.isRpdExhausted()) continue;

        // Skip keys in RPM cooldown
        if (ks.rpmCooldownUntil && now < ks.rpmCooldownUntil) continue;

        // Prefer the key least-used this minute
        if (best === null || ks.requestsThisMinute < best.requestsThisMinute) {
            best = ks;
        }
    }
    return best;
}

/**
 * Returns the shortest cooldown remaining across all non-RPD-exhausted keys.
 * Used to sleep the minimum time needed before a key becomes available again.
 */
function shortestCooldownMs() {
    const now = Date.now();
    let shortest = null;

    for (const ks of keyStates) {
        if (ks.isRpdExhausted()) continue; // don't bother waiting for RPD

        const remaining = ks.cooldownRemaining();
        if (remaining > 0) {
            if (shortest === null || remaining < shortest) shortest = remaining;
        }
    }
    return shortest;
}

/**
 * All keys are RPD-exhausted when none can ever serve requests today.
 */
function allKeysRpdExhausted() {
    return keyStates.every(ks => ks.isRpdExhausted());
}

// ─── Boilerplate Stripper ─────────────────────────────────────────────────────
// Removes junk text that wastes token budget and displaces language requirements.
// Run this BEFORE any snippet extraction.

function stripBoilerplate(text) {
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

function scanForGermanContext(fullText) {
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

function extractRequirementsSection(text) {
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

// ─── Main AI Analyzer ─────────────────────────────────────────────────────────

/**
 * Analyzes a job description for German language requirements.
 *
 * Uses gemini-3.1-flash-lite (500 RPD / 15 RPM free tier per key).
 * Function name kept as analyzeJobWithGroq for backward compatibility.
 *
 * Round-robin strategy:
 *   - Always picks the key with the lowest requests-this-minute among ready keys
 *   - On 429 RPM: marks key in cooldown, immediately retries with next available key
 *   - On 429 RPD: marks key exhausted for 24h, immediately falls to next key
 *   - If ALL keys are in RPM cooldown: waits for the shortest cooldown then retries
 *   - If ALL keys are RPD exhausted: gives up and returns null
 */
export async function analyzeJobWithGroq(jobTitle, description) {
    if (!description || description.length < 50) return null;

    // ── Build the prompt snippet ──────────────────────────────────────────────
    // FLOW:
    //   1. Strip #LI tags and boilerplate (frees up character budget)
    //   2. Scan full text for German trigger words
    //   3. If German found → extract 1000 chars before + 1000 after (focused, ~2000 chars)
    //   4. If not found → normal snippet (improved extraction, bigger tail)
    //
    const cleanDescription = stripBoilerplate(StripHtml(description));
    let descriptionSnippet;

    // Step 1: Try German-word-first approach on the full text
    const germanContext = scanForGermanContext(cleanDescription);

    if (germanContext) {
        // German trigger found — send ONLY the focused context to AI
        // Much cheaper than sending 4000+ chars, and AI sees exactly the relevant part
        descriptionSnippet = germanContext;
    } else if (cleanDescription.length <= 4000) {
        // Short description — send all of it
        descriptionSnippet = cleanDescription;
    } else {
        // Long description, no German trigger found — use improved section extraction
        const requirementsSection = extractRequirementsSection(cleanDescription);
        if (requirementsSection && requirementsSection.length >= 100) {
            const intro = cleanDescription.substring(0, 1000);
            const outro = cleanDescription.slice(-1000);
            descriptionSnippet = intro + "\n\n--- REQUIREMENTS SECTION ---\n" + requirementsSection + "\n--- END REQUIREMENTS ---\n\n" + outro;
            if (descriptionSnippet.length > 5500) descriptionSnippet = descriptionSnippet.substring(0, 5500);
        } else {
            // No section found — take first 1500 + last 2500
            const first = cleanDescription.substring(0, 1500);
            const last  = cleanDescription.slice(-2500);
            descriptionSnippet = first + "\n...\n" + last;
        }
    }

    const prompt = `Analyze this job posting. Is German language REQUIRED?

${descriptionSnippet}

german_required = true if the description contains ANY of these:
- fluent/fluency in German, fluent German, German (fluent), fluent/native in German
- German required/mandatory/essential, German is essential
- German native speaker, native-level German, native German level
- Muttersprachler, Muttersprachlerin
- any CEFR German level: A1, A2, B1, B2, C1, C2 (including "B2+", "min. B1", "C1/C2")
- Deutschkenntnisse, exzellente Deutschkenntnisse, Verhandlungssicheres Deutsch, Verhandlungssichere Deutschkenntnisse
- fließend Deutsch, fließend Deutsch und Englisch, Du sprichst fließend Deutsch
- communication in German and English, communication skills in German
- German language proficiency, proficient in German, strong proficiency in German
- good German language skills, good English and German language skills
- entire text is written in German, or more than 40% of the text is German sentences

IMPORTANT — OR-conditions: If German is listed as one option among alternatives (e.g. "German or French", "either German or Dutch", "fluency in German or another European language"), STILL set german_required = true. For jobs in Germany, being able to substitute another language does not remove the German requirement.

IMPORTANT — Bilingual descriptions: If the description mixes German and English text, and the German portions contain language requirements (e.g. "Du verfügst über Deutschkenntnisse"), set german_required = true. Do NOT ignore German-language sections.

IMPORTANT — Conditional headings: If German fluency appears under "You'll thrive if", "Nice to have", "Great if you have", or "Preferred" BUT the fluency level is C1/C2/native AND the role's core function requires German (e.g. selling to German customers, managing German accounts, coaching German workers), set german_required = true.

german_required = false ONLY if: German is not mentioned at all, OR German appears only as a country/region name (not a language), OR German is listed as genuinely optional with no specific level (e.g. "German is a plus" without any CEFR level).

evidence.german_reason: If german_required=true, copy the exact phrase from the text. If false: "No German language requirement found in description"

Return ONLY this JSON, no other text:
{"german_required":bool,"confidence":0.0-1.0,"evidence":{"german_reason":"exact quote"}}`;

    // ── Attempt loop ──────────────────────────────────────────────────────────
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_CALL; attempt++) {
        // If all keys are permanently exhausted for today, bail out
        if (allKeysRpdExhausted()) {
            console.error(`[AI] ALL API keys RPD exhausted — cannot process more jobs today`);
            return null;
        }

        let ks = getBestAvailableKey();

        // If no key is immediately available, wait for the shortest cooldown
        if (!ks) {
            const waitMs = shortestCooldownMs();
            if (!waitMs) {
                // No cooldown remaining but still no key — shouldn't happen
                console.error(`[AI] No available key found (unexpected state). Returning null.`);
                return null;
            }
            console.warn(`[AI] All keys in cooldown. Waiting ${Math.round(waitMs / 1000)}s for next available key...`);
            await sleep(waitMs + 500); // small buffer
            ks = getBestAvailableKey();
            if (!ks) return null; // still nothing
        }

        try {
            ks.recordRequest();
            console.log(`[AI] Using key #${ks.index + 1}/${keyStates.length} (${ks.requestsThisMinute} req/min) — ${String(jobTitle).substring(0, 30)}...`);

            const result  = await ks.getModel().generateContent(prompt);
            const content = result.response.text();

            if (!content) throw new Error("Empty response from Gemini");

            const data = JSON.parse(content);

            const normalizedData = {
                german_required: data.german_required === true || data.german_required === "true",
                domain:          "Unclear",
                sub_domain:      "Other",
                confidence:      Number(data.confidence) || 0,
                evidence:        data.evidence || { german_reason: "No reason provided" },
            };

            console.log(`[AI] ✅ Key #${ks.index + 1} | ${String(jobTitle).substring(0, 30)}... | GermanReq: ${normalizedData.german_required} | Conf: ${normalizedData.confidence}`);
            return normalizedData;

        } catch (err) {
            const errMsg   = err?.message || '';
            const status   = err?.status  || 0;

            // ── RPM rate limit (429) ──────────────────────────────────────────
            const isRpmLimit = status === 429
                || errMsg.includes('429')
                || errMsg.includes('RESOURCE_EXHAUSTED')
                || errMsg.includes('quota');

            // ── RPD quota (daily limit) detection ────────────────────────────
            // Gemini returns these strings when daily quota is gone:
            const isRpdLimit = isRpmLimit && (
                errMsg.includes('daily')
                || errMsg.includes('per day')
                || errMsg.includes('perDay')
                || errMsg.includes('Daily')
                || errMsg.includes('DAILY')
            );

            if (isRpdLimit) {
                ks.markRpdLimit();
                // Immediately fall through the loop — pick a different key
                console.warn(`[AI] Attempt ${attempt}: Key #${ks.index + 1} hit daily limit. Trying next key...`);
                continue;
            }

            if (isRpmLimit) {
                // Try to parse retry-after delay from error message
                let waitMs = RPM_COOLDOWN_MS;
                const retryMatch = errMsg.match(/retry\s*(?:in|after)\s*([\d.]+)s/i);
                if (retryMatch) waitMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000;

                ks.markRpmLimit(waitMs);

                // Don't sleep here — immediately try the next available key
                console.warn(`[AI] Attempt ${attempt}: Key #${ks.index + 1} RPM limited. Trying next key immediately...`);
                continue;
            }

            // ── Other errors (parse error, network, etc.) ─────────────────────
            console.warn(`[AI] Attempt ${attempt}/${MAX_RETRIES_PER_CALL}: Key #${ks.index + 1} error: ${errMsg}`);
            if (attempt < MAX_RETRIES_PER_CALL) {
                await sleep(3000);
            }
        }
    }

    console.warn(`[AI] All ${MAX_RETRIES_PER_CALL} attempts exhausted for: ${String(jobTitle).substring(0, 40)}`);
    return null;
}

export async function isGermanRequired(description, jobTitle) {
    const result = await analyzeJobWithGroq(jobTitle, description);
    return result ? result.german_required : true;
}

// ─── Diagnostic helper ─────────────────────────────────────────────────────────
// Call this to see the current state of all keys (useful for debugging)
export function getKeyStatus() {
    const now = Date.now();
    return keyStates.map(ks => ({
        key:              `Key #${ks.index + 1}`,
        rpmCooldown:      ks.rpmCooldownUntil ? `${Math.round((ks.rpmCooldownUntil - now) / 1000)}s remaining` : 'ready',
        rpdStatus:        ks.isRpdExhausted() ? 'EXHAUSTED (daily limit hit)' : 'OK',
        requestsThisMin:  ks.requestsThisMinute,
    }));
}