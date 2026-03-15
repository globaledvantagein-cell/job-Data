import { Router } from 'express';
import crypto from 'crypto';
import {
    saveFeedback,
    getAllFeedback,
    updateFeedbackStatus,
    deleteFeedback,
    getFeedbackStats
} from '../Db/databaseManager.js';
import { createFeedback } from '../models/feedbackModel.js';
import { verifyToken, verifyAdmin } from '../middleware/authMiddleware.js';

export const feedbackRouter = Router();

feedbackRouter.post('/', async (req, res) => {
    try {
        const { name, email, message, source } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount > 200) {
            return res.status(400).json({ error: 'Message exceeds 200 word limit' });
        }

        if (email && email.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                return res.status(400).json({ error: 'Invalid email format' });
            }
        }

        const forwardedFor = req.headers['x-forwarded-for'];
        const ip = Array.isArray(forwardedFor)
            ? forwardedFor[0]
            : (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null) || req.connection?.remoteAddress || 'unknown';

        const ipHash = crypto.createHash('sha256').update(ip + 'salt_feedback').digest('hex').substring(0, 16);

        const feedbackData = createFeedback({
            name,
            email,
            message,
            source: source || 'footer',
            userAgent: req.headers['user-agent'] || null,
            ipHash,
            userId: req.user?.id || null,
        });

        await saveFeedback(feedbackData);

        res.status(201).json({
            success: true,
            message: 'Feedback received. Thank you!'
        });
    } catch (error) {
        console.error('[Feedback] Error saving feedback:', error);
        res.status(500).json({ error: 'Failed to save feedback' });
    }
});

feedbackRouter.get('/', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const status = req.query.status || null;

        const data = await getAllFeedback(page, limit, status);
        res.json(data);
    } catch {
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

feedbackRouter.get('/stats', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const stats = await getFeedbackStats();
        res.json(stats);
    } catch {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

feedbackRouter.patch('/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNote } = req.body;

        const validStatuses = ['unread', 'read', 'resolved', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        await updateFeedbackStatus(id, status, adminNote);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

feedbackRouter.delete('/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await deleteFeedback(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
