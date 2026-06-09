/**
 * Weekly digest email template.
 *
 * Returns: { subject, html, text, unsubscribeUrl }
 *
 * Design philosophy: looks like a plain personal email, not a marketing
 * blast. Boring HTML lands in Primary inbox.
 *
 * Hard cap: 8 jobs per email. We pick the freshest jobs across the user's
 * categories, distributing fairly via round-robin.
 *
 * Implementation is split into:
 *   weeklyDigest/picker.js   — job selection + subject builder
 *   weeklyDigest/htmlBody.js — HTML renderer
 *   weeklyDigest/textBody.js — plain-text renderer
 */
import { buildUnsubscribeUrl } from '../unsubscribe.js';
import {
    pickTopJobs,
    buildSubject,
    capitalizeFirst,
    MAX_JOBS_PER_EMAIL,
} from './weeklyDigest/picker.js';
import { renderHtml } from './weeklyDigest/htmlBody.js';
import { renderText } from './weeklyDigest/textBody.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

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
