// ─── Gemma Module Barrel ───────────────────────────────────────────────────────
// Wraps Gemma 4 31B (Google AI Studio) for structured requirement extraction.
// Separate from src/gemini/ — no shared state or imports.

export { callGemma } from './gemmaClient.js';
export { extractRequirements } from './extractRequirements.js';
export { getNextKey, getKeyCount } from './keyManager.js';
export { extractAndStoreRequirements } from './backgroundExtractor.js';
