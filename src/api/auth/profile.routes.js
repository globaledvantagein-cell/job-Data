import { body, validationResult } from 'express-validator';
import multer from 'multer';
 import crypto from 'crypto';
import {
    getUserProfile,
    updateUserPreferences,
    updateJobPreferences,
    saveMatchProfile,
    getMatchProfile,
} from '../../db/index.js';
import { parseResume, parseResumeFromText } from '../../resume-matcher/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';
import {
    renderSubscriptionConfirmation,
    renderUnsubscribeConfirmation,
} from '../../email/index.js';
import { sendEmailQuietly } from './helpers.js';

export function attachProfileRoutes(authRouter) {
    // ─── Current user ─────────────────────────────────────────────────────
    authRouter.get('/me', verifyToken, async (req, res) => {
        try {
            const user = await getUserProfile(req.user.id);
            if (!user) return res.status(404).json({ error: 'User not found' });
            res.json(user);
        } catch (error) {
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Update email preferences (Profile page) ──────────────────────────
    // PATCH /api/auth/preferences
    // Body: { desiredCategories?: string[], isSubscribed?: boolean }
    //
    // Detects subscription state changes and sends confirmation emails.
    authRouter.patch('/preferences', verifyToken, [
        body('desiredCategories').optional().isArray(),
        body('isSubscribed').optional().isBoolean(),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            const { desiredCategories, isSubscribed } = req.body;

            // Get current state BEFORE updating, to detect subscription changes
            const before = await getUserProfile(req.user.id);
            if (!before) return res.status(404).json({ error: 'User not found' });

            const updated = await updateUserPreferences(req.user.id, {
                desiredCategories,
                isSubscribed,
            });
            if (!updated) return res.status(404).json({ error: 'User not found' });

            // Send confirmation emails on subscription changes
            const wasSubscribed = Boolean(before.isSubscribed);
            const nowSubscribed = typeof isSubscribed === 'boolean' ? isSubscribed : wasSubscribed;

            if (!wasSubscribed && nowSubscribed) {
                // Just subscribed → subscription confirmation
                try {
                    const cats = Array.isArray(desiredCategories)
                        ? desiredCategories
                        : (updated.desiredCategories || []);
                    const { subject, html, text } = renderSubscriptionConfirmation({
                        name: updated.name || 'there',
                        email: updated.email,
                        categories: cats,
                    });
                    sendEmailQuietly({ to: updated.email, subject, html, text });
                } catch (emailErr) {
                    console.error('[Auth/preferences] Failed to render subscription email:', emailErr.message);
                }
            } else if (wasSubscribed && !nowSubscribed) {
                // Just unsubscribed → unsubscribe confirmation
                try {
                    const { subject, html, text } = renderUnsubscribeConfirmation({
                        name: updated.name || 'there',
                        email: updated.email,
                    });
                    sendEmailQuietly({ to: updated.email, subject, html, text });
                } catch (emailErr) {
                    console.error('[Auth/preferences] Failed to render unsubscribe email:', emailErr.message);
                }
            }

            res.json(updated);
        } catch (error) {
            console.error('[Auth/preferences] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Job matching preferences (Profile page) ─────────────────────────
    // PATCH /api/auth/job-preferences
    // Body: { salary_min?, salary_max?, preferred_work_style?, notice_period?, available_from?, visa_status? }
    authRouter.patch('/job-preferences', verifyToken, async (req, res) => {
        try {
            const { salary_min, salary_max, preferred_work_style, notice_period, available_from, visa_status } = req.body;

            const prefs = {};
            if (salary_min != null) prefs.salary_min = Number(salary_min) || null;
            if (salary_max != null) prefs.salary_max = Number(salary_max) || null;
            if (preferred_work_style) prefs.preferred_work_style = String(preferred_work_style);
            if (notice_period) prefs.notice_period = String(notice_period);
            if (available_from) prefs.available_from = String(available_from);
            if (visa_status) prefs.visa_status = String(visa_status);

            const updated = await updateJobPreferences(req.user.id, prefs);
            if (!updated) return res.status(404).json({ error: 'User not found' });
            res.json({ success: true, jobPreferences: updated.jobPreferences });
        } catch (error) {
            console.error('[Auth/job-preferences] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Upload & parse resume (saves to user profile) ───────────────────
    // POST /api/auth/upload-resume
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
   

    authRouter.post('/upload-resume', verifyToken, upload.single('resume'), async (req, res) => {
        try {
            let profile;
            let resumeHash;

            if (req.file) {
                resumeHash = crypto.createHash('md5').update(req.file.buffer).digest('hex');

                // Check if same resume was already parsed
                const stored = await getMatchProfile(req.user.id);
                if (stored?.lastResumeHash === resumeHash && stored?.parsedProfile) {
                    return res.json({ success: true, profile: stored.parsedProfile, reused: true });
                }

                profile = await parseResume(req.file.buffer, req.file.mimetype);
            } else if (req.body?.resumeText) {
                resumeHash = crypto.createHash('md5').update(req.body.resumeText).digest('hex');
                profile = await parseResumeFromText(req.body.resumeText);
            } else {
                return res.status(400).json({ error: 'Upload a PDF or paste resume text' });
            }

            await saveMatchProfile(req.user.id, profile, resumeHash);
            res.json({ success: true, profile, reused: false });
        } catch (error) {
            console.error('[Auth/upload-resume] Failed:', error.message);
            res.status(500).json({ error: 'Failed to parse resume. Please try again.' });
        }
    });

    // ─── Edit profile skills ─────────────────────────────────────────────
    // PATCH /api/auth/skills
    // Body: { skills: [{ name: string, category?: string }] }
    //
    // Overwrites parsedProfile.skills with the provided array.
    // Validates each skill has a non-empty name string.
    authRouter.patch('/skills', verifyToken, async (req, res) => {
        try {
            const { skills } = req.body;

            if (!Array.isArray(skills)) {
                return res.status(400).json({ error: 'skills must be an array' });
            }

            const VALID_CATEGORIES = ['Language', 'Framework', 'Database', 'Cloud', 'DevOps', 'Tool', 'Domain', 'Other'];

            const cleaned = skills
                .filter(s => s && typeof s.name === 'string' && s.name.trim().length > 0)
                .map(s => ({
                    name: s.name.trim(),
                    category: VALID_CATEGORIES.includes(s.category) ? s.category : 'Other',
                }));

            const db = (await import('../../db/connection.js')).connectToDb;
            const database = await db();
            const { ObjectId } = await import('mongodb');

            const result = await database.collection('users').updateOne(
                { _id: new ObjectId(req.user.id) },
                {
                    $set: {
                        'parsedProfile.skills': cleaned,
                        profileUpdatedAt: new Date(),
                    },
                    $unset: { dailyMatches: '' },  // invalidate Today's Matches cache
                },
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json({ success: true, skills: cleaned });
        } catch (error) {
            console.error('[Auth/skills] Failed:', error.message);
            res.status(500).json({ error: 'Failed to update skills' });
        }
    });
}