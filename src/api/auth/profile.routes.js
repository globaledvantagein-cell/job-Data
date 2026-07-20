import { body, validationResult } from 'express-validator';
import multer from 'multer';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import {
    getUserProfile,
    updateUserPreferences,
    updateJobPreferences,
    saveMatchProfile,
    getMatchProfile,
} from '../../db/index.js';
import { connectToDb } from '../../db/connection.js';
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
   

    // ASYNC parsing: the Gemma call takes 60–90s, which trips Cloudflare's 100s
    // edge timeout (524). So we respond in < 1s and parse in the background,
    // tracked by `resumeParseStatus` on the user doc; the client polls
    // GET /parse-status. The raw PDF is NEVER persisted — the buffer lives only
    // in the background task's closure and is gone once parsing finishes.
    authRouter.post('/upload-resume', verifyToken, upload.single('resume'), async (req, res) => {
        const userId = req.user.id;
        try {
            let resumeHash;
            let parseFn;

            if (req.file) {
                const buffer = req.file.buffer;
                const mimeType = req.file.mimetype;
                resumeHash = crypto.createHash('md5').update(buffer).digest('hex');
                parseFn = () => parseResume(buffer, mimeType);
            } else if (req.body?.resumeText) {
                const text = req.body.resumeText;
                resumeHash = crypto.createHash('md5').update(text).digest('hex');
                parseFn = () => parseResumeFromText(text);
            } else {
                return res.status(400).json({ error: 'Upload a PDF or paste resume text' });
            }

            const stored = await getMatchProfile(userId);

            // Same resume already parsed → nothing to do, return instantly.
            if (stored?.lastResumeHash === resumeHash && stored?.parsedProfile) {
                return res.json({ status: 'unchanged', profile: stored.parsedProfile });
            }

            const db = await connectToDb();
            const users = db.collection('users');

            // Already parsing (e.g. a duplicate upload while one is in flight)
            // → don't kick off a second parse.
            const current = await users.findOne(
                { _id: new ObjectId(userId) },
                { projection: { resumeParseStatus: 1 } },
            );
            if (current?.resumeParseStatus === 'processing') {
                return res.json({ status: 'processing', message: 'Your resume is already being analyzed' });
            }

            // Mark processing and respond immediately.
            await users.updateOne(
                { _id: new ObjectId(userId) },
                {
                    $set: { resumeParseStatus: 'processing', resumeParseStartedAt: new Date() },
                    $unset: { resumeParseError: '' },
                },
            );
            res.json({ status: 'processing', message: 'Your resume is being analyzed' });

            // Background parse — intentionally NOT awaited by the request.
            setImmediate(async () => {
                try {
                    const profile = await parseFn();
                    await saveMatchProfile(userId, profile, resumeHash);
                    await users.updateOne(
                        { _id: new ObjectId(userId) },
                        {
                            $set: { resumeParseStatus: 'complete' },
                            // Fresh profile invalidates the Today's Matches cache.
                            $unset: { dailyMatches: '', resumeParseStartedAt: '', resumeParseError: '' },
                        },
                    );
                    console.log(`[Auth/upload-resume] Background parse complete for ${userId}`);
                } catch (err) {
                    console.error('[Auth/upload-resume] Background parse failed:', err.message);
                    await users.updateOne(
                        { _id: new ObjectId(userId) },
                        {
                            $set: { resumeParseStatus: 'failed', resumeParseError: err.message },
                            $unset: { resumeParseStartedAt: '' },
                        },
                    ).catch(() => { /* nothing more we can do */ });
                }
            });
        } catch (error) {
            console.error('[Auth/upload-resume] Failed to start:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to start resume analysis. Please try again.' });
            }
        }
    });

    // ─── Poll resume parse status ────────────────────────────────────────
    // GET /api/auth/parse-status
    // Returns { status: 'idle' | 'processing' | 'complete' | 'failed', ... }.
    // On 'complete' it also returns the parsedProfile and resets the flag to
    // 'idle' so a later visit doesn't re-show a stale "complete".
    authRouter.get('/parse-status', verifyToken, async (req, res) => {
        const userId = req.user.id;
        try {
            const db = await connectToDb();
            const users = db.collection('users');
            const user = await users.findOne(
                { _id: new ObjectId(userId) },
                { projection: { resumeParseStatus: 1, resumeParseError: 1, resumeParseStartedAt: 1, parsedProfile: 1 } },
            );
            if (!user) return res.status(404).json({ error: 'User not found' });

            let status = user.resumeParseStatus || 'idle';

            // Stuck-processing cleanup: a server restart mid-parse would leave the
            // status 'processing' forever. If it's older than 10 min, reset it.
            if (status === 'processing' && user.resumeParseStartedAt) {
                const ageMs = Date.now() - new Date(user.resumeParseStartedAt).getTime();
                if (ageMs > 10 * 60 * 1000) {
                    await users.updateOne(
                        { _id: new ObjectId(userId) },
                        { $set: { resumeParseStatus: 'idle' }, $unset: { resumeParseStartedAt: '' } },
                    );
                    status = 'idle';
                }
            }

            if (status === 'complete') {
                // Hand back the profile once, then reset the flag.
                await users.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { resumeParseStatus: 'idle' } },
                );
                return res.json({ status: 'complete', profile: user.parsedProfile || null });
            }

            if (status === 'failed') {
                return res.json({ status: 'failed', error: user.resumeParseError || 'Resume analysis failed' });
            }

            return res.json({ status }); // 'idle' | 'processing'
        } catch (error) {
            console.error('[Auth/parse-status] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
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