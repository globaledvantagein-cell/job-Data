// ─── Skill Match Routes (Today's Matches) ──────────────────────────────────────
//
// GET  /api/jobs/skill-matches          → top 5 skill-matched jobs
// GET  /api/jobs/skill-matches?refresh=1 → force recompute (Refresh button)
//
// Caching: results saved on user doc as dailyMatches.
// Served from cache if: same calendar day + same skill hash.
// Invalidated automatically when skills change (PATCH /skills clears it).

import { Router } from 'express';
import crypto from 'node:crypto';
import { verifyToken } from '../../middleware/authMiddleware.js';
import { getMatchProfile } from '../../db/index.js';
import { getSkillMatches } from '../../skill-matcher/index.js';
import { connectToDb } from '../../db/connection.js';
import { ObjectId } from 'mongodb';

const router = Router();

function skillHash(skills) {
    if (!Array.isArray(skills) || skills.length === 0) return '';
    const names = skills.map(s => (typeof s === 'string' ? s : s?.name || '')).sort().join('|');
    return crypto.createHash('md5').update(names).digest('hex');
}

function todayStr() {
    return new Date().toISOString().slice(0, 10); // "2026-07-09"
}

router.get('/skill-matches', verifyToken, async (req, res) => {
    try {
        const stored = await getMatchProfile(req.user.id);
        const profile = stored?.parsedProfile || null;
        const forceRefresh = req.query.refresh === '1';

        // ── Check cache (unless refresh requested) ─────────────────────
        if (!forceRefresh && stored?.dailyMatches) {
            const cache = stored.dailyMatches;
            const currentHash = skillHash(profile?.skills);
            if (cache.date === todayStr() && cache.skillHash === currentHash) {
                return res.json({ matches: cache.matches, meta: cache.meta, cached: true });
            }
        }

        // ── Compute fresh matches ──────────────────────────────────────
        const { matches, meta } = getSkillMatches(profile);

        // ── Save to user doc (fire-and-forget) ─────────────────────────
        if (meta.reason === 'ok' || meta.reason === 'no_matches') {
            const db = await connectToDb();
            db.collection('users').updateOne(
                { _id: new ObjectId(req.user.id) },
                { $set: {
                    dailyMatches: {
                        matches,
                        meta,
                        date: todayStr(),
                        skillHash: skillHash(profile?.skills),
                        computedAt: new Date(),
                    },
                }},
            ).catch(err => console.warn('[SkillMatch] Cache save failed:', err.message));
        }

        res.json({ matches, meta, cached: false });
    } catch (error) {
        console.error('[SkillMatch] Failed:', error.message);
        res.status(500).json({ error: 'Failed to compute skill matches' });
    }
});

export function attachSkillMatchRoutes(jobsRouter) {
    jobsRouter.use('/', router);
}