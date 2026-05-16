import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { isGermanyString, normalizeWorkplaceType, normalizeEmploymentType } from '../core/Locationprefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';

// ─── Seniority mapping (Personio → your ExperienceLevel taxonomy) ─────────
const SENIORITY_MAP = {
    'student':       'Entry',
    'entry-level':   'Entry',
    'experienced':   'Mid',
    'lead':          'Senior',
    'senior':        'Senior',
    'manager':       'Senior',
    'director':      'Director',
    'executive':     'Executive',
};

// ─── Schedule mapping ─────────────────────────────────────────────────────
const SCHEDULE_MAP = {
    'full-time': 'FullTime',
    'part-time': 'PartTime',
};

// ─── XML parser config ────────────────────────────────────────────────────
// Personio quirk: a feed with 1 job returns <position> as object, multi-job
// returns an array. Same for jobDescription. Force these to always be arrays.
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,    // keep numbers as strings, we coerce later
    trimValues: true,
    isArray: (name) => ['position', 'jobDescription'].includes(name),
});

// ─── Description assembly ────────────────────────────────────────────────
// Personio splits descriptions into named sections (Intro / Your tasks /
// Your profile / Benefits). We concatenate them with section headers
// preserved so the AI analyzer + frontend get the full context.
function assembleDescription(jobDescriptionsBlock, asHtml) {
    const sections = jobDescriptionsBlock?.jobDescription || [];
    if (!Array.isArray(sections) || sections.length === 0) return '';

    if (asHtml) {
        return sections
            .map(s => `<h3>${s.name || ''}</h3>${s.value || ''}`)
            .join('\n');
    }
    return sections
        .map(s => `${s.name || ''}\n${StripHtml(s.value || '')}`)
        .join('\n\n');
}

