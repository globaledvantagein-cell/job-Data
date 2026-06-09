import { unsubscribeUser } from '../../db/index.js';
import {
    verifyUnsubscribeToken,
    renderUnsubscribeConfirmation,
} from '../../email/index.js';
import { sendEmailQuietly, unsubscribePage } from './helpers.js';

export function attachUnsubscribeRoute(authRouter) {
    // ─── Unsubscribe (one-click from email link) ──────────────────────────
    // GET /api/auth/unsubscribe?token=xxx
    // No login required. Token is a signed JWT with { email, action: 'unsubscribe' }.
    // On success, redirects to frontend homepage with ?unsubscribed=true.
    authRouter.get('/unsubscribe', async (req, res) => {
        const { token } = req.query;
        const baseUrl = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

        if (!token) {
            return res.status(400).send(unsubscribePage('Missing token.'));
        }

        try {
            const email = verifyUnsubscribeToken(token);
            const ok = await unsubscribeUser(email);

            if (!ok) {
                return res.status(404).send(unsubscribePage('Email not found or already unsubscribed.'));
            }

            console.log(`[Unsubscribe] ${email} unsubscribed from weekly digest.`);

            // Send unsubscribe confirmation email (fire-and-forget)
            try {
                const { subject, html, text } = renderUnsubscribeConfirmation({
                    name: email.split('@')[0],
                    email,
                });
                sendEmailQuietly({ to: email, subject, html, text });
            } catch (emailErr) {
                console.error('[Unsubscribe] Failed to render confirmation email:', emailErr.message);
            }

            return res.redirect(`${baseUrl}/?unsubscribed=true`);

        } catch (error) {
            console.error('[Unsubscribe] Error:', error.message);
            return res.status(400).send(
                unsubscribePage('Invalid or expired link. Please contact support@englishjobsgermany.com.')
            );
        }
    });
}
