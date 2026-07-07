// ─── Skill Match Routes ────────────────────────────────────────────────────────
//
// GET  /api/jobs/skill-matches   → top 5 jobs matching user's profile skills
//                                   (no AI, pure programmatic, from RAM cache)

import { Router } from 'express';
import { verifyToken } from '../../middleware/authMiddleware.js';
import { getMatchProfile } from '../../db/index.js';
import { getSkillMatches } from '../../skill-matcher/index.js';

const router = Router();

router.get('/skill-matches', verifyToken, async (req, res) => {
    try {
        const stored = await getMatchProfile(req.user.id);
        const profile = stored?.parsedProfile || null;

        const { matches, meta } = getSkillMatches(profile);

        res.json({ matches, meta });
    } catch (error) {
        console.error('[SkillMatch] Failed:', error.message);
        res.status(500).json({ error: 'Failed to compute skill matches' });
    }
});

export function attachSkillMatchRoutes(jobsRouter) {
    jobsRouter.use('/', router);
}