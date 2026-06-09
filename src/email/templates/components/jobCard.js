import {
    escapeHtml,
    formatPostedDate,
    formatEmploymentType,
    formatSalary,
    formatLocation,
    workplaceLabel,
} from './formatters.js';
import { companyLogoUrl } from './branding.js';

function pill(text, { color = '#374151', bg = '#f3f4f6', border = '#e5e7eb' } = {}) {
    return `<span style="display: inline-block; padding: 3px 9px; font-size: 10px; font-weight: 700; color: ${color}; background: ${bg}; border: 1px solid ${border}; border-radius: 12px; margin-right: 4px; letter-spacing: 0.3px; text-transform: uppercase;">${escapeHtml(text)}</span>`;
}

/**
 * Job row with two-column layout:
 *   [logo 48px] | [title, company, salary, meta]
 * Uses tables for email-client compatibility. Every optional field renders
 * gracefully when missing.
 */
export function renderJobCard(job, baseUrl) {
    const title = escapeHtml(job.JobTitle);
    const company = escapeHtml(job.Company);
    const location = escapeHtml(formatLocation(job));
    const jobUrl = `${baseUrl}/jobs?id=${encodeURIComponent(job._id?.toString?.() || job.JobID)}`;
    const logo = companyLogoUrl(job.Company, 96);

    const employment = formatEmploymentType(job.EmploymentType);
    const posted = formatPostedDate(job.PostedDate);
    const salary = formatSalary(job);
    const workplace = workplaceLabel(job);

    const workplacePill = workplace
        ? pill(workplace, { color: '#065f46', bg: '#d1fae5', border: '#a7f3d0' })
        : '';

    const salaryLine = salary
        ? `<div style="font-size: 13px; color: #059669; font-weight: 700; margin-top: 6px; letter-spacing: -0.1px;">${escapeHtml(salary)}</div>`
        : '';

    const metaParts = [];
    if (employment) metaParts.push(escapeHtml(employment));
    if (posted) metaParts.push(escapeHtml(posted));
    const metaLine = metaParts.length
        ? `<div style="font-size: 11px; color: #9ca3af; margin-top: 8px; font-weight: 500; letter-spacing: 0.2px; text-transform: uppercase;">${metaParts.join(' · ')}</div>`
        : '';

    return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 12px; border-collapse: collapse;">
    <tr>
        <td style="padding: 16px 18px; border: 1px solid #e5e7eb; border-radius: 10px; background: #ffffff;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                <tr>
                    <td width="60" valign="top" style="padding-right: 14px;">
                        <img src="${logo}" alt="${company}" width="48" height="48" style="display: block; border-radius: 10px; width: 48px; height: 48px;" />
                    </td>
                    <td valign="top">
                        <a href="${jobUrl}" style="font-size: 15px; font-weight: 700; color: #111827; text-decoration: none; line-height: 1.35; letter-spacing: -0.1px;">${title}</a>
                        ${workplacePill ? `<div style="margin-top: 8px;">${workplacePill}</div>` : ''}
                        <div style="font-size: 13px; color: #4b5563; margin-top: 7px; line-height: 1.5;">
                            <span style="font-weight: 600; color: #1f2937;">${company}</span>
                            <span style="color: #9ca3af;"> · </span>
                            <span style="font-weight: 500; color: #374151;">${location}</span>
                        </div>
                        ${salaryLine}
                        ${metaLine}
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>`;
}
