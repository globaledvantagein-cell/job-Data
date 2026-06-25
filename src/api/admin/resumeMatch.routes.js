// ─── Admin Resume Match Route ──────────────────────────────────────────────────
//
// Premium, admin-only endpoint: upload a resume (PDF/DOCX) or paste text, and get
// back a ranked list of matching active jobs with per-job analysis.
//
// File uploads use multer memory storage — resumes stay in RAM and are never
// written to disk.

import multer from 'multer';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { matchResumeToJobs, matchResumeTextToJobs } from '../../resume-matcher/index.js';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

const ALLOWED_MIMES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
];

export function attachResumeMatchRoutes(router) {
    router.post(
        '/admin/resume-match',
        verifyToken,
        verifyAdmin,
        upload.single('resume'),
        async (req, res) => {
            try {
                let result;

                if (req.file) {
                    // PDF / DOCX uploaded.
                    if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
                        return res.status(400).json({ success: false, error: 'Please upload a PDF or DOCX file' });
                    }
                    result = await matchResumeToJobs(req.file.buffer, req.file.mimetype);
                } else if (req.body.resumeText) {
                    // Pasted text.
                    if (req.body.resumeText.length < 50) {
                        return res.status(400).json({ success: false, error: 'Resume text is too short. Please paste your full resume.' });
                    }
                    result = await matchResumeTextToJobs(req.body.resumeText);
                } else {
                    return res.status(400).json({ success: false, error: 'Please upload a PDF or paste your resume text' });
                }

                res.status(200).json({ success: true, ...result });
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
