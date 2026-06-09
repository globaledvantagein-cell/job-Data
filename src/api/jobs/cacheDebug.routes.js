import { getCacheStats } from '../../cache/index.js';

/**
 * Debug endpoint for the in-memory jobs cache.
 * GET /api/jobs/_cache/stats → { isReady, size, loadedAt, cacheVersion }
 * Remove or protect with an admin guard before exposing publicly.
 */
export function attachCacheDebugRoute(router) {
    router.get('/_cache/stats', (req, res) => {
        res.json(getCacheStats());
    });
}
