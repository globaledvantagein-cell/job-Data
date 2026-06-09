import { connectToDb } from '../../db/index.js';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';

export function attachTestLogsRoute(router) {
    router.get('/test-logs', verifyToken, verifyAdmin, async (req, res) => {
        console.log('[API] test-logs route hit');
        try {
            const db = await connectToDb();
            const logs = await db.collection('jobTestLogs')
                .find({})
                .sort({ scrapedAt: -1 })
                .limit(500)
                .toArray();

            console.log('[API] Found logs:', logs.length);
            res.status(200).json(logs);
        } catch (error) {
            console.error('[API] Error fetching test logs:', error);
            res.status(500).json({ error: 'Failed to fetch test logs', details: error.message });
        }
    });
}
