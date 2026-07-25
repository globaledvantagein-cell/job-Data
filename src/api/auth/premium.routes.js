import {
    getUserProfile,
    validatePromoCode,
    redeemPromoCode,
    activatePremium,
    getSubscriptionHistory,
    isPremium,
    getUsageStats,
} from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';

// Human-readable messages for the validatePromoCode failure reasons.
const PROMO_ERROR_MESSAGES = {
    not_found: 'That promo code was not found.',
    expired: 'That promo code has expired.',
    exhausted: 'That promo code has reached its usage limit.',
};

// 3-month plan = 90 days of premium.
const PREMIUM_PLAN = 'premium_3mo';
const PREMIUM_DURATION_DAYS = 90;

/**
 * Premium / subscription routes. Mounted on the shared authRouter, so all
 * paths are under /api/auth.
 */
export function attachPremiumRoutes(authRouter) {
    // ─── Redeem a promo code ──────────────────────────────────────────────
    // POST /api/auth/redeem-promo   Body: { code }
    // Beta: only 100%-off codes are honoured; partial discounts are rejected.
    authRouter.post('/redeem-promo', verifyToken, async (req, res) => {
        try {
            const { code } = req.body || {};
            if (!code || typeof code !== 'string') {
                return res.status(400).json({ error: 'A promo code is required.' });
            }

            const check = await validatePromoCode(code);
            if (!check.valid) {
                return res.status(400).json({
                    error: 'invalid_promo',
                    reason: check.reason,
                    message: PROMO_ERROR_MESSAGES[check.reason] || 'That promo code cannot be used.',
                });
            }

            // Beta: partial discounts are not wired up yet (no payment flow).
            if (check.promo.discountPercent < 100) {
                return res.status(400).json({
                    error: 'partial_discount_unsupported',
                    message: 'Partial discounts not supported yet — only 100% promo codes accepted during beta.',
                });
            }

            // 100% off → grant premium and burn one use of the code.
            const updatedUser = await activatePremium(req.user.id, PREMIUM_DURATION_DAYS, code);
            await redeemPromoCode(code);

            return res.status(200).json({
                success: true,
                premiumUntil: updatedUser?.premiumUntil ?? null,
                plan: PREMIUM_PLAN,
            });
        } catch (error) {
            console.error('[Auth/redeem-promo] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Subscription history + current status ────────────────────────────
    // GET /api/auth/subscription
    authRouter.get('/subscription', verifyToken, async (req, res) => {
        try {
            const user = await getUserProfile(req.user.id);
            if (!user) return res.status(404).json({ error: 'User not found' });

            const history = await getSubscriptionHistory(req.user.id);

            res.json({
                isPremium: isPremium(user),
                usage: getUsageStats(user),
                history,
            });
        } catch (error) {
            console.error('[Auth/subscription] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Current usage counters + limits ──────────────────────────────────
    // GET /api/auth/usage — polled by the frontend to show "5/20 JD views used".
    authRouter.get('/usage', verifyToken, async (req, res) => {
        try {
            const user = await getUserProfile(req.user.id);
            if (!user) return res.status(404).json({ error: 'User not found' });
            res.json(getUsageStats(user));
        } catch (error) {
            console.error('[Auth/usage] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });
}
