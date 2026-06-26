// ─── Gemma Client ──────────────────────────────────────────────────────────────
//
// Calls Gemma 4 31B via Google AI Studio using the NATIVE Gemini API format
// (more reliable than the OpenAI-compatible shim). Uses native fetch — no SDK,
// no axios. The API key is passed as a ?key= query parameter, NOT a header.
//
// Separate from src/gemini/ — does not import from it.

import { getNextKey } from './keyManager.js';

const MODEL_NAME = 'gemma-4-31b-it';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_TEMPERATURE = 0.1;
const MAX_RETRIES = 3;          // retries on 429 (rate limited)
const SERVER_ERROR_RETRY_MS = 2_000; // wait before the single 500/503 retry

/**
 * Sleeps for the given number of milliseconds.
 */
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
 * Performs one HTTP call to Gemma and returns the parsed candidate text.
 * Throws an Error tagged with `.status` so the retry loop can branch on it.
 */
async function requestOnce(apiKey, body) {
    const url = `${API_BASE}/${MODEL_NAME}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = new Error(`[Gemma] API responded ${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    // Gemma 4 is a reasoning model — responses may include multiple parts:
    //   parts[0] = { thought: true, text: "<thinking>..." }
    //   parts[1] = { text: '{"required_skills":...}' }
    // We need the last non-thought part.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const nonThoughtParts = parts.filter(p => !p.thought);
    const textPart = nonThoughtParts.length > 0
        ? nonThoughtParts[nonThoughtParts.length - 1]
        : parts[parts.length - 1];
    const text = textPart?.text;

    if (typeof text !== 'string') {
        const err = new Error('[Gemma] Response missing candidates[0].content.parts[0].text');
        err.status = 0;
        throw err;
    }

    return text;
}

/**
 * Calls Gemma 4 31B with a system prompt + user message.
 *
 * @param {string} systemPrompt - system instruction text
 * @param {string} userMessage  - user content text
 * @param {{ temperature?: number }} [options]
 * @returns {Promise<string>} the model's raw response text
 *
 * Retry policy:
 *   - 429 (rate limited): exponential backoff + jitter, rotate key, up to MAX_RETRIES
 *   - 500/503 (server error): retry once after 2s
 *   - any other error: throw immediately
 */
export async function callGemma(systemPrompt, userMessage, options = {}) {
    const temperature = options.temperature ?? DEFAULT_TEMPERATURE;

    const body = {
        system_instruction: {
            parts: [{ text: systemPrompt }],
        },
        contents: [{
            role: 'user',
            parts: [{ text: userMessage }],
        }],
        generationConfig: {
            temperature,
            responseMimeType: 'application/json',
            // Disable thinking/reasoning — we don't need chain-of-thought
            // for simple extraction, and it adds 20-30s of latency + puts
            // <think> blocks into the response that break JSON parsing.
            thinkingConfig: { thinkingBudget: 0 },
        },
    };

    let rateLimitRetries = 0;
    let hasRetriedServerError = false;

    // Track key slot for logging only (1-based count of calls made).
    let keyIndex = 0;

    while (true) {
        const apiKey = getNextKey();
        keyIndex += 1;

        const startedAt = Date.now();
        try {
            const text = await requestOnce(apiKey, body);
            const durationMs = Date.now() - startedAt;
            console.log(
                `[Gemma] OK — model=${MODEL_NAME} keyCall=${keyIndex} duration=${durationMs}ms`
            );
            return text;
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const status = error.status;
            console.warn(
                `[Gemma] FAIL — model=${MODEL_NAME} keyCall=${keyIndex} ` +
                `duration=${durationMs}ms status=${status ?? 'n/a'} msg=${error.message}`
            );

            // Rate limited — back off, rotate to next key, retry.
            if (status === 429) {
                rateLimitRetries += 1;
                if (rateLimitRetries > MAX_RETRIES) {
                    throw new Error(
                        `[Gemma] Rate limited — exhausted ${MAX_RETRIES} retries`
                    );
                }
                const waitMs = backoffWithJitter(rateLimitRetries);
                console.warn(
                    `[Gemma] 429 — backoff ${waitMs}ms then retry ` +
                    `${rateLimitRetries}/${MAX_RETRIES} (rotating key)`
                );
                await sleep(waitMs);
                continue;
            }

            // Transient server error — retry exactly once after 2s.
            if (status === 500 || status === 503) {
                if (hasRetriedServerError) {
                    throw new Error(
                        `[Gemma] Server error ${status} persisted after retry`
                    );
                }
                hasRetriedServerError = true;
                console.warn(`[Gemma] ${status} — retrying once after ${SERVER_ERROR_RETRY_MS}ms`);
                await sleep(SERVER_ERROR_RETRY_MS);
                continue;
            }

            // Anything else — fail fast.
            throw error;
        }
    }
}