import {
    formatEmploymentType,
    formatPostedDate,
    formatSalary,
    formatLocation,
    workplaceLabel,
} from '../components.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../../core/categorize.js';

const BASE_URL = process.env.FRONTEND_ORIGIN || 'https://englishjobsgermany.com';

export function renderText({ firstName, picked, shownTotal, categoryCount, unsubscribeUrl, totalAvailable }) {
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
