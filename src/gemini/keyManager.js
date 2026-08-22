// ─── Gemini Key Manager (SINGLETON) ────────────────────────────────────────────
//
// ONE shared key pool for every Gemini consumer in the process — the scraper's
// job analyzer AND Smart Match's resume scoring. Previously each had its own
// private rotation, so both could hammer the same key at the same time while
// believing they were spreading load.
//
// Because ES modules are cached per-process, importing this file anywhere gives
// the same state: per-minute request counts, cooldown timestamps and dead-key
// flags are visible to all callers. When the scraper marks key #1 RPM-limited,
// Smart Match skips it on its very next call.
//
// Modelled after src/gemma/keyManager.js (one shared module, one source of
// truth) but with richer state, since Gemini keys hit RPM limits and can be
// permanently rejected with 403.
//
// Keys come from GEMINI_API_KEY_1/_2/_3, assembled in src/env.js.

import { GEMINI_API_KEYS } from '../env.js';

export const RPM_COOLDOWN_MS = 62_000; // default cooldown when a 429 carries no retry hint

// ─── Per-model free-tier caps ──────────────────────────────────────────────────
//
// Deliberately set BELOW Google's published limits so we stop asking before the
// API starts refusing — a 429 wastes a round-trip and parks the key for a
// minute, whereas a local cap just routes the call to another key/model.
// Counts are per key per model per UTC day.
export const MODEL_RPD_CAPS = {
    'gemini-3.7-flash': 17,
    'gemini-3.6-flash': 17,
    'gemini-3.5-flash-lite': 480,
    'gemini-3.5-flash': 17,
    'gemini-3.1-flash-lite': 480,
    'gemini-3-flash': 17,
    'gemini-2.5-flash-lite': 17,
    'gemini-2.5-flash': 17,
};

export const MODEL_RPM_CAPS = {
    'gemini-3.7-flash': 4,
    'gemini-3.6-flash': 4,
    'gemini-3.5-flash-lite': 13,
    'gemini-3.5-flash': 4,
    'gemini-3.1-flash-lite': 13,
    'gemini-3-flash': 4,
    'gemini-2.5-flash-lite': 8,
    'gemini-2.5-flash': 4,
};

if (GEMINI_API_KEYS.length === 0) {
    throw new Error('[Gemini] No API keys configured. Set GEMINI_API_KEY_1, _2, _3 in .env');
}

// One state record per configured key. Never reassigned — this array IS the
// shared state.
const keyStates = GEMINI_API_KEYS.map((apiKey, index) => ({
    apiKey,
    index,
    dead: false,              // 403 Forbidden — permanently unusable
    cooldownUntil: null,      // epoch ms while RPM-limited, null when ready
    requestsThisMinute: 0,
    minuteWindowStart: Date.now(),
    modelUsage: new Map(),    // modelName -> requests made today with this key
}));

console.log(`[Gemini] Initialized ${keyStates.length} shared API key(s)`);

// ─── Daily counter reset (UTC) ─────────────────────────────────────────────────
//
// Google's free-tier RPD windows roll over at UTC midnight, so the local
// counters must too. There's no timer: every read checks whether the UTC date
// has moved on and wipes the counters first, which is both cheaper and correct
// for a process that may have been idle across the boundary.

function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}

let currentDateKey = utcDateKey();

/** Clears every key's per-model daily counters. */
export function resetDailyCounts() {
    for (const ks of keyStates) ks.modelUsage.clear();
    currentDateKey = utcDateKey();
    console.log(`[Gemini] Daily model usage counters reset for ${currentDateKey} (UTC)`);
}

/** Resets the counters if the UTC date has changed since the last check. */
function refreshDailyWindow() {
    if (utcDateKey() !== currentDateKey) resetDailyCounts();
}

/** Requests made today with `keyIndex` against `modelName`. */
export function getModelUsageForKey(keyIndex, modelName) {
    refreshDailyWindow();
    return keyStates[keyIndex]?.modelUsage.get(modelName) || 0;
}

/**
 * True when this key has spent its daily budget for this model.
 * A model with no configured cap is never considered exhausted.
 */
export function isModelExhaustedOnKey(keyIndex, modelName) {
    const cap = MODEL_RPD_CAPS[modelName];
    if (cap === undefined) return false;
    const ks = keyStates[keyIndex];
    if (!ks) return true;
    if (ks.dead) return true;
    return getModelUsageForKey(keyIndex, modelName) >= cap;
}

/** Counts one successful call of `modelName` against `keyIndex`. */
export function recordModelUsage(keyIndex, modelName) {
    refreshDailyWindow();
    const ks = keyStates[keyIndex];
    if (!ks) return;
    ks.modelUsage.set(modelName, (ks.modelUsage.get(modelName) || 0) + 1);
}

