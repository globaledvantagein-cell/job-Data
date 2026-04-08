import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { registerUser, loginUser, getUserProfile } from '../db/index.js';
import { verifyToken } from '../middleware/authMiddleware.js';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SECRET = process.env.ADMIN_CREATION_SECRET;

// 1. Join Talent Pool (Waitlist - No Password)
authRouter.post('/talent-pool', [
    body('email').isEmail(),
    body('name').notEmpty(),
    body('domain').notEmpty(), // Tech or Non-Tech
    body('location').optional()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const { email, name, domain, location } = req.body;

        // Register user with NO password and isWaitlist=true
        // The registerUser function needs to handle the lack of password gracefully 
        // (ensure your registerUser implementation allows password to be null/undefined for waitlist)
        const user = await registerUser({
            email,
            name,
            domain,
            location,
            role: 'user',
            isWaitlist: true,
            password: null // Explicitly null
        });

        // SUCCESS: Do NOT return a token. Just a success message.
        res.status(201).json({
            success: true,
            message: "Successfully joined the talent pool"
        });

    } catch (error) {
        // If user already exists, we can still say "Success" to prevent privacy leakage,
        // or return a specific error if you prefer.
        if (error.message.includes('already exists')) {
            return res.status(200).json({ success: true, message: "You are already on the list!" });
        }
        res.status(400).json({ error: error.message });
    }
});

// 2. Admin Signup (Protected by Secret Code) - KEEPS PASSWORD
authRouter.post('/admin/signup', [
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('adminSecret').exists()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const { email, password, name, adminSecret } = req.body;

        if (adminSecret !== ADMIN_SECRET) {
            return res.status(403).json({ error: "Invalid Admin Secret Code" });
        }

        const user = await registerUser({ email, password, name, role: 'admin', isWaitlist: false });
        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ token, user });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 3. Login (For Admins Only mainly, but works for Users if they have a password later)
authRouter.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await loginUser(email, password);

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({ token, user });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 4. Get Current User Data
authRouter.get('/me', verifyToken, async (req, res) => {
    try {
        const user = await getUserProfile(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "Server Error" });
    }
});