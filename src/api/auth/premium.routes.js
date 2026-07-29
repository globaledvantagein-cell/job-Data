import crypto from 'crypto';
import {
    getUserProfile,
    validatePromoCode,
    redeemPromoCode,
    activatePremium,
    getSubscriptionHistory,
    isPremium,
    getUsageStats,
    createPromoCode,
    findPendingCodeForUser,
    promoCodeExists,
} from '../../db/index.js';
import { verifyToken } from '../../middleware/authMiddleware.js';
import { Analytics } from '../../models/analyticsModel.js';
import { sendEmail, renderWaitlistInvite } from '../../email/index.js';

// Human-readable messages for the validatePromoCode failure reasons.
const PROMO_ERROR_MESSAGES = {
    not_found: 'That invite code was not found.',
    expired: 'That invite code has expired.',
    exhausted: 'That invite code has already been used.',
};

// 3-month plan = 90 days of premium.
const PREMIUM_PLAN = 'premium_3mo';
const PREMIUM_DURATION_DAYS = 90;

// Personal invite codes: valid for 90 days from generation.
const INVITE_CODE_TTL_DAYS = 90;
// The invite email is sent after a short random delay (3–7 min) so joining
// the waitlist feels like a real allocation, not an instant vending machine.
const INVITE_EMAIL_MIN_DELAY_MS = 180_000;
const INVITE_EMAIL_MAX_DELAY_MS = 420_000;

/** Generate an invite code like EJG-4F7K-9Q2M (uppercase base36 from crypto). */
function generateInviteCode() {
    const chars = crypto.randomBytes(16).readBigUInt64BE()
        .toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '')
        .padEnd(8, crypto.randomInt(0, 36).toString(36).toUpperCase());
    return `EJG-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/**
 * Premium / subscription routes. Mounted on the shared authRouter, so all
 * paths are under /api/auth.
 */
export function attachPremiumRoutes(authRouter) {
    // ─── Join the Premium waitlist ────────────────────────────────────────
    // POST /api/auth/join-waitlist
    // Generates a personal one-time invite code and emails it after a short
    // delay. Idempotent: a user with a pending (unused, unexpired) code is
    // told to check their email instead of getting a second code.
    authRouter.post('/join-waitlist', verifyToken, async (req, res) => {
        try {
            const user = await getUserProfile(req.user.id);
            if (!user) return res.status(404).json({ error: 'User not found' });

            if (isPremium(user)) {
                return res.status(400).json({ error: 'already_premium' });
            }

            const pending = await findPendingCodeForUser(req.user.id);
            if (pending) {
                return res.status(200).json({
                    alreadyJoined: true,
                    message: "You're already on the waitlist. Check your email.",
                });
            }

            // Generate a unique code; regenerate on the (astronomically rare)
            // collision.
            let code = generateInviteCode();
            let guard = 0;
            while (await promoCodeExists(code) && guard < 5) {
                code = generateInviteCode();
                guard += 1;
            }

            const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
            await createPromoCode(code, 100, 1, expiresAt, {
                generatedFor: req.user.id,
                generatedForEmail: user.email,
            });

            Analytics.increment('waitlist_joins'); // fire-and-forget

            // Delayed invite email (3–7 min). NOTE: setTimeout is in-process —
            // a server restart during the window drops the send; the user's
            // pending code is still valid and support can resend it.
            const delayMs = INVITE_EMAIL_MIN_DELAY_MS +
                crypto.randomInt(0, INVITE_EMAIL_MAX_DELAY_MS - INVITE_EMAIL_MIN_DELAY_MS);
            const userId = req.user.id;
            setTimeout(async () => {
                try {
                    // Re-read the user in case the email changed meanwhile.
                    const fresh = await getUserProfile(userId);
                    const to = fresh?.email;
                    if (!to) return;
                    const { subject, html, text } = renderWaitlistInvite({
                        name: fresh.name,
                        inviteCode: code,
                    });
                    const result = await sendEmail({ to, subject, html, text });
                    if (result.ok) {
                        console.log(`[Waitlist] ✅ Invite code emailed to ${to}`);
                    } else {
                        console.error(`[Waitlist] ❌ Invite email to ${to} failed: ${result.error}`);
                    }
                } catch (err) {
                    console.error('[Waitlist] ❌ Invite email exception:', err.message);
                }
            }, delayMs);
            console.log(`[Waitlist] Code generated for user ${userId}; email scheduled in ${Math.round(delayMs / 1000)}s`);

            return res.status(200).json({
                success: true,
                message: "You're on the waitlist! We'll send your invite code to your email shortly.",
            });
        } catch (error) {
            console.error('[Auth/join-waitlist] Failed:', error.message);
            res.status(500).json({ error: 'Server Error' });
        }
    });

    // ─── Waitlist status ──────────────────────────────────────────────────
    // GET /api/auth/waitlist-status — lets the premium page restore the
    // "spot secured" state after a refresh. The DB (pending unexpired code)
    // is the source of truth, so it works across devices too. Fails open to
    // { onWaitlist: false }: joining again is idempotent, so the worst case
    // of a transient error is a harmless re-click.
    authRouter.get('/waitlist-status', verifyToken, async (req, res) => {
        try {
            const pending = await findPendingCodeForUser(req.user.id);
            res.status(200).json({
                onWaitlist: Boolean(pending),
                joinedAt: pending?.createdAt ?? null,
            });
        } catch (error) {
            console.error('[Auth/waitlist-status] Failed:', error.message);
            res.status(200).json({ onWaitlist: false, joinedAt: null });
        }
    });

    // ─── Redeem an invite / promo code ────────────────────────────────────
    // POST /api/auth/redeem-promo   Body: { code }
    // Invite-only launch: only 100%-off codes are honoured.
    authRouter.post('/redeem-promo', verifyToken, async (req, res) => {
        try {
            const { code } = req.body || {};
            if (!code || typeof code !== 'string') {
                return res.status(400).json({ error: 'An invite code is required.' });
            }

            const check = await validatePromoCode(code);
            if (!check.valid) {
                Analytics.increment('promo_failed_attempts'); // fire-and-forget
                return res.status(400).json({
                    error: 'invalid_promo',
                    reason: check.reason,
                    message: PROMO_ERROR_MESSAGES[check.reason] || 'That invite code cannot be used.',
                });
            }

            if (check.promo.discountPercent < 100) {
                return res.status(400).json({
                    error: 'partial_discount_unsupported',
                    message: 'Only full-access invite codes are accepted right now.',
                });
            }

            // One redemption per user per code — without this, a user could
            // re-redeem the same unlimited code every 90 days forever.
            const priorSubs = await getSubscriptionHistory(req.user.id);
            const normalizedCode = code.trim().toUpperCase();
            if (priorSubs.some(s => s.promoCode === normalizedCode)) {
                Analytics.increment('promo_failed_attempts'); // fire-and-forget
                return res.status(400).json({
                    error: 'invalid_promo',
                    reason: 'already_used',
                    message: "You've already used this code.",
                });
            }

            // 100% off → grant premium and burn one use of the code.
            const updatedUser = await activatePremium(req.user.id, PREMIUM_DURATION_DAYS, code);
            await redeemPromoCode(code);
            Analytics.increment('promo_redemptions'); // fire-and-forget

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