export const personioConfig = {
    siteName: "Personio Jobs",
    baseUrl: null, // not used — each company has its own subdomain

    // Each entry: { subdomain, tld } — tld is 'de' or 'com' depending on
    // the customer. Verify the live URL before adding here.
    // Format: https://{subdomain}.jobs.personio.{tld}/xml?language=en

companyTargets: [
    { subdomain: 'workidentity',         tld: 'de' },
    { subdomain: 'agile-robots-se',      tld: 'de' },
    { subdomain: 'miles-mobility',       tld: 'de' },
    { subdomain: 'peter-park',           tld: 'de' },
    { subdomain: 'trg',                  tld: 'de' },
    { subdomain: 'unternehmertum',       tld: 'de' },
    { subdomain: 'impower',              tld: 'de' },
    { subdomain: 'carbmee',              tld: 'com' },
    { subdomain: 'yoummday-gmbh',        tld: 'de' },
    { subdomain: 'aiya-europe',          tld: 'de' },
    { subdomain: 'data4life',            tld: 'de' },
    { subdomain: 'zdf-digital',          tld: 'de' },
    { subdomain: 'pitch',                tld: 'de' },
    { subdomain: 'altagramgroup',        tld: 'de' },
    { subdomain: 'bliq',                 tld: 'de' },
    { subdomain: 'anton',                tld: 'com' },
    { subdomain: 'kemmler-kemmler-gmbh', tld: 'de' },
    { subdomain: 'zipmend',              tld: 'de' },
    { subdomain: 'certivity',            tld: 'de' },
    { subdomain: 'everience',            tld: 'de' },
    { subdomain: 'studysmarter',         tld: 'de' },
    { subdomain: 'tech11',               tld: 'de' },
    { subdomain: 'pm-team',              tld: 'de' },
    { subdomain: 'ht-ventures-gmbh',     tld: 'de' },
    { subdomain: 'epages-gmbh',          tld: 'de' },
    { subdomain: 'hafencity-hamburg',    tld: 'de' },
    { subdomain: 'azeti',                tld: 'de' },
    { subdomain: 'berlin-bytes',         tld: 'de' },
    { subdomain: 'socialhub',            tld: 'de' },
    { subdomain: 'aignostics',           tld: 'de' },
    { subdomain: 'robco',                tld: 'de' },
],

    // Internal state
    _allJobsQueue: [],
    _initialized: false,

    // ─── Initialize: fetch all XML feeds upfront ──────────────────────────
    async initialize() {
        if (this._initialized) return;

        console.log(`[Personio] Fetching jobs from ${this.companyTargets.length} companies...`);

        let successCount = 0;
        let failCount = 0;

        for (const target of this.companyTargets) {
            const { subdomain, tld } = target;
            const url = `https://${subdomain}.jobs.personio.${tld}/xml?language=en`;

            try {
                const response = await fetch(url, {
                    headers: { 'Accept': 'application/xml,text/xml' },
                });

                if (!response.ok) {
                    failCount++;
                    console.log(`[Personio] ❌ ${subdomain}: HTTP ${response.status}`);
                    continue;
                }

                const xmlText = await response.text();
                const parsed = xmlParser.parse(xmlText);
                const positions = parsed?.['workzag-jobs']?.position || [];

                if (positions.length === 0) {
                    continue;
                }

                // Filter to Germany jobs only — checks office + additionalOffices
                const germanyJobs = positions
                    .filter(job => this.isGermanyJob(job))
                    .map(job => ({
                        ...job,
                        _subdomain: subdomain,
                        _tld: tld,
                    }));

                if (germanyJobs.length > 0) {
                    console.log(`[Personio] ✅ ${subdomain}: ${germanyJobs.length} jobs in Germany (${positions.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    successCount++;
                }

                // Be polite — 500ms between companies
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failCount++;
                console.error(`[Personio] ❌ ${subdomain}: ${error.message}`);
            }
        }

        console.log(`[Personio] 📊 Summary: ${successCount} companies with Germany jobs, ${failCount} failed`);
        console.log(`[Personio] 💼 Total jobs found: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    // ─── Required by scraperEngine ────────────────────────────────────────
    async fetchPage(offset, limit) {
        if (!this._initialized) await this.initialize();
        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    getJobs(data) { return data.jobs || []; },
    getTotal(data) { return data.total || 0; },

    // ─── Germany detection ────────────────────────────────────────────────
    // Checks primary office + every additionalOffices entry.
    isGermanyJob(job) {
        const offices = this.collectAllOffices(job);
        return offices.some(loc => isGermanyString(loc));
    },

    isGermanyLocation(location) {
        return isGermanyString(location);
    },

    // ─── Helpers ──────────────────────────────────────────────────────────
    collectAllOffices(job) {
        const offices = [];
        if (job.office) offices.push(job.office);
        const extras = job.additionalOffices?.office;
        if (Array.isArray(extras)) {
            offices.push(...extras);
        } else if (typeof extras === 'string' && extras) {
            offices.push(extras);
        }
        return offices;
    },

    // ─── Field extractors ─────────────────────────────────────────────────
    extractJobID(job) {
        return `personio_${job._subdomain}_${job.id}`;
    },

    extractJobTitle(job) {
        return job.name || '';
    },

    extractCompany(job) {
        // Prefer subcompany if present (the legal entity Personio shows)
        if (job.subcompany) return job.subcompany;
        // Fallback: format the subdomain into a readable name
        return String(job._subdomain || '')
            .split(/[-_]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    },

    extractLocation(job) {
        return job.office || 'Germany';
    },

    extractAllLocations(job) {
        return normalizeArray(this.collectAllOffices(job));
    },

    extractCountry(job) {
        // Personio offices are city-only ("Berlin", not "Berlin, Germany").
        // Use isGermanyString helper which knows German city names.
        const offices = this.collectAllOffices(job);
        if (offices.some(loc => isGermanyString(loc))) return 'DE';
        return null;
    },

    extractDescription(job) {
        return assembleDescription(job.jobDescriptions, false);
    },

    extractDescriptionHtml(job) {
        return SanitizeHtml(assembleDescription(job.jobDescriptions, true));
    },

    extractURL(job) {
        // Personio doesn't ship a direct URL in the feed. Construct it from
        // {subdomain}.jobs.personio.{tld}/job/{id}?language=en.
        return `https://${job._subdomain}.jobs.personio.${job._tld}/job/${job.id}?language=en`;
    },

    extractDirectApplyURL(job) {
        // Same URL — Personio's job page IS the apply page (in-page form).
        return `https://${job._subdomain}.jobs.personio.${job._tld}/job/${job.id}?language=en`;
    },

    extractPostedDate(job) {
        return job.createdAt || null;
    },

    extractDepartment(job) {
        return job.department || job.recruitingCategory || 'N/A';
    },

    extractTeam(job) {
        return job.department || null;
    },

    extractOffice(job) {
        return job.office || null;
    },

    extractEmploymentType(job) {
        return normalizeEmploymentType(job.employmentType);
    },

    extractContractType(job) {
        const sched = String(job.schedule || '').toLowerCase();
        return SCHEDULE_MAP[sched] || job.schedule || null;
    },

    extractWorkplaceType(job) {
        // Office string sometimes contains "Remote Berlin" — infer from there.
        const offices = this.collectAllOffices(job).join(' ').toLowerCase();
        if (offices.includes('remote')) return 'Remote';
        if (offices.includes('hybrid')) return 'Hybrid';
        return normalizeWorkplaceType('Unspecified');
    },

    extractIsRemote(job) {
        const offices = this.collectAllOffices(job).join(' ').toLowerCase();
        return offices.includes('remote');
    },

    extractExperienceLevel(job) {
        const sen = String(job.seniority || '').toLowerCase();
        return SENIORITY_MAP[sen] || 'N/A';
    },

    extractTags(job) {
        if (!job.keywords) return [];
        return normalizeArray(
            String(job.keywords).split(',').map(t => t.trim()).filter(Boolean)
        );
    },

    // ─── Salary (Personio gives this directly, no text parsing needed!) ──
    extractSalaryMin(job) {
        const raw = job.salaryInformation?.min;
        const num = Number(raw);
        return Number.isFinite(num) && num > 0 ? num : null;
    },

    extractSalaryMax(job) {
        const raw = job.salaryInformation?.max;
        const num = Number(raw);
        return Number.isFinite(num) && num > 0 ? num : null;
    },

    extractSalaryCurrency(job) {
        return job.salaryInformation?.currencyCode || null;
    },

    extractSalaryInterval(job) {
        const type = String(job.salaryInformation?.type || '').toLowerCase();
        if (type === 'yearly')  return 'per-year-salary';
        if (type === 'monthly') return 'per-month-salary';
        if (type === 'hourly')  return 'per-hour-wage';
        return null;
    },

    // ─── Personio-specific extras (NEW fields on the job document) ────────
    extractYearsOfExperience(job) {
        return job.yearsOfExperience || null;
    },

    extractOccupation(job) {
        return job.occupation || null;
    },

    extractOccupationCategory(job) {
        return job.occupationCategory || null;
    },

    extractRecruitingCategory(job) {
        return job.recruitingCategory || null;
    },

    extractATSPlatform() {
        return 'personio';
    },
};