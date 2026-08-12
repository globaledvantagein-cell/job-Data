import fetch from 'node-fetch';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { isGermanyString, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';
import { loadScrapeStates, saveScrapeStatesBulk, computeContentHash, stateKey } from '../core/scrapeState.js';

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
        // --- GERMAN EXPANSION 2026-08-04 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'check24',  // 87 DE / 100 total
        'redcare-pharmacy',  // 52 DE / 100 total
        'brainlab',  // 22 DE / 49 total
        'sevensenders',  // 16 DE / 16 total
        'rolandberger',  // 15 DE / 100 total
        'continental',  // 12 DE / 100 total
        'gerresheimer',  // 11 DE / 100 total
        'home24',  // 9 DE / 9 total
        'redcarepharmacy',  // 8 DE / 16 total
        'auto1',  // 7 DE / 100 total
        'deliveryhero',  // 5 DE / 100 total
        'manara',  // 4 DE / 8 total
        'beamery',  // 3 DE / 100 total
        'bundesdruckerei',  // 3 DE / 3 total
        'abbvie',  // 3 DE / 100 total
        'omio',  // 2 DE / 2 total
        'wundermobility',  // 2 DE / 2 total
        'freshworks',  // 2 DE / 100 total
        'nexthink',  // 1 DE / 91 total
        'tomra',  // 1 DE / 100 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'coolblue',  // 30 DE / 100 total
        'kombo',  // 7 DE / 100 total
        'yassir',  // 6 DE / 6 total
        'mirantis',  // 2 DE / 54 total
        'believe',  // 1 DE / 30 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'fella',  // 1 DE / 7 total
        'electry',  // 1 DE / 1 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'celia',  // 2 DE / 71 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'matterhorn',  // 2 DE / 10 total
        'ktronik',  // 1 DE / 1 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'motelone',  // 51 DE / 100 total
        'haufegroup',  // 42 DE / 43 total
        'devoteam',  // 26 DE / 100 total
        'swarco',  // 23 DE / 100 total
        'hubertburdamedia',  // 16 DE / 22 total
        'jysk',  // 9 DE / 100 total
        'wheregroup',  // 1 DE / 1 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'contilia1',  // 80 DE / 100 total
        'ebreuningergmbhco',  // 73 DE / 100 total
        'axelspringernewsmedianational',  // 72 DE / 74 total
        'dreessommerse',  // 71 DE / 100 total
        'firevanderrwthaachen',  // 70 DE / 70 total
        'atparchitekteningenieure',  // 47 DE / 100 total
        'artemedse',  // 39 DE / 100 total
        'afry',  // 36 DE / 100 total
        'doco1',  // 35 DE / 100 total
        'deutschepruefservicegmbh',  // 35 DE / 53 total
        'avaloq1',  // 30 DE / 100 total
        'enertrag',  // 29 DE / 100 total
        'deindentaledg',  // 28 DE / 72 total
        'bew',  // 27 DE / 27 total
        'acetate',  // 24 DE / 42 total
        'colliersinternationalemea',  // 23 DE / 100 total
        'lgcgroup',  // 22 DE / 100 total
        'avivgroup',  // 20 DE / 32 total
        'analysysmason1',  // 20 DE / 33 total
        'securitas',  // 15 DE / 100 total
        'krombacher',  // 14 DE / 57 total
        'europeanhomecaregmbh',  // 14 DE / 100 total
        'coface',  // 12 DE / 100 total
        'asburycommunities',  // 10 DE / 100 total
        'expeditors',  // 10 DE / 100 total
        'formelsconsulting',  // 10 DE / 10 total
        'brainnest',  // 10 DE / 10 total
        'heimstaden',  // 9 DE / 34 total
        'msxinternational',  // 9 DE / 100 total
        'rentokilinitial1',  // 8 DE / 100 total
        'metromakro',  // 8 DE / 100 total
        'ayming',  // 7 DE / 100 total
        'coliseefrance',  // 7 DE / 100 total
        'ib-vogt-gmbh',  // 7 DE / 35 total
        'vusiongroupsa',  // 7 DE / 71 total
        'audiinteractiongmbh',  // 7 DE / 7 total
        'beumergroup1',  // 7 DE / 100 total
        'baywaag',  // 6 DE / 100 total
        'medmix',  // 6 DE / 46 total
        'staubligroup',  // 6 DE / 100 total
        'wuestpartner',  // 6 DE / 12 total
        'aumovio',  // 6 DE / 100 total
        'deltaelectronics',  // 5 DE / 53 total
        'keenfinity',  // 5 DE / 73 total
        'waremarenkhoffse',  // 5 DE / 60 total
        'bitlane',  // 5 DE / 5 total
        'epro360',  // 5 DE / 5 total
        'jacklinksproteinsnacks',  // 4 DE / 100 total
        'sectigo',  // 4 DE / 43 total
        'hitachisolutions',  // 4 DE / 56 total
        'jacobsdouweegberts',  // 4 DE / 100 total
        'drreddyslaboratorieslimited',  // 4 DE / 81 total
        'lendigroup1',  // 3 DE / 100 total
        'trupanion1',  // 3 DE / 47 total
        'accorhotel',  // 3 DE / 100 total
        'umdaschgroup',  // 3 DE / 100 total
        'advens',  // 2 DE / 27 total
        'californiaclosets',  // 2 DE / 80 total
        'everience',  // 2 DE / 100 total
        'teamworkcorporate',  // 2 DE / 81 total
        'thenielsencompany',  // 2 DE / 100 total
        'linkedin3',  // 2 DE / 100 total
        'northroprealty',  // 2 DE / 7 total
        '2ntelekomunikaceas',  // 1 DE / 16 total
        'applusidiada1',  // 1 DE / 100 total
        'blend360',  // 1 DE / 100 total
        'cint',  // 1 DE / 37 total
        'easyvista',  // 1 DE / 11 total
        'enero',  // 1 DE / 20 total
        'hmgroup',  // 1 DE / 100 total
        'ikanoretail',  // 1 DE / 100 total
        'iomaxisllc',  // 1 DE / 12 total
        'locinox',  // 1 DE / 8 total
        'o-i',  // 1 DE / 100 total
        'streemenergy',  // 1 DE / 9 total
        'sosi1',  // 1 DE / 100 total
        'ubisoft2',  // 1 DE / 100 total
        'vonq',  // 1 DE / 5 total
        'accorcorpo',  // 1 DE / 100 total
        'antonpaar1',  // 1 DE / 100 total
        'aristanetworks',  // 1 DE / 100 total
        'assent',  // 1 DE / 26 total
        'apmgroup',  // 1 DE / 100 total
        'rrdonnelley',  // 1 DE / 100 total
        'thetileshop1',  // 1 DE / 100 total
        'worldwidetechservices',  // 1 DE / 100 total
        'beckersgroup',  // 1 DE / 16 total
        'crealogix',  // 1 DE / 4 total
        'courir',  // 1 DE / 100 total
        'nochmall',  // 1 DE / 1 total
        'robertbosch',  // 1 DE / 6 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'deutscheglasfaser',  // 31 DE / 72 total
        'schnelleckelogistics',  // 24 DE / 40 total
        'konecranes',  // 16 DE / 100 total
        'akpowerlogistics',  // 2 DE / 3 total
        'rzteversorgungniedersachsen',  // 2 DE / 2 total
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

        const stateMap = await loadScrapeStates('smartrecruiters');
        const pendingStates = [];
        let skippedCompanies = 0;

        for (const companyId of this.companyIdentifiers) {
            const result = await this._fetchCompany(companyId, stateMap);
            if (result === null) { failedCompanies++; continue; }
            pendingStates.push(result.state);
            if (result.unchanged) { skippedCompanies++; continue; }
            totalListed += result.listed;
            totalEnriched += result.jobs.length;
            if (result.jobs.length > 0) this._allJobsQueue.push(...result.jobs);
        }

        await saveScrapeStatesBulk('smartrecruiters', pendingStates);
        console.log(`[SmartRecruiters] 📊 Summary: ${totalEnriched} jobs enriched (${totalListed} listed, ${skippedCompanies} unchanged skipped, ${failedCompanies} companies failed)`);
        console.log(`[SmartRecruiters] 💼 Total in queue: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    // ─── Fetch + enrich one company; intermediates GC-eligible on return ──
    // The content hash is computed from the LIST results, BEFORE enrichment —
    // an unchanged company skips all of its per-job detail fetches, which is
    // where nearly all of this platform's request volume goes. (No ETag layer:
    // the list endpoint is paginated, so there is no single response to tag.)
    // Returns { unchanged, jobs, listed, state } or null on failure.
    async _fetchCompany(companyId, stateMap) {
        const prev = stateMap.get(stateKey('smartrecruiters', companyId));
        try {
            // ── Step 1: paginate through list endpoint ──
            const listedJobs = await this.fetchAllListedJobs(companyId);

            if (listedJobs.length === 0) {
                console.log(`[SmartRecruiters] ⚠️  ${companyId}: 0 jobs matched filters`);
                return {
                    unchanged: false, jobs: [], listed: 0,
                    state: { slug: companyId, etag: null, contentHash: computeContentHash([]), jobCount: 0, changed: !prev },
                };
            }

            // id|name|releasedDate fingerprint — descriptions live in the
            // detail endpoint and never affect the hash.
            const contentHash = computeContentHash(
                listedJobs.map(j => `${j.id}|${j.name || ''}|${j.releasedDate || ''}`),
            );
            if (prev && prev.contentHash === contentHash) {
                return {
                    unchanged: true, jobs: [], listed: listedJobs.length,
                    state: { slug: companyId, etag: null, contentHash, jobCount: prev.jobCount ?? 0, changed: false },
                };
            }

            // ── Step 2: enrich each with detail (description + apply URL) ──
            const enriched = await this.enrichJobsWithDetails(companyId, listedJobs);
            console.log(`[SmartRecruiters] ✅ ${companyId}: ${enriched.length}/${listedJobs.length} jobs enriched`);
            return {
                unchanged: false, jobs: enriched, listed: listedJobs.length,
                state: { slug: companyId, etag: null, contentHash, jobCount: enriched.length, changed: true },
            };
        } catch (error) {
            console.error(`[SmartRecruiters] ❌ ${companyId}: ${error.message}`);
            return null;
        }
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
