/**
 * Premium early-access invite — sent once to EXISTING users when the
 * premium beta opens. New users get the same promo block inside the
 * welcome email instead (see welcomeEmail.js).
 *
 * Framing: "you're an early member, here's a free premium pass" —
 * a normal beta perk. The code is the shared beta code, redeemable
 * once per account.
 *
 * Returns { subject, html, text }
 */
import { escapeHtml, renderHeaderBanner } from './components.js';
import { buildUnsubscribeUrl } from '../unsubscribe.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

const PREMIUM_FEATURES = [
    'Unlimited job description views',
    'Unlimited apply clicks',
    'Smart Match — AI resume scoring',
    "Today's Matches — daily personalized picks",
    'Advanced filters — salary, visa, relocation & more',
    'Salary insights on every role',
];

/**
 * Renders the gold "your early-access code" block. Shared with the
 * welcome email so new + existing users see the identical premium unit.
 */
export function renderPromoBlock(promoCode) {
    const features = PREMIUM_FEATURES.map(f => `
        <tr>
            <td style="padding: 3px 0; font-size: 13.5px; color: #4b5563; line-height: 1.5;">
                <span style="color: #b98a2e; font-weight: 700;">&#10003;</span>&nbsp;&nbsp;${escapeHtml(f)}
            </td>
        </tr>`).join('');

    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; border-collapse: collapse;">
    <tr>
        <td style="padding: 24px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #b98a2e; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px;">
                &#9812; Early member perk
            </div>
            <div style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; letter-spacing: -0.3px;">
                6 months of Premium — on us
            </div>
            <div style="font-size: 13.5px; color: #4b5563; line-height: 1.6; margin-bottom: 16px;">
                As one of our early members, your first 6 months of Premium
                (<span style="text-decoration: line-through; color: #9ca3af;">&euro;14.99</span>
                <strong style="color: #111827;">&euro;0.00</strong>) are free with this code:
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 16px;">
                <tr>
                    <td style="padding: 14px; background: #ffffff; border: 2px dashed #d4a94a; border-radius: 10px; text-align: center;">
                        <span style="font-family: 'Courier New', Courier, monospace; font-size: 22px; font-weight: 800; letter-spacing: 5px; color: #92600a;">${escapeHtml(promoCode)}</span>
                    </td>
                </tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 6px;">${features}</table>
            <div style="text-align: center; margin-top: 16px;">
                <a href="${BASE_URL}/premium" style="display: inline-block; padding: 13px 32px; background: #0f1620; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 14px;">Redeem your code</a>
            </div>
            <div style="font-size: 11.5px; color: #9ca3af; text-align: center; margin-top: 12px; line-height: 1.5;">
                One redemption per account &middot; Enter the code at checkout on the Premium page
            </div>
        </td>
    </tr>
</table>`;
}

export function promoBlockText(promoCode) {
    return [
        '── EARLY MEMBER PERK ─────────────────────',
        '6 months of Premium — on us',
        '',
        'Your first 6 months of Premium (€14.99 → €0.00) are free with this code:',
        '',
        `    ${promoCode}`,
        '',
        ...PREMIUM_FEATURES.map(f => `  ✓ ${f}`),
        '',
        `Redeem at: ${BASE_URL}/premium`,
        'One redemption per account.',
        '──────────────────────────────────────────',
    ].join('\n');
}

/**
 * @param {Object} args
 * @param {string} args.name         - user's display name
 * @param {string} args.email        - user's email
 * @param {string} args.promoCode    - the beta code (e.g. BETA2026)
 * @param {boolean} [args.isSubscribed] - controls unsubscribe footer wording
 */
export function renderPremiumInvite({ name, email, promoCode, isSubscribed = false }) {
    const firstName = capitalizeFirst((name || 'there').split(' ')[0]);
    const unsubscribeUrl = buildUnsubscribeUrl(email, BASE_URL);

    const subject = 'Premium is here — your 6 months are free';

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px 20px;">

    ${renderHeaderBanner()}

    <p style="font-size: 17px; line-height: 1.5; margin: 0 0 8px; color: #111827; font-weight: 600; letter-spacing: -0.2px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 6px; color: #4b5563;">
        We just launched <strong style="color: #111827;">Premium</strong> — unlimited access to every English-speaking role in Germany, plus AI-powered matching built around your resume.
    </p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 6px; color: #4b5563;">
        Because you joined us early, you don't pay for it. Not for the first 6 months, anyway.
    </p>

    ${renderPromoBlock(promoCode)}

    <p style="font-size: 13px; color: #9ca3af; margin: 24px 0 0; line-height: 1.6;">
        The code is tied to your account and works once. If you have any trouble redeeming it, just reply to this email.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 36px 0 0; border-collapse: collapse;">
        <tr><td style="height: 1px; background: #e5e7eb; line-height: 1px; font-size: 1px;">&nbsp;</td></tr>
    </table>
    <div style="padding-top: 18px; font-size: 12px; color: #9ca3af; line-height: 1.7;">
        <p style="margin: 0 0 6px;">You're receiving this one-time announcement because you have an account on <strong style="color: #6b7280;">English Jobs in Germany</strong>.</p>
        <p style="margin: 0 0 6px;">Questions? Reply to this email or reach us at <a href="mailto:support@englishjobsgermany.com" style="color: #6C9CFF; text-decoration: none;">support@englishjobsgermany.com</a></p>
        ${isSubscribed ? `<p style="margin: 0;"><a href="${unsubscribeUrl}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe from emails</a></p>` : ''}
    </div>

</div>`;

    const text = [
        'English Jobs in Germany',
        '',
        `Hi ${firstName},`,
        '',
        'We just launched Premium — unlimited access to every English-speaking role in Germany, plus AI-powered matching built around your resume.',
        '',
        "Because you joined us early, you don't pay for it. Not for the first 6 months, anyway.",
        '',
        promoBlockText(promoCode),
        '',
        'The code is tied to your account and works once. Trouble redeeming? Just reply to this email.',
        '',
        '---',
        'Questions? Contact support@englishjobsgermany.com',
        ...(isSubscribed ? [`Unsubscribe: ${unsubscribeUrl}`] : []),
    ].join('\n');

    return { subject, html, text };
}

function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}
