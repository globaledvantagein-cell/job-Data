// ─── Resume Matcher — Gemini Client ────────────────────────────────────────────
//
// A self-contained Gemini API client for the resume matcher. Uses native fetch
// (same shape as src/gemma/gemmaClient.js). Reads the SAME Gemini API keys from
// env (GEMINI_API_KEYS, assembled in src/env.js) but keeps its OWN round-robin
// rotation — it does NOT import from src/gemini/.
//
// Two callers:
//   callGemini(systemPrompt, userMessage, options)        — text-only (scoring)
//   callGeminiWithPdf(pdfBase64, mimeType, prompt, options) — multimodal (parsing)

import { GEMINI_API_KEYS } from '../env.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODEL = process.env.RESUME_MATCHER_MODEL || 'gemini-2.5-flash-lite';

const DEFAULT_TEMPERATURE = 0.1;
const MAX_RETRIES = 3;               // retries on 429 (rate limited)
const SERVER_ERROR_RETRY_MS = 2_000; // wait before the single 500/503 retry

// ── Own round-robin key rotation (separate from src/gemini/) ──────────────────
let currentIndex = 0;

function getNextKey() {
    if (!GEMINI_API_KEYS || GEMINI_API_KEYS.length === 0) {
        throw new Error('[ResumeMatch] No Gemini API keys configured (GEMINI_API_KEY_1.._3 in .env)');
    }
    const key = GEMINI_API_KEYS[currentIndex];
    const usedIndex = currentIndex;
    currentIndex = (currentIndex + 1) % GEMINI_API_KEYS.length;
    return { key, index: usedIndex };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter for the Nth (1-based) retry attempt.
 * attempt 1 ≈ 1s, attempt 2 ≈ 2s, attempt 3 ≈ 4s, each + up to 1s jitter.
 */
function backoffWithJitter(attempt) {
    const base = 1_000 * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 1_000);
    return base + jitter;
}

/**
 * Performs one HTTP call and returns the candidate text.
 * Throws an Error tagged with `.status` so the retry loop can branch on it.
 */
async function requestOnce(apiKey, body) {
    const url = `${API_BASE}${MODEL}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = new Error(`[ResumeMatch] API responded ${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    // Some models include thinking/reasoning parts before the actual content.
    // Always grab the last non-thought part to get the real output.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const nonThoughtParts = parts.filter(p => !p.thought);
    const textPart = nonThoughtParts.length > 0
        ? nonThoughtParts[nonThoughtParts.length - 1]
        : parts[parts.length - 1];
    const text = textPart?.text;

    if (typeof text !== 'string') {
        const err = new Error('[ResumeMatch] Response missing candidates[0].content.parts[0].text');
        err.status = 0;
        throw err;
    }

    return text;
}

/**
 * Shared retry loop. Builds nothing — just drives requestOnce with the given
 * request body, rotating keys and backing off per the retry policy.
 *
 * @param {object} body  - the generateContent request body
 * @param {string} label - short tag for logging ('text' | 'pdf')
 * @returns {Promise<string>} raw response text
 */
async function executeWithRetries(body, label) {
    let rateLimitRetries = 0;
    let hasRetriedServerError = false;

    while (true) {
        const { key, index } = getNextKey();
        const startedAt = Date.now();

        try {
            const text = await requestOnce(key, body);
            const durationMs = Date.now() - startedAt;
            console.log(
                `[ResumeMatch] OK — model=${MODEL} type=${label} keyIndex=${index} duration=${durationMs}ms`
            );
            return text;
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const status = error.status;
            console.warn(
                `[ResumeMatch] FAIL — model=${MODEL} type=${label} keyIndex=${index} ` +
                `duration=${durationMs}ms status=${status ?? 'n/a'} msg=${error.message}`
            );

            // Rate limited — back off, rotate key, retry.
            if (status === 429) {
                rateLimitRetries += 1;
                if (rateLimitRetries > MAX_RETRIES) {
                    throw new Error('[ResumeMatch] Rate limited (429) — exhausted retries');
                }
                const waitMs = backoffWithJitter(rateLimitRetries);
                console.warn(`[ResumeMatch] 429 — backoff ${waitMs}ms then retry ${rateLimitRetries}/${MAX_RETRIES}`);
                await sleep(waitMs);
                continue;
            }

            // Transient server error — retry once after 2s.
            if (status === 500 || status === 503) {
                if (hasRetriedServerError) {
                    throw new Error(`[ResumeMatch] Server error ${status} persisted after retry`);
                }
                hasRetriedServerError = true;
                console.warn(`[ResumeMatch] ${status} — retrying once after ${SERVER_ERROR_RETRY_MS}ms`);
                await sleep(SERVER_ERROR_RETRY_MS);
                continue;
            }

            // Anything else — fail fast.
            throw error;
        }
    }
}

/**
 * Text-only Gemini call (system instruction + user message), JSON response.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {{ temperature?: number }} [options]
 * @returns {Promise<string>} raw response text
 */
export async function callGemini(systemPrompt, userMessage, options = {}) {
    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
            temperature: options.temperature || DEFAULT_TEMPERATURE,
            responseMimeType: 'application/json',
        },
    };
    return executeWithRetries(body, 'text');
}

/**
 * Multimodal Gemini call: a PDF (or DOCX) inline part + a text prompt part.
 * PDF calls do NOT use system_instruction — the prompt rides alongside the file.
 *
 * @param {string} pdfBase64 - base64-encoded file bytes
 * @param {string} mimeType  - e.g. 'application/pdf'
 * @param {string} prompt    - parsing instructions
 * @param {{ temperature?: number }} [options]
 * @returns {Promise<string>} raw response text
 */
export async function callGeminiWithPdf(pdfBase64, mimeType, prompt, options = {}) {
    const body = {
        contents: [{
            parts: [
                { inline_data: { mime_type: mimeType, data: pdfBase64 } },
                { text: prompt },
            ],
        }],
        generationConfig: {
            temperature: options.temperature || DEFAULT_TEMPERATURE,
            responseMimeType: 'application/json',
        },
    };
    return executeWithRetries(body, 'pdf');
}