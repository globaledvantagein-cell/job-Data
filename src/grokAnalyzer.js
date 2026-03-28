import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEYS } from './env.js';
import { sleep, StripHtml } from './utils.js';

// ─── Model Selection ───────────────────────────────────────────────────────────
// gemini-3.1-flash-lite: 500 RPD | 15 RPM | 250K TPM  ← stable, same limits as preview
// gemini-2.5-flash-lite:  20 RPD | 10 RPM | 250K TPM  ← old (was our bottleneck)
// gemini-2.5-flash:       20 RPD |  5 RPM | 250K TPM  ← fewer RPM too
const MODEL_NAME = 'gemini-3.1-flash-lite';

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

// ─── Requirements Section Extractor ───────────────────────────────────────────

function extractRequirementsSection(text) {
    if (!text) return null;

    const sectionPatterns = [
        /(?:^|\n)\s*(?:requirements|what you['']ll bring|what we['']re looking for|your profile|qualifications|what you bring|your expertise|who you are|must[- ]?have|minimum requirements|required skills|key requirements|what we expect|your skills|skills and experience|about you|what you need|desired qualifications|preferred qualifications)\s*[:\-]?\s*\n/im,
        /(?:^|\n)\s*(?:anforderungen|was du mitbringst|dein profil|qualifikationen|was wir erwarten|deine skills|voraussetzungen|das bringst du mit|was sie mitbringen|ihr profil)\s*[:\-]?\s*\n/im,
    ];

    for (const pattern of sectionPatterns) {
        const match = text.match(pattern);
        if (!match) continue;

        const startIndex = match.index + match[0].length;
        const remainingText = text.substring(startIndex);

        const nextSectionPattern = /\n\s*(?:benefits|what we offer|how we['']ll take care|our commitment|about us|about the|the team|your responsibilities|what you['']ll do|our offer|was wir bieten|unser angebot|location|salary|compensation|perks|why join|why us|apply|how to apply|nice to have|bonus points)\s*[:\-]?\s*\n/im;
        const nextMatch = remainingText.match(nextSectionPattern);
        const endIndex = nextMatch ? nextMatch.index : Math.min(remainingText.length, 2000);
        const section = remainingText.substring(0, endIndex).trim();

        if (section.length >= 100) return section;
    }

    const languagePatterns = [
        /german|deutsch|german\s*(?:language|proficiency|fluency|skills|required|mandatory|native|b[12]|c[12])/i,
        /fließend|muttersprachler|deutschkenntnisse|sprachkenntnisse/i,
    ];
    for (const pattern of languagePatterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const contextStart = Math.max(0, match.index - 500);
        const contextEnd   = Math.min(text.length, match.index + match[0].length + 500);
        return text.substring(contextStart, contextEnd).trim();
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
    const cleanDescription = StripHtml(description);
    let descriptionSnippet;

    if (cleanDescription.length <= 4000) {
        descriptionSnippet = cleanDescription;
    } else {
        const requirementsSection = extractRequirementsSection(cleanDescription);
        if (requirementsSection && requirementsSection.length >= 100) {
            const intro  = cleanDescription.substring(0, 1000);
            const outro  = cleanDescription.slice(-500);
            descriptionSnippet = intro + "\n\n--- REQUIREMENTS SECTION ---\n" + requirementsSection + "\n--- END REQUIREMENTS ---\n\n" + outro;
            if (descriptionSnippet.length > 5000) descriptionSnippet = descriptionSnippet.substring(0, 5000);
        } else {
            const first = cleanDescription.substring(0, 1500);
            const last  = cleanDescription.slice(-2500);
            descriptionSnippet = first + "\n...\n" + last;
        }
    }

    const prompt = `Analyze this job description. Is German language REQUIRED?

${descriptionSnippet}

german_required = true if description says: fluent/fluency in German, German required/mandatory/essential, German native speaker, Muttersprachler, any CEFR German level (B2/C1/C2), Deutschkenntnisse, Verhandlungssicheres Deutsch, communication in both German and English, German language proficiency required, or entire text is written in German.

german_required = false if: German not mentioned, German is only "nice to have"/"plus"/"preferred", only English required, or German appears only as a country/region name not a language requirement.

evidence.german_reason: exact copy-paste quote from the text proving German is required. If not required: "No German language requirement found in description"

Return JSON: {"german_required":bool,"confidence":0.0-1.0,"evidence":{"german_reason":"exact quote"}}`;

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
            console.warn(`[AI] Attempt ${attempt}/${MAX_RETRIES_PER_CALL}: Key #${ks.index + 1} error: ${errMsg.substring(0, 100)}`);
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