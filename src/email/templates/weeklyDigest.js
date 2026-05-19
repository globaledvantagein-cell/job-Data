/**
 * Weekly digest email template.
 *
 * Takes a user + their matching jobs (already filtered to their categories)
 * and renders both an HTML and plain-text version. Returns:
 *   { subject, html, text, unsubscribeUrl }
 *
 * Design philosophy: looks like a plain personal email, not a marketing
 * blast. Boring HTML lands in Primary inbox. We learned this the hard way.
 *
 * Hard cap: 8 jobs per email (focused beats comprehensive). We pick the
 * freshest jobs across the user's categories, distributing fairly.
 */
import { buildUnsubscribeUrl } from '../unsubscribe.js';
import {
    escapeHtml,
    renderJobCard,
    renderCategoryHeading,
    renderSummary,
    renderHeaderBanner,
    renderFooter,
    formatEmploymentType,
    formatPostedDate,
    formatSalary,
    formatLocation,
    workplaceLabel,
} from './components.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../core/categorize.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';
const MAX_JOBS_PER_EMAIL = 8;

/**
 * Pick up to MAX_JOBS_PER_EMAIL jobs distributed fairly across the user's
 * categories. Returns { picked: { cat: [jobs] }, total: N }.
 *
 * Strategy: round-robin through categories, taking the freshest unused
 * job from each, until we hit the cap or run out.
 */
function pickTopJobs(jobsByCategory, cap = MAX_JOBS_PER_EMAIL) {
    const cats = Object.keys(jobsByCategory);
    if (cats.length === 0) return { picked: {}, total: 0 };

    // Working copies — assume jobs in each bucket are already sorted by PostedDate desc
    const queues = {};
    for (const c of cats) queues[c] = [...(jobsByCategory[c] || [])];

    const picked = {};
    for (const c of cats) picked[c] = [];

    let total = 0;
    while (total < cap) {
        let progress = false;
        for (const c of cats) {
            if (queues[c].length === 0) continue;
            picked[c].push(queues[c].shift());
            total += 1;
            progress = true;
            if (total >= cap) break;
        }
        if (!progress) break; // all empty
    }

    // Drop empty cats so we don't render empty headings
    for (const c of cats) if (picked[c].length === 0) delete picked[c];

    return { picked, total };
}

/**
 * @param {Object} args
 * @param {Object} args.user           - { email, name, desiredCategories }
 * @param {Object} args.jobsByCategory - { software: [...], data: [...], ... }
 * @param {number} args.totalJobs      - count across all their categories (pre-cap)
 * @returns {{ subject, html, text, unsubscribeUrl }}
 */
export function renderWeeklyDigest({ user, jobsByCategory, totalJobs }) {
    const firstName = capitalizeFirst((user.name || 'there').split(' ')[0]);
    const unsubscribeUrl = buildUnsubscribeUrl(user.email, BASE_URL);

    // Apply the 8-job cap fairly across categories
    const { picked, total: shownTotal } = pickTopJobs(jobsByCategory, MAX_JOBS_PER_EMAIL);
    const categoryCount = Object.keys(picked).length;

    const subject = buildSubject({ shownTotal });

    const html = renderHtml({
        firstName,
        picked,
        shownTotal,
        categoryCount,
        unsubscribeUrl,
        totalAvailable: totalJobs,
    });
    const text = renderText({
        firstName,
        picked,
        shownTotal,
        categoryCount,
        unsubscribeUrl,
        totalAvailable: totalJobs,
    });

    return { subject, html, text, unsubscribeUrl };
}

// ─── Subject line ──────────────────────────────────────────────────────────

function buildSubject({ shownTotal }) {
    if (shownTotal === 1) return `Your weekly job digest — 1 new role in Germany`;
    return `Your weekly job digest — ${shownTotal} new roles in Germany`;
}

function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── HTML version ──────────────────────────────────────────────────────────

function renderHtml({ firstName, picked, shownTotal, categoryCount, unsubscribeUrl, totalAvailable }) {
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

// ─── Plain text version ────────────────────────────────────────────────────

function renderText({ firstName, picked, shownTotal, categoryCount, unsubscribeUrl, totalAvailable }) {
    const lines = [];
    lines.push(`English Jobs in Germany — Weekly Digest`);
    lines.push('');
    lines.push(`Hi ${firstName},`);
    lines.push('');
    lines.push(shownTotal === 1
        ? `Here is a new English-speaking role in Germany that matches your preferences:`
        : `Here are this week's English-speaking roles in Germany matching your preferences:`);
    lines.push('');
    lines.push(`${shownTotal} new ${shownTotal === 1 ? 'role' : 'roles'} across ${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'} you follow`);
    lines.push('');

    for (const cat of CATEGORY_ORDER) {
        const jobs = picked[cat];
        if (!jobs?.length) continue;

        const noun = jobs.length === 1 ? 'role' : 'roles';
        lines.push(`${CATEGORY_LABELS[cat]} — ${jobs.length} ${noun}`);
        lines.push('-'.repeat(40));

        for (const job of jobs) {
            lines.push(`* ${job.JobTitle}`);
            const subline = [job.Company, formatLocation(job)].filter(Boolean).join(' — ');
            lines.push(`  ${subline}`);

            const wp = workplaceLabel(job);
            const salary = formatSalary(job);
            const meta = [
                wp,
                salary,
                formatEmploymentType(job.EmploymentType),
                formatPostedDate(job.PostedDate),
            ].filter(Boolean).join(' · ');
            if (meta) lines.push(`  ${meta}`);

            lines.push(`  ${BASE_URL}/jobs?id=${encodeURIComponent(job._id?.toString?.() || job.JobID)}`);
            lines.push('');
        }
    }

    if (totalAvailable > shownTotal) {
        lines.push(`Showing the top ${shownTotal} of ${totalAvailable} matching roles this week.`);
        lines.push(`Browse all: ${BASE_URL}/jobs`);
    } else {
        lines.push(`View all open positions: ${BASE_URL}/jobs`);
    }
    lines.push('');
    lines.push('---');
    lines.push('You are receiving this because you subscribed to weekly job alerts on English Jobs in Germany.');
    lines.push('Need help? Contact support@englishjobsgermany.com');
    lines.push(`Unsubscribe: ${unsubscribeUrl}`);

    return lines.join('\n');
}