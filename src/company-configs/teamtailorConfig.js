import fetch from 'node-fetch';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { isGermanyString, normalizeWorkplaceType, normalizeCountry, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';

// ─── Teamtailor ────────────────────────────────────────────────────────────────
//
// Teamtailor has no central board API like Greenhouse. Every customer runs its
// own career site — either {slug}.teamtailor.com or a custom domain — and each
// one serves its full published board as a JSON Feed at /jobs.json. No auth, no
// key, and no pagination: one request returns the entire board.
//
// VERIFIED response shape (career.teamtailor.com/jobs.json, JSON Feed v1.1):
//   { version, title, home_page_url, feed_url, items: [ {
//       id:             "36d9bbe6-…"        // uuid, NOT the numeric job id
//       title:          "Senior Partnership Manager - APAC"
//       url:            "https://career.teamtailor.com/jobs/8144170-senior-…"
//       date_published: "2026-07-29T15:03:12+02:00"
//       content_html:   "<h3>…"             // full description
//       _jobposting: {                       // schema.org JobPosting
//         identifier:        { value: 8144170 },   // numeric, stable
//         hiringOrganization:{ name, sameAs },
//         jobLocation: [ { address: { streetAddress, addressLocality,
//                                     postalCode, addressCountry, addressRegion } } ],
//         baseSalary:  { currency, value: { unitText, minValue, maxValue } },
//         datePosted, description,
//       } } ] }
//
// FIELDS TEAMTAILOR DOES NOT PUBLISH in this feed (checked across every item on
// a live board): department, employmentType, jobLocationType/remote flag,
// validThrough, occupationalCategory. The extractors below return 'N/A'/null for
// those rather than inventing values — workplace type is inferred from the title
// and location text, which is the only signal the feed actually carries.
// baseSalary is present on a minority of postings (1 of 17 on the reference board).

// Map schema.org QuantitativeValue.unitText → the interval vocabulary the rest
// of the pipeline uses (mirrors ashbyConfig.extractSalaryInterval).
const SALARY_UNIT_TO_INTERVAL = {
    YEAR: 'per-year-salary',
    MONTH: 'per-month-salary',
    HOUR: 'per-hour-wage',
};

/** First jobLocation address block, or null. */
function getPrimaryAddress(job) {
    const locations = job?._jobposting?.jobLocation;
    if (!Array.isArray(locations) || locations.length === 0) return null;
    return locations[0]?.address || null;
}

/** Every jobLocation address block as an array (feeds may list several). */
function getAllAddresses(job) {
    const locations = job?._jobposting?.jobLocation;
    return Array.isArray(locations) ? locations.map(loc => loc?.address).filter(Boolean) : [];
}

/** "Berlin, DE" from an address block; falls back to whichever part exists. */
function formatAddress(address) {
    if (!address) return null;
    const parts = [address.addressLocality, address.addressCountry].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
}

/** schema.org baseSalary.value, or null when the posting has no salary. */
function getSalaryValue(job) {
    return job?._jobposting?.baseSalary?.value || null;
}

/** Coerce a schema.org numeric-or-string amount to a finite number, else null. */
function toAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

export const teamtailorConfig = {
    siteName: "Teamtailor",

    // Career sites live at {slug}.teamtailor.com. Kept as the host pattern
    // rather than a full URL because each company is its own origin.
    baseUrl: "https://{slug}.teamtailor.com",

    // Slugs verified to return HTTP 200 with a parseable feed AND at least one
    // German-addressed posting at the time of writing. Blind slug guessing has a
    // very low hit rate (a wrong slug 404s), so add new entries only after
    // confirming {slug}.teamtailor.com/jobs.json returns items.
    // Each entry was probed individually: the feed must return HTTP 200, parse
    // as JSON, and contain at least one posting with addressCountry "DE".
    // German-job counts at the time of verification are in the comments.
    companyBoardNames: [
        'teamviewer',               // TeamViewer Germany GmbH — 29 DE jobs
        'grouponede',               // group.one DE (dogado, checkdomain) — 10
        'roccofortehotelsgermany',  // Rocco Forte Hotels Germany — 9
        'leaseweb',                 // Leaseweb — 8 (Frankfurt)
        'cacustomeralliancegmbh',   // CA Customer Alliance GmbH, Berlin — 4
        'teamlewis',                // TEAM LEWIS — 4
        'mintos',                   // Mintos — 3 (Berlin office)
        'tibber',                   // Tibber — 3
        'polestar',                 // Polestar — 3
        'securitas',                // Securitas — 3
        'bryter',                   // BRYTER, Berlin legal tech — 2
        'oatly',                    // Oatly AB — 2
        'esker',                    // Esker — 1
        'raidboxes',                // Raidboxes, Münster — 1
        // --- GERMAN EXPANSION 2026-08-04 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'replika',  // 4 DE / 91 total
        'podimo',  // 2 DE / 5 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'fresha',  // 3 DE / 101 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'sigmaai',  // 12 DE / 431 total
],

    // Internal state
    _allJobsQueue: [],
    _initialized: false,

    async initialize() {
        if (this._initialized) return;

        console.log(`[Teamtailor] Fetching jobs from ${this.companyBoardNames.length} career sites...`);

        let successCount = 0;
        let failCount = 0;

        for (const boardName of this.companyBoardNames) {
            try {
                const url = `${this.buildFeedUrl(boardName)}`;
                const response = await fetch(url);

                if (!response.ok) {
                    failCount++;
                    continue;
                }

                // A missing/renamed career site can answer 200 with an HTML error
                // page, so guard the parse rather than trusting the status alone.
                let data;
                try {
                    data = await response.json();
                } catch {
                    failCount++;
                    console.warn(`[Teamtailor] ${boardName}: response was not valid JSON`);
                    continue;
                }

                const items = this.getJobs(data);
                if (items.length === 0) continue;

                const germanyJobs = items
                    .filter(job => this.hasGermanyLocation(job))
                    .map(job => ({
                        ...job,
                        _boardName: boardName,
                        _feedTitle: data?.title || null,
                    }));

                if (germanyJobs.length > 0) {
                    console.log(`[Teamtailor] ${boardName}: ${germanyJobs.length} jobs in Germany (${items.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    successCount++;
                }

                // Rate limit: 300ms between career sites (matches ashbyConfig)
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                failCount++;
                console.error(`[Teamtailor] ${boardName}: ${error.message}`);
            }
        }

        console.log(`[Teamtailor] Summary: ${successCount} sites with Germany jobs, ${failCount} failed/empty`);
        console.log(`[Teamtailor] Total jobs found: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    /** Full feed URL for a slug. Accepts a bare custom domain too. */
    buildFeedUrl(boardName) {
        const host = boardName.includes('.') ? boardName : `${boardName}.teamtailor.com`;
        return `https://${host}/jobs.json`;
    },

    // Germany check — the feed's only location signal is the schema.org address
    // block, so match on ISO country first and fall back to the free-text parts.
    hasGermanyLocation(job) {
        for (const address of getAllAddresses(job)) {
            const country = String(address.addressCountry || '').toLowerCase();
            if (country === 'de' || country === 'deu') return true;
            if (isGermanyString(address.addressCountry)) return true;
            if (isGermanyString(address.addressLocality)) return true;
        }

        // Some boards omit the address entirely and put the city in the title.
        if (isGermanyString(job?.title)) return true;

        return false;
    },

    async fetchPage(offset, limit) {
        if (!this._initialized) {
            await this.initialize();
        }

        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    // Called with TWO different shapes, which is why both are handled here:
    //   1. initialize() passes the raw JSON Feed → { items: [...] }
    //   2. scraperEngine passes the output of fetchPage() → { jobs, total },
    //      because network.fetchJobsPage() returns fetchPage()'s value verbatim.
    // Reading only `items` made the engine see zero jobs, break out of the paging
    // loop on the first page, and report "No new jobs found" — processJob was
    // never reached. Ashby avoids this by naming both keys `jobs`.
    getJobs(data) {
        if (Array.isArray(data?.jobs)) return data.jobs;
        if (Array.isArray(data?.items)) return data.items;
        return [];
    },

    getTotal(data) {
        return data?.total ?? this._allJobsQueue.length;
    },

    extractJobID(job) {
        // identifier.value is the stable numeric posting id; item.id is a uuid
        // that also identifies the posting, so it is a safe fallback.
        const rawId = job?._jobposting?.identifier?.value ?? job?.id;
        return `teamtailor_${job._boardName}_${rawId}`;
    },

    extractJobTitle(job) {
        return job?.title || job?._jobposting?.title || '';
    },

    extractCompany(job) {
        // hiringOrganization.name is the company's own branding — far better
        // than the slug. Fall back to the feed title, then a prettified slug.
        const fromPosting = job?._jobposting?.hiringOrganization?.name;
        if (fromPosting) return fromPosting;
        if (job?._feedTitle) return job._feedTitle;

        return String(job._boardName || '')
            .replace(/[-_]/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    },

    extractLocation(job) {
        const formatted = getAllAddresses(job).map(formatAddress).filter(Boolean);
        if (formatted.length > 0) return [...new Set(formatted)].join(', ');
        return 'Germany';
    },

    extractDescription(job) {
        return StripHtml(job?.content_html || job?._jobposting?.description || '');
    },

    extractDescriptionHtml(job) {
        return SanitizeHtml(job?.content_html || job?._jobposting?.description || '');
    },

    extractURL(job) {
        return job?.url || job?._jobposting?.hiringOrganization?.sameAs || '';
    },

    extractPostedDate(job) {
        return job?.date_published || job?._jobposting?.datePosted || null;
    },

    // Not published in the JSON feed — see the header note.
    extractDepartment() {
        return 'N/A';
    },

    extractTeam() {
        return null;
    },

    extractOffice(job) {
        const address = getPrimaryAddress(job);
        return address?.streetAddress || address?.addressLocality || null;
    },

    extractAllLocations(job) {
        return normalizeArray(getAllAddresses(job).map(formatAddress));
    },

    extractCountry(job) {
        return normalizeCountry(getPrimaryAddress(job)?.addressCountry);
    },

    // The feed carries no employmentType, so this is null unless a future feed
    // version adds it. Routed through the shared normalizer for consistency.
    extractEmploymentType(job) {
        return normalizeEmploymentType(job?._jobposting?.employmentType);
    },

    // No jobLocationType either — infer from the only text we have.
    extractWorkplaceType(job) {
        const haystack = `${job?.title || ''} ${this.extractLocation(job)}`;
        return normalizeWorkplaceType(haystack);
    },

    extractIsRemote(job) {
        return this.extractWorkplaceType(job) === 'Remote';
    },

    extractTags(job) {
        const address = getPrimaryAddress(job);
        return normalizeArray([address?.addressLocality, address?.addressRegion]);
    },

    extractDirectApplyURL(job) {
        return job?.url || null;
    },

    extractSalaryCurrency(job) {
        return job?._jobposting?.baseSalary?.currency || null;
    },

    extractSalaryMin(job) {
        // Amounts arrive as strings ("127000") in the live feed.
        return toAmount(getSalaryValue(job)?.minValue);
    },

    extractSalaryMax(job) {
        return toAmount(getSalaryValue(job)?.maxValue);
    },

    extractSalaryInterval(job) {
        const unit = getSalaryValue(job)?.unitText;
        if (!unit) return null;
        return SALARY_UNIT_TO_INTERVAL[String(unit).toUpperCase()] || null;
    },

    extractATSPlatform() {
        return 'teamtailor';
    }
};
