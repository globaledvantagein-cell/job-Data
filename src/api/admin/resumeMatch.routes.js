// ─── Resume Match Routes (Smart Match) ────────────────────────────────────────
//
// POST /api/jobs/admin/resume-match  → run full AI scoring pipeline
// GET  /api/jobs/admin/resume-match  → return cached results (no AI calls)
//
// POST always re-runs the pipeline (user clicked "Find my matches" or re-uploaded).
// GET returns cached results if they exist, 404 otherwise.
// Results are saved on the user doc after every successful POST.

import multer from 'multer';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { matchResumeToJobs, matchResumeTextToJobs } from '../../resume-matcher/index.js';
import { connectToDb } from '../../db/connection.js';
import { ObjectId } from 'mongodb';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

const ALLOWED_MIMES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

async function saveCachedResults(userId, result) {
    try {
        const db = await connectToDb();
        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: {
                smartMatchCache: {
                    results: result.results,
                    meta: result.meta,
                    cachedAt: new Date(),
                },
            }},
        );
    } catch (err) {
        console.warn('[ResumeMatch] Cache save failed:', err.message);
    }
}

export function attachResumeMatchRoutes(router) {
    // ── GET: return cached results ─────────────────────────────────────
    router.get('/admin/resume-match', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const db = await connectToDb();
            const user = await db.collection('users').findOne(
                { _id: new ObjectId(req.user.id) },
                { projection: { smartMatchCache: 1 } },
            );

            if (!user?.smartMatchCache) {
                return res.status(404).json({ success: false, error: 'No cached results. Click "Find my matches" to run.' });
            }

            res.json({
                success: true,
                ...user.smartMatchCache,
                cached: true,
            });
        } catch (error) {
            console.error('[ResumeMatch] Cache fetch failed:', error.message);
            res.status(500).json({ success: false, error: 'Failed to load cached results' });
        }
    });

    // ── POST: run full pipeline (always fresh) ─────────────────────────
    router.post(
        '/admin/resume-match',
        verifyToken,
        verifyAdmin,
        upload.single('resume'),
        async (req, res) => {
            try {
                let result;

                if (req.file) {
                    if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
                        return res.status(400).json({ success: false, error: 'Please upload a PDF or DOCX file' });
                    }
                    result = await matchResumeToJobs(req.file.buffer, req.file.mimetype, req.user.id);
                } else if (req.body.resumeText) {
                    if (req.body.resumeText === 'USE_STORED_PROFILE') {
                        result = await matchResumeTextToJobs(null, req.user.id);
                    } else if (req.body.resumeText.length < 50) {
                        return res.status(400).json({ success: false, error: 'Resume text is too short. Please paste your full resume.' });
                    } else {
                        result = await matchResumeTextToJobs(req.body.resumeText, req.user.id);
                    }
                } else {
                    return res.status(400).json({ success: false, error: 'Please upload a PDF or paste your resume text' });
                }

                // Save results for future GET requests
                saveCachedResults(req.user.id, result);

                res.status(200).json({ success: true, ...result, cached: false });
            } catch (error) {
                console.error('[ResumeMatch] Error:', error.message);

                if (error.message?.includes('parse') || error.message?.includes('PDF')) {
                    return res.status(400).json({
                        success: false,
                        error: 'Could not read this file. Please try pasting your resume text instead.',
                        code: 'PDF_PARSE_FAILED',
                    });
                }
                if (error.message?.includes('rate') || error.message?.includes('429')) {
                    return res.status(429).json({
                        success: false,
                        error: 'Service is busy. Please try again in a minute.',
                        code: 'RATE_LIMITED',
                    });
                }

                res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
            }
        }
    );
}