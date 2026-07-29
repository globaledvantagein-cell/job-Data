/**
 * Waitlist invite email — sent a few minutes after a user joins the Premium
 * waitlist. Carries their PERSONAL one-time invite code (EJG-XXXX-XXXX).
 *
 * Styled in the same navy + gold "early member" language as the premium
 * invite campaign email, so both premium emails read as one brand.
 *
 * Returns { subject, html, text }
 */
import { escapeHtml, renderHeaderBanner } from './components.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

const PREMIUM_FEATURES = [
    'Unlimited job description views',
    'Unlimited apply clicks',
    'Smart Match — AI resume scoring',
    "Today's Matches — daily personalized picks",
    'Advanced filters & salary insights',
];

/**
 * @param {Object} args
 * @param {string} args.name       - user's display name
 * @param {string} args.inviteCode - their personal code (EJG-XXXX-XXXX)
 */
export function renderWaitlistInvite({ name, inviteCode }) {
    const firstName = capitalizeFirst((name || 'there').split(' ')[0]);

    const subject = 'Your Premium invite code is ready';

    const features = PREMIUM_FEATURES.map(f => `
        <tr>
            <td style="padding: 3px 0; font-size: 13.5px; color: #4b5563; line-height: 1.5;">
                <span style="color: #b98a2e; font-weight: 700;">&#10003;</span>&nbsp;&nbsp;${escapeHtml(f)}
            </td>
        </tr>`).join('');

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px 20px;">

    ${renderHeaderBanner()}

    <p style="font-size: 17px; line-height: 1.5; margin: 0 0 8px; color: #111827; font-weight: 600; letter-spacing: -0.2px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 6px; color: #4b5563;">
        A Premium spot opened up — you're in.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; border-collapse: collapse;">
        <tr>
            <td style="padding: 24px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px;">
                <div style="font-size: 11px; font-weight: 800; color: #b98a2e; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px;">
                    &#9812; Your personal invite
                </div>
                <div style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 4px; letter-spacing: -0.3px;">
                    3 months of Premium — on us
                </div>
                <div style="font-size: 13.5px; color: #4b5563; line-height: 1.6; margin-bottom: 16px;">
                    Your first 3 months of Premium
                    (<span style="text-decoration: line-through; color: #9ca3af;">&euro;14.99/month</span>
                    <strong style="color: #111827;">&euro;0.00</strong>) are free with this code:
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 16px;">
                    <tr>
                        <td style="padding: 14px; background: #ffffff; border: 2px dashed #d4a94a; border-radius: 10px; text-align: center;">
                            <span style="font-family: 'Courier New', Courier, monospace; font-size: 22px; font-weight: 800; letter-spacing: 4px; color: #92600a;">${escapeHtml(inviteCode)}</span>
                        </td>
                    </tr>
                </table>
                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 6px;">${features}</table>
                <div style="text-align: center; margin-top: 16px;">
                    <a href="${BASE_URL}/premium" style="display: inline-block; padding: 13px 32px; background: #0f1620; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 14px;">Go to Premium</a>
                </div>
                <div style="font-size: 11.5px; color: #9ca3af; text-align: center; margin-top: 12px; line-height: 1.5;">
                    Works once, for this account &middot; Valid for 90 days &middot; No credit card needed
                </div>
            </td>
        </tr>
    </table>

    <p style="font-size: 13px; color: #9ca3af; margin: 24px 0 0; line-height: 1.6;">
        If you have any trouble redeeming your code, just reply to this email.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0 0; border-collapse: collapse;">
        <tr><td style="height: 1px; background: #e5e7eb; line-height: 1px; font-size: 1px;">&nbsp;</td></tr>
    </table>
    <div style="padding-top: 16px; font-size: 12px; color: #9ca3af; line-height: 1.7;">
        <p style="margin: 0 0 6px;">You requested this invite from the Premium page on <strong style="color: #6b7280;">English Jobs in Germany</strong>.</p>
        <p style="margin: 0;">Questions? Reply to this email or reach us at <a href="mailto:support@englishjobsgermany.com" style="color: #6C9CFF; text-decoration: none;">support@englishjobsgermany.com</a></p>
    </div>

</div>`;

    const text = [
        'English Jobs in Germany',
        '',
        `Hi ${firstName},`,
        '',
        "A Premium spot opened up — you're in.",
        '',
        '── YOUR PERSONAL INVITE ──────────────────',
        '3 months of Premium — on us',
        '',
        'Your first 3 months of Premium (€14.99/month → €0.00) are free with this code:',
        '',
        `    ${inviteCode}`,
        '',
        ...PREMIUM_FEATURES.map(f => `  ✓ ${f}`),
        '',
        `Redeem at: ${BASE_URL}/premium`,
        'Works once, for this account. Valid for 90 days. No credit card needed.',
        '──────────────────────────────────────────',
        '',
        'Trouble redeeming? Just reply to this email.',
        '',
        '---',
        'You requested this invite from the Premium page.',
        'Questions? Contact support@englishjobsgermany.com',
    ].join('\n');

    return { subject, html, text };
}

function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}
