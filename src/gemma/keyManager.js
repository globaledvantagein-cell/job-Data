// ─── Gemma Key Manager ─────────────────────────────────────────────────────────
//
// Round-robin rotation for Gemma 4 31B API keys (Google AI Studio).
//
// Keys come from GEMMA_API_KEYS in .env as a comma-separated list, each from a
// DIFFERENT Google AI Studio project so their quotas are independent. We rotate
// on every getNextKey() call to spread load evenly across projects.
//
// This module is COMPLETELY SEPARATE from src/gemini/ — no shared state.

// Lazily-initialized so dotenv (loaded in env.js) has run before we read env.
let GEMMA_API_KEYS = null;
let currentIndex = 0;

// ─── Per-model free-tier caps ──────────────────────────────────────────────────
//
// Set just under Google's published limits so we route around a key before the
// API refuses it. Counts are per key per model per UTC day.
export const GEMMA_RPD_CAPS = {
    'gemma-4-26b-a4b-it': 13200,
    'gemma-4-31b-it': 13200,
};

export const GEMMA_RPM_CAPS = {
    'gemma-4-26b-a4b-it': 27,
    'gemma-4-31b-it': 27,
};

// Per-key usage: keyIndex -> Map<modelName, countToday>, plus a rolling
// per-minute counter so the RPM ceiling can be respected locally.
const modelUsage = new Map();
const minuteState = new Map(); // keyIndex -> { count, windowStart }

function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}

let currentDateKey = utcDateKey();

/** Clears every key's per-model daily counters. */
export function resetDailyCounts() {
    modelUsage.clear();
    currentDateKey = utcDateKey();
    console.log(`[Gemma] Daily model usage counters reset for ${currentDateKey} (UTC)`);
}

/** Resets the counters if the UTC date has rolled over since the last check. */
function refreshDailyWindow() {
    if (utcDateKey() !== currentDateKey) resetDailyCounts();
}

/** Requests made today with `keyIndex` against `modelName`. */
export function getModelUsageForKey(keyIndex, modelName) {
    refreshDailyWindow();
    return modelUsage.get(keyIndex)?.get(modelName) || 0;
}

/**
 * True when this key has spent its daily budget for this model.
 * A model with no configured cap is never considered exhausted.
 */
export function isModelExhaustedOnKey(keyIndex, modelName) {
    const cap = GEMMA_RPD_CAPS[modelName];
    if (cap === undefined) return false;
    return getModelUsageForKey(keyIndex, modelName) >= cap;
}

/** True when NO key has daily budget left for this model. */
export function isModelExhaustedEverywhere(modelName) {
    const keys = loadKeys();
    return keys.every((_, i) => isModelExhaustedOnKey(i, modelName));
}

/** Counts one successful call of `modelName` against `keyIndex`. */
export function recordModelUsage(keyIndex, modelName) {
    refreshDailyWindow();
    let perModel = modelUsage.get(keyIndex);
    if (!perModel) {
        perModel = new Map();
        modelUsage.set(keyIndex, perModel);
    }
    perModel.set(modelName, (perModel.get(modelName) || 0) + 1);
}

/** Rolling per-minute request count for a key, rolling the window if stale. */
function bumpMinuteCount(keyIndex) {
    const now = Date.now();
    let state = minuteState.get(keyIndex);
    if (!state || now - state.windowStart > 60_000) {
        state = { count: 0, windowStart: now };
        minuteState.set(keyIndex, state);
    }
    state.count++;
    return state.count;
}

function minuteCount(keyIndex) {
    const state = minuteState.get(keyIndex);
    if (!state) return 0;
    if (Date.now() - state.windowStart > 60_000) return 0;
    return state.count;
}

/** Snapshot of every key's usage — for logging and debugging. */
export function getAllKeysStatus() {
    refreshDailyWindow();
    return loadKeys().map((_, i) => ({
        key: `Key #${i + 1}`,
        requestsThisMinute: minuteCount(i),
        modelUsageToday: Object.fromEntries(modelUsage.get(i) || new Map()),
    }));
}

/**
 * Reads and caches the key list from process.env on first use.
 * Throws a clear error if no keys are configured.
 */
function loadKeys() {
    if (GEMMA_API_KEYS === null) {
        GEMMA_API_KEYS = (process.env.GEMMA_API_KEYS || '')
            .split(',')
            .map(key => key.trim())
            .filter(Boolean);

        if (GEMMA_API_KEYS.length === 0) {
            throw new Error(
                '[Gemma] No API keys configured. Set GEMMA_API_KEYS=key1,key2,key3 in .env'
            );
        }

        console.log(`[Gemma] Initialized ${GEMMA_API_KEYS.length} API key(s)`);
    }
    return GEMMA_API_KEYS;
}

/**
 * Returns the next API key in round-robin rotation.
 * Logs which slot is in use (1-based) but never the key value itself.
 *
 * @param {string} [model] - when given, keys that have spent their daily budget
 *        for this model, or already hit its per-minute cap, are skipped.
 * @returns {{ apiKey: string, index: number } | null} null when no key can
 *          serve this model right now.
 */
export function getNextKey(model) {
    const keys = loadKeys();
    const rpmCap = model ? GEMMA_RPM_CAPS[model] : undefined;

    // One full lap of the rotation; the first usable slot wins.
    for (let attempt = 0; attempt < keys.length; attempt++) {
        const index = currentIndex;
        currentIndex = (currentIndex + 1) % keys.length;

        if (model && isModelExhaustedOnKey(index, model)) continue;
        if (rpmCap !== undefined && minuteCount(index) >= rpmCap) continue;

        bumpMinuteCount(index);
        console.log(`[Gemma] Using Gemma key ${index + 1}/${keys.length}`);
        return { apiKey: keys[index], index };
    }

    return null;
}

/**
 * Returns the total number of configured API keys.
 */
export function getKeyCount() {
    return loadKeys().length;
}
