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
 */
export function getNextKey() {
    const keys = loadKeys();
    const key = keys[currentIndex];
    const usedIndex = currentIndex;

    currentIndex = (currentIndex + 1) % keys.length;

    console.log(`[Gemma] Using Gemma key ${usedIndex + 1}/${keys.length}`);
    return key;
}

/**
 * Returns the total number of configured API keys.
 */
export function getKeyCount() {
    return loadKeys().length;
}
