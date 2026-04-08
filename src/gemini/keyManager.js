import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEYS } from '../env.js';

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
export const MAX_RETRIES_PER_CALL = 3;  // Retries across ALL keys for one job
export const RPM_COOLDOWN_MS = 62_000;   // 62s cooldown when RPM limit hit
export const RPD_COOLDOWN_MS = 24 * 60 * 60 * 1_000; // 24h cooldown when RPD exhausted

export class KeyState {
    constructor(apiKey, index) {
        this.apiKey = apiKey;
        this.index = index;  // for logging
        this.model = null;   // initialized lazily

        // Cooldown timestamps (null = not in cooldown)
        this.rpmCooldownUntil = null;
        this.rpdCooldownUntil = null;

        // Per-minute request window (rolling)
        this.requestsThisMinute = 0;
        this.minuteWindowStart = Date.now();
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
            this.minuteWindowStart = now;
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
export const keyStates = GEMINI_API_KEYS.map((k, i) => new KeyState(k, i));

console.log(`[AI] Initialized ${keyStates.length} API key(s) with model: ${MODEL_NAME}`);

// ─── Key Selection ─────────────────────────────────────────────────────────────

/**
 * Returns the best available KeyState, or null if ALL keys are exhausted/in cooldown.
 *
 * Strategy: prefer the key with the fewest requests in the current minute
 * (among keys not in any cooldown).
 */
export function getBestAvailableKey() {
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
export function shortestCooldownMs() {
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
export function allKeysRpdExhausted() {
    return keyStates.every(ks => ks.isRpdExhausted());
}

// ─── Diagnostic helper ─────────────────────────────────────────────────────────
// Call this to see the current state of all keys (useful for debugging)
export function getKeyStatus() {
    const now = Date.now();
    return keyStates.map(ks => ({
        key: `Key #${ks.index + 1}`,
        rpmCooldown: ks.rpmCooldownUntil ? `${Math.round((ks.rpmCooldownUntil - now) / 1000)}s remaining` : 'ready',
        rpdStatus: ks.isRpdExhausted() ? 'EXHAUSTED (daily limit hit)' : 'OK',
        requestsThisMin: ks.requestsThisMinute,
    }));
}
