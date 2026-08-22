import { connectToDb } from '../../db/index.js';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';

/**
 * GET /test-logs — admin view of what the AI decided, per fingerprint.
 *
 * Backed by aiResultCache since the jobTestLogs collection was retired. That
 * collection kept a full copy of every job (Description included) purely so
 * this screen could render it; the cache keeps only the verdict. The admin can
 * still see the decision and its confidence — not the description it was made
 * from, which is readable on the job itself.
 */
export function attachTestLogsRoute(router) {
    router.get('/test-logs', verifyToken, verifyAdmin, async (req, res) => {
        console.log('[API] test-logs route hit');
        try {
            const db = await connectToDb();
            const logs = await db.collection('aiResultCache')
                .find({}, {
                    projection: {
                        fingerprint: 1,
                        germanRequired: 1,
                        confidence: 1,
                        domain: 1,
                        subDomain: 1,
                        createdAt: 1,
                    },
                })
                .sort({ createdAt: -1 })
                .limit(500)
                .toArray();

            console.log('[API] Found AI cache entries:', logs.length);
            res.status(200).json(logs);
        } catch (error) {
            console.error('[API] Error fetching AI cache entries:', error);
            res.status(500).json({ error: 'Failed to fetch AI cache entries', details: error.message });
        }
    });
}
