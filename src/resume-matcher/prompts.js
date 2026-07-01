// ─── Resume Matcher — Prompt Templates ─────────────────────────────────────────
//
// Prompt strings for resume parsing and job scoring. Message builders are in
// promptBuilders.js to keep both files under 200 lines.

/**
 * Prompt for parsing a resume into a rich structured profile.
 */
export function getResumeParsePrompt() {
    return `You are a resume parser for a job matching system focused on English-speaking jobs in Germany.

Return ONLY valid JSON, no markdown fences, no preamble.

{
  "name": "Full name",
  "email": "email or null",
  "phone": "phone or null",
  "linkedin_url": "LinkedIn URL or null",
  "summary": "2-3 sentence professional summary",
  "experience": [
    {
      "company": "Company name",
      "title": "Job title",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM or Present",
      "isCurrent": true/false,
      "responsibilities": ["key achievement or duty"],
      "technologies": ["tech used in this role"]
    }
  ],
  "education": [
    {
      "institution": "University name",
      "degree": "BSc / MSc / PhD / B.Tech etc",
      "field": "Field of study",
      "endDate": "YYYY-MM or null"
    }
  ],
  "skills": [
    { "name": "React", "category": "Language | Framework | Database | Cloud | DevOps | Tool | Domain | Other" }
  ],
  "projects": [
    {
      "name": "Project name",
      "description": "One-line description",
      "technologies": ["tech used"]
    }
  ],
  "total_experience_years": <number>,
  "seniority_level": "Entry | Mid | Senior | Lead | Executive",
  "domain": "Software Engineering | Marketing | Sales | Finance | HR | Design | Operations | Data | Product | Legal | Other",
  "sub_domain": "Full Stack | Frontend | Backend | DevOps | Mobile | Data Science | etc or null",
  "languages": [
    { "language": "English", "proficiency": "native | fluent | professional | conversational | basic | none" }
  ],
  "location": "Current city/country or null",
  "open_to_remote": true | false | null,
  "open_to_relocate": true | false | null,
  "visa_required": true | false | null,
  "certifications": ["cert name"]
}

RULES:
- Skill categories: Language (JS, Python, Java, TypeScript), Framework (React, Django, Express, Spring), Database (PostgreSQL, MongoDB, MySQL), Cloud (AWS, GCP, Azure), DevOps (Docker, Kubernetes, CI/CD, Terraform), Tool (Git, VS Code, Jira), Domain (ML, NLP, FinTech, AI), Other.
- Infer skills from experience descriptions. "Built CI/CD pipelines on AWS" = CI/CD (DevOps), AWS (Cloud).
- Experience: list EACH role separately with company, title, dates, responsibilities, technologies.
- total_experience_years: calculate from earliest job start to present. Don't double-count overlapping roles.
- seniority_level: 0-2 years or junior = Entry, 2-5 years = Mid, 5-10 years = Senior, 10+ or VP/Director = Lead/Executive.
- For languages: always include German. If not mentioned, set proficiency to "none". Map A1/A2 → basic, B1/B2 → conversational, C1/C2 → fluent.
- visa_required: true if candidate appears to be non-EU (based on location, nationality clues). null if unclear.
- open_to_relocate: infer from resume context. null if unclear.
- Projects: extract side projects, personal projects, academic projects separately from work experience.
- Handle German Lebenslauf format and bilingual resumes.
- Use null for missing info, empty arrays for no items found.`;
}

/**
 * System prompt for Pass A — coarse batch scoring.
 */
export function getPassASystemPrompt() {
    return `You are a job matching system for English-speaking roles in Germany. Score each job against the candidate. Return ONLY a valid JSON array.

SCORING RULES:
- 85-100: Strong match. Core skills align, experience level fits, no major gaps.
- 65-84: Good match. Most skills align, minor gaps or slight level mismatch.
- 50-64: Partial match. Some overlap but significant gaps.
- 30-49: Weak match. Few matching criteria.
- 0-29: Poor match. Almost no alignment.
- Overqualified is NEGATIVE. A 15-year VP for a junior role scores 30-40.
- Match skill categories: a Framework match (React↔React) > a Tool match (Git↔Git).
- Skills equivalence: React = React.js = ReactJS, AWS = Amazon Web Services.
- german_level_detail matters: "C1 required" with no-German candidate = strong penalty. "nice to have" = minor penalty.
- visa_sponsorship "available" + visa_required candidate = no penalty. "not_available" + visa_required = strong penalty.

Return: [{ "index": 0, "jobId": "<_id>", "score": 85, "reason": "one line" }, ...]`;
}

/**
 * System prompt for Pass B — deep analysis.
 */
export function getPassBSystemPrompt() {
    return `You are a job matching system for English-speaking roles in Germany. Provide detailed analysis. Return ONLY a valid JSON array.

For each job return:
{
  "index": 0, "jobId": "<_id>", "score": 92,
  "matched_skills": [{ "name": "React", "category": "Framework" }],
  "missing_skills": [{ "name": "Kubernetes", "category": "DevOps" }],
  "bonus_skills": [{ "name": "Docker", "category": "DevOps" }],
  "experience_fit": "strong | good | weak | overqualified",
  "location_fit": "exact | same_country | remote_compatible | relocation_needed",
  "german_fit": "meets_requirement | partial | not_met | not_required",
  "visa_fit": "sponsorship_available | not_needed | sponsorship_unavailable | unknown",
  "reasoning": "2-3 sentences. Be specific about which skills match, what's missing, and any visa/language concerns."
}

RULES:
- matched_skills: candidate skills the job requires (with category).
- missing_skills: job requirements the candidate lacks (with category).
- bonus_skills: candidate skills not required but add value (with category).
- german_fit: compare candidate's German proficiency against job's german_level_detail.
- visa_fit: compare candidate's visa_required against job's visa_sponsorship.
- Be specific in reasoning — name the skills, levels, and gaps.`;
}