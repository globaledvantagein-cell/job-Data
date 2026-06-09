import {
    escapeHtml,
    renderJobCard,
    renderCategoryHeading,
    renderSummary,
    renderHeaderBanner,
    renderFooter,
} from '../components.js';
import { CATEGORY_ORDER } from '../../../core/categorize.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

export function renderHtml({ firstName, picked, shownTotal, categoryCount, unsubscribeUrl, totalAvailable }) {
    const categoryBlocks = CATEGORY_ORDER
        .filter(cat => picked[cat]?.length > 0)
        .map(cat => {
            const cards = picked[cat].map(j => renderJobCard(j, BASE_URL)).join('');
            return renderCategoryHeading(cat, picked[cat].length) + cards;
        })
        .join('');

    const moreLine = totalAvailable > shownTotal
        ? `<p style="font-size: 13px; color: #6b7280; line-height: 1.6; margin: 22px 0 0;">
              Showing the top ${shownTotal} of ${totalAvailable} matching roles this week.
              <a href="${BASE_URL}/jobs" style="color: #6C9CFF; text-decoration: none; font-weight: 600;">Browse them all →</a>
           </p>`
        : `<p style="font-size: 14px; line-height: 1.6; margin: 22px 0 0;">
              <a href="${BASE_URL}/jobs" style="color: #6C9CFF; text-decoration: none; font-weight: 600;">View all open positions →</a>
           </p>`;

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px 20px;">

    ${renderHeaderBanner()}

    <p style="font-size: 17px; line-height: 1.5; margin: 0 0 8px; color: #111827; font-weight: 600; letter-spacing: -0.2px;">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size: 15px; line-height: 1.65; margin: 0 0 24px; color: #4b5563;">
        ${shownTotal === 1
            ? `here is a new English-speaking role in Germany that matches your preferences this week.`
            : `here are this week's English-speaking roles in Germany matching your preferences.`}
    </p>

    ${renderSummary({ totalJobs: shownTotal, categoryCount })}

    ${categoryBlocks}

    ${moreLine}

    ${renderFooter(unsubscribeUrl)}

</div>`;
}
