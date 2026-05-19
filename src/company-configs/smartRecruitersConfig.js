import fetch from 'node-fetch';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { isGermanyString, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';

// ─── SmartRecruiters experienceLevel → your taxonomy ──────────────────────
const EXPERIENCE_MAP = {
    'internship':       'Entry',
    'entry level':      'Entry',
    'associate':        'Entry',
    'mid-senior level': 'Mid',
    'director':         'Director',
    'executive':        'Executive',
    'not applicable':   'N/A',
};

// ─── SmartRecruiters typeOfEmployment → your taxonomy ─────────────────────
const EMPLOYMENT_MAP = {
    'full-time': 'FullTime',
    'part-time': 'PartTime',
    'intern':    'Internship',
    'contract':  'Contract',
    'temporary': 'Contract',
};

// ─── Description assembly ────────────────────────────────────────────────
// SmartRecruiters splits descriptions into 4 named sections:
//   companyDescription, jobDescription, qualifications, additionalInformation
// We concatenate them with section headers preserved.
function assembleDescription(sections, asHtml) {
    if (!sections || typeof sections !== 'object') return '';
    const order = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'];
    const parts = [];
    for (const key of order) {
        const section = sections[key];
        if (!section || !section.text) continue;
        const title = section.title || key;
        if (asHtml) {
            parts.push(`<h3>${title}</h3>${section.text}`);
        } else {
            parts.push(`${title}\n${StripHtml(section.text)}`);
        }
    }
    return parts.join(asHtml ? '\n' : '\n\n');
}

export const smartRecruitersConfig = {
    siteName: "SmartRecruiters Jobs",
    baseUrl: "https://api.smartrecruiters.com/v1/companies",

    // ─── Server-side filters ──────────────────────────────────────────────
    // country=de filters to Germany at the API level — much cheaper than
    // doing it client-side. Setting this to false would scrape every job.
    filterCountry: 'de',

    // language=en gates out German-language postings before they hit our
    // pipeline. Saves Gemini calls and pre-rejection cycles. Set to null
    // to disable if you want to catch bilingual jobs the company mis-tagged.
    filterLanguageEn: true,

    // Per-page size (SmartRecruiters caps at 100)
    pageSize: 100,

    // Polite delay between requests (ms). SmartRecruiters allows 10 req/sec
    // but we go gentler to be a good citizen.
    requestDelayMs: 250,

    // ─── Company identifiers ──────────────────────────────────────────────
    // Verified live (May 2026). Format: identifier string only (no TLD).
    // Feed URL: https://api.smartrecruiters.com/v1/companies/{id}/postings
    // To find a new one: visit careers.smartrecruiters.com/{id} in a
    // browser — should show their jobs page.
    companyIdentifiers: [
        // ─── BIG ENTERPRISE (50+ English Germany jobs each) ─────────────
        'BoschGroup',          // ~107 EN-DE jobs (out of 919 total DE)
        'aboutyougmbh',        // ~75  EN-DE jobs (Hamburg fashion)
        'ScalableGmbH',        // ~74  EN-DE jobs (Berlin fintech)
        'SIXT',                // ~50+ EN-DE jobs (Munich car rental)
        'alten',               // ~50+ EN-DE jobs (engineering)

        // ─── MID-SIZE (10–50 jobs each) ─────────────────────────────────
        'Flink3',              // Berlin grocery delivery
        'StepStoneGroup',      // Düsseldorf job board (their own jobs!)
        'ServiceNow',          // Some Germany roles
        'ifs1',                // Enterprise software
        'AltagramGmbH',        // Berlin gaming localization

        // ─── ADDITIONAL CANDIDATES (low-volume but worth keeping) ───────
        'Endava',              // Few Germany roles in DACH
        'ecovadis',            // Berlin office
        'Bosch-HomeComfort',   // Bosch subsidiary
        'Meta1',                // Some Berlin roles
        'smartrecruiters',     // SR's own (Berlin office)

        // ─── Add more here as you find them ─────────────────────────────
        // To verify: hit
        //   https://api.smartrecruiters.com/v1/companies/{ID}/postings?country=de&limit=1
        // If totalFound > 0 and HTTP 200, add it.
    ],

    // Internal state
    _allJobsQueue: [],
    _initialized: false,

    // ─── Initialize: fetch all companies upfront ─────────────────────────
    // Strategy: paginated list call → for each job, fetch detail to get
    // description + applyUrl. This is the same list-then-detail pattern
    // as the Workday scraper.
    async initialize() {
        if (this._initialized) return;

        console.log(`[SmartRecruiters] Fetching jobs from ${this.companyIdentifiers.length} companies...`);

        let totalListed = 0;
        let totalEnriched = 0;
        let failedCompanies = 0;

        for (const companyId of this.companyIdentifiers) {
            try {
                // ── Step 1: paginate through list endpoint ──
                const listedJobs = await this.fetchAllListedJobs(companyId);
                totalListed += listedJobs.length;

                if (listedJobs.length === 0) {
                    console.log(`[SmartRecruiters] ⚠️  ${companyId}: 0 jobs matched filters`);
                    continue;
                }

                // ── Step 2: enrich each with detail (description + apply URL) ──
                const enriched = await this.enrichJobsWithDetails(companyId, listedJobs);
                totalEnriched += enriched.length;
                this._allJobsQueue.push(...enriched);

                console.log(`[SmartRecruiters] ✅ ${companyId}: ${enriched.length}/${listedJobs.length} jobs enriched`);

            } catch (error) {
                failedCompanies++;
                console.error(`[SmartRecruiters] ❌ ${companyId}: ${error.message}`);
            }
        }

        console.log(`[SmartRecruiters] 📊 Summary: ${totalEnriched} jobs enriched (${totalListed} listed, ${failedCompanies} companies failed)`);
        console.log(`[SmartRecruiters] 💼 Total in queue: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    // ─── Helper: paginate through all listed jobs for a company ──────────
    async fetchAllListedJobs(companyId) {
        const all = [];
        let offset = 0;
        const maxPages = 30; // safety cap → at 100/page = 3000 jobs max per company

        for (let page = 0; page < maxPages; page++) {
            const params = new URLSearchParams({
                limit: String(this.pageSize),
                offset: String(offset),
            });
            if (this.filterCountry) params.set('country', this.filterCountry);
            if (this.filterLanguageEn) params.set('language', 'en');

            const url = `${this.baseUrl}/${encodeURIComponent(companyId)}/postings?${params}`;
            const response = await fetch(url, { headers: { 'Accept': 'application/json' } });

            if (!response.ok) {
                throw new Error(`list HTTP ${response.status}`);
            }
            const data = await response.json();
            const batch = data.content || [];
            all.push(...batch);

            // Done when we've fetched everything
            if (batch.length < this.pageSize) break;
            offset += this.pageSize;
            await this.sleep(this.requestDelayMs);
        }
        return all;
    },

    // ─── Helper: enrich list jobs with detail data ───────────────────────
    async enrichJobsWithDetails(companyId, listedJobs) {
        const enriched = [];
        for (const listJob of listedJobs) {
            try {
                const url = `${this.baseUrl}/${encodeURIComponent(companyId)}/postings/${listJob.id}`;
                const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (!response.ok) {
                    // Don't fail the whole company on one bad job
                    console.warn(`[SmartRecruiters] ⚠️  Detail fetch failed for ${companyId}/${listJob.id}: HTTP ${response.status}`);
                    continue;
                }
                const detail = await response.json();
                enriched.push({
                    ...listJob,
                    _detail: detail,
                    _companyId: companyId,
                });
                await this.sleep(this.requestDelayMs);
            } catch (error) {
                console.warn(`[SmartRecruiters] ⚠️  Detail fetch error for ${companyId}/${listJob.id}: ${error.message}`);
            }
        }
        return enriched;
    },

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // ─── Required by scraperEngine ────────────────────────────────────────
    async fetchPage(offset, limit) {
        if (!this._initialized) await this.initialize();
        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    getJobs(data) { return data.jobs || []; },
    getTotal(data) { return data.total || 0; },

    isGermanyLocation(location) {
        return isGermanyString(location);
    },

    // ─── Field extractors ─────────────────────────────────────────────────
    extractJobID(job) {
        return `sr_${job._companyId}_${job.id}`;
    },

    extractJobTitle(job) {
        return job.name || '';
    },

    extractCompany(job) {
        // Prefer the company name as SmartRecruiters reports it; fall back
        // to the identifier with title-case formatting.
        const companyObj = job.company || job._detail?.company;
        if (companyObj?.name) return companyObj.name;
        return String(job._companyId || '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(/[-_]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    },

    extractLocation(job) {
        const loc = job.location || {};
        return loc.fullLocation || [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(', ') || 'Germany';
    },

    extractAllLocations(job) {
        // SmartRecruiters returns a single location per posting (no array).
        const loc = this.extractLocation(job);
        return normalizeArray([loc]);
    },

    extractCountry(job) {
        const code = job.location?.country;
        if (!code) return null;
        return String(code).toUpperCase();
    },

    extractDescription(job) {
        const sections = job._detail?.jobAd?.sections;
        return assembleDescription(sections, false);
    },

    extractDescriptionHtml(job) {
        const sections = job._detail?.jobAd?.sections;
        return SanitizeHtml(assembleDescription(sections, true));
    },

    extractURL(job) {
        return job._detail?.postingUrl || job._detail?.applyUrl || null;
    },

    extractDirectApplyURL(job) {
        return job._detail?.applyUrl || null;
    },

    extractPostedDate(job) {
        return job.releasedDate || job._detail?.releasedDate || null;
    },

    extractDepartment(job) {
        return job.department?.label || job.function?.label || 'N/A';
    },

    extractTeam(job) {
        return job.department?.label || null;
    },

    extractOffice(job) {
        return job.location?.city || null;
    },

    extractEmploymentType(job) {
        const label = String(job.typeOfEmployment?.label || '').toLowerCase();
        return EMPLOYMENT_MAP[label] || normalizeEmploymentType(job.typeOfEmployment?.label);
    },

    extractContractType(job) {
        // Same field, different angle. EmploymentType handles it.
        return job.typeOfEmployment?.label || null;
    },

    extractWorkplaceType(job) {
        const loc = job.location || {};
        if (loc.remote === true) return 'Remote';
        if (loc.hybrid === true) return 'Hybrid';
        return 'Unspecified';
    },

    extractIsRemote(job) {
        return job.location?.remote === true;
    },

    extractExperienceLevel(job) {
        const label = String(job.experienceLevel?.label || '').toLowerCase();
        return EXPERIENCE_MAP[label] || 'N/A';
    },

    extractTags(job) {
        // SmartRecruiters has rich taxonomy fields we can promote to tags
        const tags = [];
        if (job.industry?.label)        tags.push(job.industry.label);
        if (job.function?.label)        tags.push(job.function.label);
        if (job.department?.label)      tags.push(job.department.label);
        if (job.typeOfEmployment?.label) tags.push(job.typeOfEmployment.label);
        return normalizeArray(tags);
    },

    // ─── Salary — SmartRecruiters doesn't expose salary in public posts ──
    // (it's only in their authenticated Customer API). Returns nulls; if
    // the description has salary info the AI analyzer will surface it.
    extractSalaryMin()      { return null; },
    extractSalaryMax()      { return null; },
    extractSalaryCurrency() { return null; },
    extractSalaryInterval() { return null; },

    // ─── SmartRecruiters-specific extras (NEW optional fields) ───────────
    extractIndustry(job) {
        return job.industry?.label || null;
    },

    extractFunction(job) {
        return job.function?.label || null;
    },

    extractLanguageCode(job) {
        return job.language?.code || null;
    },

    extractATSPlatform() {
        return 'smartrecruiters';
    },
};


export default smartRecruitersConfig;
