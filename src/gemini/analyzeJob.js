import { sleep } from '../utils.js';
import { buildDescriptionSnippet } from './snippetExtractor.js';
import {
    keyStates,
    getBestAvailableKey,
    shortestCooldownMs,
    allKeysRpdExhausted,
    MAX_RETRIES_PER_CALL,
    RPM_COOLDOWN_MS,
} from './keyManager.js';

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
    const descriptionSnippet = buildDescriptionSnippet(description);

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

            const result = await ks.getModel().generateContent(prompt);
            const content = result.response.text();

            if (!content) throw new Error("Empty response from Gemini");

            const data = JSON.parse(content);

            const normalizedData = {
                german_required: data.german_required === true || data.german_required === "true",
                domain: "Unclear",
                sub_domain: "Other",
                confidence: Number(data.confidence) || 0,
                evidence: data.evidence || { german_reason: "No reason provided" },
            };

            console.log(`[AI] ✅ Key #${ks.index + 1} | ${String(jobTitle).substring(0, 30)}... | GermanReq: ${normalizedData.german_required} | Conf: ${normalizedData.confidence}`);
            return normalizedData;

        } catch (err) {
            const errMsg = err?.message || '';
            const status = err?.status || 0;

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
