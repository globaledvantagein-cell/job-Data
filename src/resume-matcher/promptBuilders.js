// ─── Resume Matcher — Prompt Message Builders ─────────────────────────────────
//
// Builds the user messages for Pass A (coarse) and Pass B (deep) scoring.
// Separated from prompts.js to keep both files under 200 lines.

/**
 * Formats a job's parsedRequirements into a compact multi-line string for Pass A.
 * Handles both new schema (categorized skills) and legacy (flat strings).
 */
function formatRequirements(pr) {
    const formatSkills = (skills) => {
        if (!Array.isArray(skills) || skills.length === 0) return 'None';
        return skills.map(s => typeof s === 'object' ? `${s.name} (${s.category || 'Other'})` : s).join(', ');
    };

    const lines = [
        `Required: ${formatSkills(pr.required_skills)}`,
        `Preferred: ${formatSkills(pr.preferred_skills)}`,
    ];

    if (pr.tools_and_platforms?.length) lines.push(`Tools: ${pr.tools_and_platforms.join(', ')}`);

    const exp = pr.min_experience_years
        ? (pr.max_experience_years ? `${pr.min_experience_years}-${pr.max_experience_years}` : `${pr.min_experience_years}+`)
        : 'N/A';
    lines.push(`Experience: ${exp} years | Education: ${pr.required_education || 'N/A'}`);

    if (pr.german_level_detail && pr.german_level_detail !== 'not mentioned') {
        lines.push(`German: ${pr.german_level_detail}`);
    }
    if (pr.visa_sponsorship && pr.visa_sponsorship !== 'not_mentioned') {
        lines.push(`Visa sponsorship: ${pr.visa_sponsorship}`);
    }
    if (pr.remote_policy_detail && pr.remote_policy_detail !== 'not_mentioned') {
        lines.push(`Remote: ${pr.remote_policy_detail}`);
    }

    return lines.join(' | ');
}

/**
 * Returns the first N words of text.
 */
function truncateWords(text, wordCount) {
    if (!text) return '';
    return String(text).split(/\s+/).slice(0, wordCount).join(' ');
}

/**
 * Builds the Pass A user message: candidate profile + compact job summaries.
 */
export function buildPassAUserMessage(profile, jobs) {
    let message = `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}`;

    // Append job preferences if user has set them
    if (profile._jobPreferences) {
        const jp = profile._jobPreferences;
        const parts = [];
        if (jp.salary_min || jp.salary_max) parts.push(`Salary: €${jp.salary_min || '?'}–${jp.salary_max || '?'}/yr`);
        if (jp.preferred_work_style) parts.push(`Work style: ${jp.preferred_work_style}`);
        if (jp.notice_period) parts.push(`Notice: ${jp.notice_period}`);
        if (jp.available_from) parts.push(`Available: ${jp.available_from}`);
        if (jp.visa_status) parts.push(`Visa: ${jp.visa_status}`);
        if (parts.length > 0) message += `\n\nCANDIDATE PREFERENCES:\n${parts.join(' | ')}`;
    }

    message += `\n\nJOBS TO SCORE:\n`;

    jobs.forEach((job, index) => {
        message += `\n[${index}] ${job.JobTitle} at ${job.Company}\n`;
        message += `Location: ${job.Location} | Remote: ${job.IsRemote}`;
        message += ` | German: ${job.GermanRequired ? 'Required' : 'Not required'}\n`;
        message += `Category: ${job.Category} | Level: ${job.ExperienceLevel || 'N/A'}\n`;

        if (job.parsedRequirements) {
            message += `${formatRequirements(job.parsedRequirements)}\n`;
        } else {
            message += `Description: ${truncateWords(job.Description, 200)}\n`;
        }
    });

    return message;
}

/**
 * Builds the Pass B user message: candidate profile + full job details.
 */
export function buildPassBUserMessage(profile, jobs) {
    let message = `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}`;

    if (profile._jobPreferences) {
        const jp = profile._jobPreferences;
        const parts = [];
        if (jp.salary_min || jp.salary_max) parts.push(`Salary: €${jp.salary_min || '?'}–${jp.salary_max || '?'}/yr`);
        if (jp.preferred_work_style) parts.push(`Work style: ${jp.preferred_work_style}`);
        if (jp.notice_period) parts.push(`Notice: ${jp.notice_period}`);
        if (jp.available_from) parts.push(`Available: ${jp.available_from}`);
        if (jp.visa_status) parts.push(`Visa: ${jp.visa_status}`);
        if (parts.length > 0) message += `\n\nCANDIDATE PREFERENCES:\n${parts.join(' | ')}`;
    }

    message += `\n\nJOBS TO ANALYZE:\n`;

    jobs.forEach((job, index) => {
        message += `\n[${index}] jobId: ${job._id}\n`;
        message += `Title: ${job.JobTitle} | Company: ${job.Company}\n`;
        message += `Location: ${job.Location} | Remote: ${job.IsRemote}`;
        message += ` | German: ${job.GermanRequired ? 'Required' : 'Not required'}\n`;
        message += `Category: ${job.Category} | Level: ${job.ExperienceLevel || 'N/A'}`;
        message += ` | Type: ${job.EmploymentType || 'N/A'}\n`;

        if (job.parsedRequirements) {
            const pr = job.parsedRequirements;
            message += `Structured requirements:\n${formatRequirements(pr)}\n`;
            if (pr.team_context) message += `Team: ${pr.team_context}\n`;
            if (pr.relocation_support !== 'not_mentioned') {
                message += `Relocation: ${pr.relocation_support}\n`;
            }
        }

        message += `Full Description:\n${job.Description || 'N/A'}\n`;
    });

    return message;
}