/** Rolls the per-minute window forward if the current one has elapsed. */
function refreshWindow(ks, now) {
    if (now - ks.minuteWindowStart > 60_000) {
        ks.requestsThisMinute = 0;
        ks.minuteWindowStart = now;
    }
}

/** True when the key is neither dead nor inside an active cooldown. */
function isAvailable(ks, now) {
    if (ks.dead) return false;
    if (ks.cooldownUntil && now < ks.cooldownUntil) return false;
    if (ks.cooldownUntil) ks.cooldownUntil = null; // expired — clear it
    return true;
}

/**
 * Picks the best key to use right now: among keys that are alive and out of
 * cooldown, the one with the fewest requests in the current minute.
 *
 * Records the request against the chosen key before returning, so concurrent
 * callers immediately see the increased load and pick a different key.
 *
 * @param {string} [model] - when given, keys that have spent their daily budget
 *        for this model, or already hit its per-minute cap, are skipped.
 * @returns {{ apiKey: string, index: number, requestsThisMinute: number } | null}
 *          null when no key can serve this model right now.
 */
export function getNextKey(model) {
    const now = Date.now();
    const rpmCap = model ? MODEL_RPM_CAPS[model] : undefined;
    let best = null;

    for (const ks of keyStates) {
        refreshWindow(ks, now);
        if (!isAvailable(ks, now)) continue;
        if (model && isModelExhaustedOnKey(ks.index, model)) continue;
        // Stay under the model's RPM ceiling rather than earning a 429.
        if (rpmCap !== undefined && ks.requestsThisMinute >= rpmCap) continue;
        if (best === null || ks.requestsThisMinute < best.requestsThisMinute) best = ks;
    }

    if (!best) return null;

    best.requestsThisMinute++;
    return {
        apiKey: best.apiKey,
        index: best.index,
        requestsThisMinute: best.requestsThisMinute,
    };
}

/**
 * Marks a key rate-limited for `cooldownSeconds` (defaults to 62s). Every other
 * consumer skips it until the cooldown expires.
 */
export function markKeyRpmLimited(index, cooldownSeconds) {
    const ks = keyStates[index];
    if (!ks) return;
    const cooldownMs = cooldownSeconds > 0 ? cooldownSeconds * 1_000 : RPM_COOLDOWN_MS;
    ks.cooldownUntil = Date.now() + cooldownMs;
}

/** Marks a key permanently unusable (403 Forbidden). Never retried. */
export function markKeyDead(index) {
    const ks = keyStates[index];
    if (!ks) return;
    ks.dead = true;
}

/** Number of keys that are not dead (they may still be in cooldown). */
export function getActiveKeyCount() {
    return keyStates.filter(ks => !ks.dead).length;
}

/** Total number of configured keys, dead ones included. */
export function getTotalKeyCount() {
    return keyStates.length;
}

/**
 * Shortest remaining cooldown across all non-dead keys, in ms.
 * null when no key is merely cooling down (i.e. every key is dead).
 */
export function shortestCooldownMs() {
    const now = Date.now();
    let shortest = null;

    for (const ks of keyStates) {
        if (ks.dead) continue;
        if (!ks.cooldownUntil) continue;
        const remaining = ks.cooldownUntil - now;
        if (remaining <= 0) continue;
        if (shortest === null || remaining < shortest) shortest = remaining;
    }
    return shortest;
}

/**
 * True when NO key has daily budget left for this model. This is the permanent
 * condition the cascade acts on — unlike an RPM ceiling, waiting won't help.
 */
export function isModelExhaustedEverywhere(model) {
    return keyStates.every(ks => ks.dead || isModelExhaustedOnKey(ks.index, model));
}

/**
 * Milliseconds until the soonest per-minute window rolls over on a key that
 * still has daily budget for `model`. Used when getNextKey() came back empty
 * only because every candidate had hit the model's RPM ceiling — that clears
 * on its own, so the caller should wait rather than give up.
 */
export function msUntilMinuteWindowReset(model) {
    const now = Date.now();
    let soonest = null;

    for (const ks of keyStates) {
        if (ks.dead) continue;
        if (model && isModelExhaustedOnKey(ks.index, model)) continue;
        const remaining = Math.max(0, 60_000 - (now - ks.minuteWindowStart));
        if (soonest === null || remaining < soonest) soonest = remaining;
    }
    return soonest;
}

/** Snapshot of every key's state — for logging and debugging. */
export function getAllKeysStatus() {
    refreshDailyWindow();
    const now = Date.now();
    return keyStates.map(ks => ({
        key: `Key #${ks.index + 1}`,
        status: ks.dead
            ? 'DEAD (403 Forbidden)'
            : (ks.cooldownUntil && now < ks.cooldownUntil)
                ? `cooldown ${Math.round((ks.cooldownUntil - now) / 1000)}s remaining`
                : 'ready',
        requestsThisMinute: ks.requestsThisMinute,
        modelUsageToday: Object.fromEntries(ks.modelUsage),
    }));
}
