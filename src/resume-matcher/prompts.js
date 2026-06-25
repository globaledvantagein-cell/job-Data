// ─── Resume Matcher — Prompt Templates ─────────────────────────────────────────
//
// All prompt strings and user-message builders live here so the wording stays in
// one place. Named exports only; functions are verb-first (get…/build…).

/**
 * Prompt for parsing a resume (PDF or pasted text) into a structured profile.
 */
export function getResumeParsePrompt() {
    return `You are a resume parser for a job matching system focused on English-speaking jobs in Germany. Extract the following structured information from this resume.
Return ONLY valid JSON, no markdown fences, no preamble.
{
  "name": "Full name",
  "current_role": "Most recent job title or null",
  "experience_years": number or null,
  "level": "Entry | Mid | Senior | Lead | Executive",
  "domain": "Engineering | Marketing | Sales | Finance | HR | Design | Operations | Data | Product | Legal | Other",
  "skills": ["list", "of", "technical", "and", "professional", "skills"],
  "languages": [
    { "language": "English", "proficiency": "native | fluent | professional | conversational | basic" }
  ],
  "location": "Current city/country or null",
  "open_to_remote": true | false | null,
  "education": "Highest degree and field or null",
  "certifications": [],
  "industries": [],
  "summary": "2-3 sentence professional summary"
}
RULES:
- Infer skills from experience descriptions, not just skills sections. "Built CI/CD pipelines on AWS" implies CI/CD, AWS.
- For experience_years: calculate from earliest job start to present. Do not double-count overlapping roles.
- For level: 0-2 years or junior titles = Entry. 2-5 years = Mid. 5-10 years = Senior. 10+ years or director/VP = Lead/Executive.
- For languages: if no German mentioned, set German proficiency to "none". Map A1/A2 to "basic", B1/B2 to "conversational", C1/C2 to "fluent".
- Handle German Lebenslauf format and bilingual resumes.
- Use null for missing info, empty arrays for no items found.`;
}

/**
 * System prompt for Pass A — coarse batch scoring.
 */
export function getPassASystemPrompt() {
    return `You are a job matching system for English-speaking roles in Germany. Score how well each job matches the candidate profile. Return ONLY a valid JSON array.
SCORING RULES:
- 85-100: Strong match. Core skills align, experience level fits.
- 65-84: Good match. Most skills align, minor gaps.
- 50-64: Partial match. Some overlap but significant gaps.
- 30-49: Weak match. Few matching criteria.
- 0-29: Poor match. Almost no alignment.
- Overqualified is NEGATIVE. A 15-year VP applying to a junior role scores 30-40.
- Skills equivalence counts: React = React.js = ReactJS, AWS = Amazon Web Services.

Return format:
[{ "index": 0, "jobId": "<_id>", "score": 85, "reason": "one line reason" }, ...]`;
}

/**
 * System prompt for Pass B — deep analysis of the shortlisted jobs.
 */
export function getPassBSystemPrompt() {
    return `You are a job matching system for English-speaking roles in Germany. Provide detailed match analysis for each job. Return ONLY a valid JSON array.
For each job return:
{
  "index": 0,
  "jobId": "<_id>",
  "score": 92,
  "matched_skills": ["React", "TypeScript", "AWS"],
  "missing_skills": ["Kubernetes"],
  "bonus_skills": ["Docker"],
  "experience_fit": "strong | good | weak | overqualified",
  "location_fit": "exact | same_country | remote_compatible | relocation_needed",
  "reasoning": "2-3 sentences explaining the match."
}
RULES:
- Read the full job description carefully.
- matched_skills: candidate skills that the job requires.
- missing_skills: job requirements the candidate lacks.
- bonus_skills: candidate skills not required but valuable.
- "German nice to have" is different from "German required". Score accordingly.
- Be specific in reasoning about which skills match and which are missing.`;
}

/**
 * Formats a job's parsedRequirements into a compact one-line string for Pass A.
 */
function formatRequirements(parsedRequirements) {
    const skills = Array.isArray(parsedRequirements.required_skills)
        ? parsedRequirements.required_skills.join(', ')
        : '';
    const years = parsedRequirements.min_experience_years || 'N/A';
    const education = parsedRequirements.required_education || 'N/A';
    return `Skills: ${skills} | Experience: ${years} years | Education: ${education}`;
}

/**
 * Returns the first `wordCount` words of a (possibly long) description.
 */
function truncateWords(text, wordCount) {
    if (!text) return '';
    return String(text).split(/\s+/).slice(0, wordCount).join(' ');
}

/**
 * Builds the Pass A user message: candidate profile + a compact list of jobs.
 *
 * @param {object} profile
 * @param {Array<object>} jobs - this batch's jobs
 * @returns {string}
 */
export function buildPassAUserMessage(profile, jobs) {
    let message = `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}`;
    message += `\n\nJOBS TO SCORE:\n`;

    jobs.forEach((job, index) => {
        const requirements = job.parsedRequirements
            ? formatRequirements(job.parsedRequirements)
            : truncateWords(job.Description, 200);

        message += `[${index}] ${job.JobTitle} at ${job.Company}\n`;
        message += `Location: ${job.Location} | Remote: ${job.IsRemote} | German: ${job.GermanRequired ? 'Required' : 'Not required'}\n`;
        message += `Category: ${job.Category} | Level: ${job.ExperienceLevel}\n`;
        message += `Requirements: ${job.parsedRequirements ? requirements : `Not available. Description: ${requirements}`}\n`;
    });

    return message;
}

/**
 * Builds the Pass B user message: candidate profile + full job descriptions.
 *
 * @param {object} profile
 * @param {Array<object>} jobs - the shortlisted jobs
 * @returns {string}
 */
export function buildPassBUserMessage(profile, jobs) {
    let message = `CANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}`;
    message += `\n\nJOBS TO ANALYZE:\n`;

    jobs.forEach((job, index) => {
        message += `\n[${index}] jobId: ${job._id}\n`;
        message += `Title: ${job.JobTitle}\n`;
        message += `Company: ${job.Company}\n`;
        message += `Location: ${job.Location} | Remote: ${job.IsRemote} | German: ${job.GermanRequired ? 'Required' : 'Not required'}\n`;
        message += `Category: ${job.Category} | Level: ${job.ExperienceLevel} | EmploymentType: ${job.EmploymentType}\n`;
        if (job.parsedRequirements) {
            message += `Structured requirements: ${formatRequirements(job.parsedRequirements)}\n`;
        }
        message += `Full Description:\n${job.Description || 'N/A'}\n`;
    });

    return message;
}
