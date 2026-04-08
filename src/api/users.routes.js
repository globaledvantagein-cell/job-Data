import { Router } from 'express';
import { addSubscriber } from '../db/index.js';

export const usersApiRouter = Router();

// POST /api/users/subscribe
usersApiRouter.post('/subscribe', async (req, res) => {
    try {
        const { email, categories, frequency } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: "Invalid email address" });
        }

        await addSubscriber({ email, categories, frequency });

        console.log(`[Newsletter] New subscriber: ${email}`);
        res.status(200).json({ message: "Successfully subscribed!" });
    } catch (error) {
        console.error('[API] Subscription error:', error.message);
        res.status(500).json({ error: "Server error during subscription" });
    }
});