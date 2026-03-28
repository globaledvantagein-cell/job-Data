import fetch from 'node-fetch';
import { StripHtml } from '../utils.js';

// ─── Helpers (matching existing config conventions) ───────────────────────────

function normalizeArray(values) {
    return [...new Set((values || []).filter(Boolean).map(v => String(v).trim()).filter(Boolean))];
}

function normalizeWorkplaceType(value) {
    if (!value) return 'Unspecified';
    const lower = String(value).toLowerCase();
    if (lower.includes('remote')) return 'Remote';
    if (lower.includes('hybrid')) return 'Hybrid';
    if (lower.includes('onsite') || lower.includes('on-site') || lower.includes('office')) return 'Onsite';
    return 'Unspecified';
}

function inferEmploymentType(value) {
    if (!value) return null;
    const lower = String(value).toLowerCase();
    if (lower.includes('full')) return 'FullTime';
    if (lower.includes('part')) return 'PartTime';
    if (lower.includes('intern')) return 'Intern';
    if (lower.includes('temp')) return 'Temporary';
    if (lower.includes('contract')) return 'Contract';
    return null;
}

// ─── Germany location matching (same logic as leverConfig) ───────────────────

const germanCities = [
    'berlin', 'munich', 'münchen', 'hamburg', 'cologne', 'köln',
    'frankfurt', 'stuttgart', 'düsseldorf', 'dusseldorf', 'dortmund',
    'essen', 'leipzig', 'bremen', 'dresden', 'hanover', 'hannover',
    'nuremberg', 'nürnberg', 'duisburg', 'bochum', 'wuppertal',
    'bielefeld', 'bonn', 'münster', 'karlsruhe', 'mannheim',
    'augsburg', 'wiesbaden', 'mönchengladbach', 'gelsenkirchen',
    'aachen', 'braunschweig', 'kiel', 'chemnitz', 'halle',
    'magdeburg', 'freiburg', 'krefeld', 'mainz', 'lübeck',
    'heidelberg', 'rostock', 'ingolstadt', 'darmstadt', 'wolfsburg',
    'regensburg', 'ulm', 'kassel', 'erlangen', 'oberhausen',
    'leverkusen', 'göttingen', 'oldenburg', 'potsdam',
];

const germanyKeywords = ['germany', 'deutschland'];

function hasGermanyLocation(locationsText) {
    if (!locationsText) return false;
    const loc = locationsText.toLowerCase();

    // Direct country name match
    if (germanyKeywords.some(kw => loc.includes(kw))) return true;

    // German city match
    if (germanCities.some(city => loc.includes(city))) return true;

    return false;
}

// ─── Company list ─────────────────────────────────────────────────────────────
//
// Format: { company, instance, site, name }
// URL:    https://{company}.{instance}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs
//
// To find a company's Workday slug, visit their careers page — if it's hosted on
// Workday it will redirect to a myworkdayjobs.com URL. The instance (wd1/wd3/wd5)
// and site path are visible in the URL.
//
// Comment format: // ~N Germany jobs | ~M total

const companyBoards = [

    // ── Only working Workday companies as of 2026-03-28 ──
    { company: 'leidos',   instance: 'wd5', site: 'External',         name: 'leidos' },
    { company: 'cadence',  instance: 'wd1', site: 'External_Careers', name: 'cadence' },
    { company: 'redhat',   instance: 'wd5', site: 'Jobs',             name: 'redhat' },
    { company: 'paypal',   instance: 'wd1', site: 'Jobs',             name: 'PayPal' },
    { company: 'nxp',      instance: 'wd3', site: 'Careers',          name: 'NXP' },
    { company: 'astrazeneca', instance: 'wd3', site: 'Careers',       name: 'AstraZeneca' },
    { company: 'takeda',   instance: 'wd3', site: 'External',         name: 'Takeda' },
    { company: 'analogdevices', instance: 'wd1', site: 'External',    name: 'Analog Devices' },
    { company: 'kone',     instance: 'wd3', site: 'Careers',          name: 'KONE' },
    { company: 'equinix',  instance: 'wd1', site: 'External',         name: 'Equinix' },
    { company: 'trendmicro', instance: 'wd3', site: 'External',       name: 'Trend Micro' },
    { company: 'broadridge', instance: 'wd5', site: 'Careers',        name: 'Broadridge' },
    { company: 'thales',   instance: 'wd3', site: 'Careers',          name: 'Thales' },
    { company: 'dupont',   instance: 'wd5', site: 'Jobs',             name: 'DuPont' },
    { company: 'mars',     instance: 'wd3', site: 'External',         name: 'Mars' },
    { company: 'dell',     instance: 'wd1', site: 'External',         name: 'Dell' },
    { company: 'intel',    instance: 'wd1', site: 'External',         name: 'Intel' },
    { company: 'globalfoundries', instance: 'wd1', site: 'External',  name: 'GlobalFoundries' },
    { company: 'micron',   instance: 'wd1', site: 'External',         name: 'Micron' },

];

// ─── Config export ─────────────────────────────────────────────────────────────

export const workdayConfig = {
    siteName: 'Workday Jobs',
    companyBoards,
    limit: 20,
    _allJobsQueue: [],
    _initialized: false,
    needsDescriptionScraping: true,

    // ── Pre-fetch phase: runs once per scrape session ──────────────────────────
    // Paginates every company board, filters to Germany-only jobs, and
    // buffers them in _allJobsQueue for scrapeSite to drain one-by-one.
    async initialize() {
        if (this._initialized) return;

        // Reset queue in case the config object is reused across runs
        this._allJobsQueue = [];

        console.log(`[Workday] Fetching jobs from ${this.companyBoards.length} companies...`);

        let germanyJobsTotal = 0;
        let successCount = 0;
        let failCount = 0;
        let emptyCount = 0;

        // Deduplicate company entries (e.g. SAP listed twice above)
        const seenSlugs = new Set();
        const boards = this.companyBoards.filter(b => {
            const key = `${b.company}_${b.site}`;
            if (seenSlugs.has(key)) return false;
            seenSlugs.add(key);
            return true;
        });

        for (const board of boards) {
            const { company, instance, site, name } = board;
            const baseUrl = `https://${company}.${instance}.myworkdayjobs.com`;
            const listUrl = `${baseUrl}/wday/cxs/${company}/${site}/jobs`;

            let allJobs = [];
            let total = 0;
            let offset = 0;
            const limit = 20;

            try {
                // ── First page ──────────────────────────────────────────────
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 30000);

                const firstRes = await fetch(listUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: '' }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!firstRes.ok) {
                    failCount++;
                    console.log(`[Workday] ❌ ${company} (${name}): HTTP ${firstRes.status} — skipping`);
                    continue;
                }

                const firstData = await firstRes.json();
                total = firstData.total || 0;

                if (!total) {
                    emptyCount++;
                    continue;
                }

                // Add first page jobs
                const firstPageJobs = (firstData.jobPostings || []).map(j => ({
                    ...j,
                    _company: company,
                    _instance: instance,
                    _site: site,
                    _companyName: name,
                }));
                allJobs.push(...firstPageJobs);
                offset += limit;

                // ── Subsequent pages ────────────────────────────────────────
                while (offset < total) {
                    await new Promise(r => setTimeout(r, 200)); // polite delay between pages

                    const pageController = new AbortController();
                    const pageTimeout = setTimeout(() => pageController.abort(), 30000);

                    const pageRes = await fetch(listUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                        },
                        body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: '' }),
                        signal: pageController.signal,
                    });
                    clearTimeout(pageTimeout);

                    if (!pageRes.ok) break;

                    const pageData = await pageRes.json();
                    const pageJobs = (pageData.jobPostings || []).map(j => ({
                        ...j,
                        _company: company,
                        _instance: instance,
                        _site: site,
                        _companyName: name,
                    }));
                    allJobs.push(...pageJobs);
                    offset += limit;
                }

                // ── Filter to Germany-only ──────────────────────────────────
                const germanyJobs = allJobs.filter(j => hasGermanyLocation(j.locationsText || ''));

                if (germanyJobs.length > 0) {
                    console.log(`[Workday] ✅ ${company} (${name}): ${germanyJobs.length} Germany jobs (${total} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    germanyJobsTotal += germanyJobs.length;
                    successCount++;
                } else {
                    console.log(`[Workday]    ${company} (${name}): ${total} jobs, 0 in Germany`);
                    emptyCount++;
                }

                await new Promise(r => setTimeout(r, 500)); // polite delay between companies

            } catch (err) {
                failCount++;
                console.log(`[Workday] ❌ ${company} (${name}): ${err?.message || err}`);
            }
        }

        console.log(`[Workday] ✅ Summary: ${successCount} companies with Germany jobs, ${failCount} failed, ${emptyCount} empty`);
        console.log(`[Workday] 📊 Total Germany jobs queued: ${germanyJobsTotal}`);
        this._initialized = true;
    },

    // ── Called by network.js (fetchJobsPage detects this method) ──────────────
    async fetchPage(offset, limit) {
        if (!this._initialized) await this.initialize();
        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    getJobs(data) {
        return data.jobs || [];
    },

    getTotal(data) {
        return data.total || 0;
    },

    // ── Field extractors (used by processor.js) ───────────────────────────────

    extractJobID(job) {
        // bulletFields[0] is Workday's internal requisition ID — stable across re-posts
        const reqId = job.bulletFields?.[0] || job.externalPath || '';
        return `workday_${job._company}_${reqId}`;
    },

    extractJobTitle(job) {
        return job.title || '';
    },

    extractCompany(job) {
        return job._companyName || job._company || '';
    },

    extractLocation(job) {
        return job.locationsText || '';
    },

    extractAllLocations(job) {
        // locationsText can be comma-separated when a job is multi-location
        const raw = job.locationsText || '';
        return normalizeArray(raw.split(',').map(l => l.trim()));
    },

    extractDepartment(job) {
        // Not available in list payload — filled by getDetails if present
        return null;
    },

    extractWorkplaceType(job) {
        // Workday list API rarely exposes this; getDetails fills it properly
        return 'Unspecified';
    },

    extractEmploymentType(job) {
        return null; // filled by getDetails
    },

    extractDescription(job) {
        return null; // always fetched via getDetails
    },

    extractURL(job) {
        return null; // filled by getDetails
    },

    extractPostedDate(job) {
        return null; // filled by getDetails
    },

    // ── Detail fetch: called by processor.js when needsDescriptionScraping=true ─

    async getDetails(rawJob, sessionHeaders) {
        const { _company, _instance, _site, externalPath, _companyName } = rawJob;

        if (!_company || !_instance || !_site || !externalPath) return null;

        const baseUrl  = `https://${_company}.${_instance}.myworkdayjobs.com`;
        const detailUrl = `${baseUrl}/wday/cxs/${_company}/${_site}${externalPath}`;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            const res = await fetch(detailUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...(sessionHeaders || {}),
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) return null;

            const data = await res.json();
            const info       = data.jobPostingInfo   || {};
            const hiringOrg  = data.hiringOrganization || {};

            // ── Workplace type ─────────────────────────────────────────────
            const workplaceRaw = info.remoteType || info.workplaceType || info.locationType || null;
            const workplaceType = normalizeWorkplaceType(workplaceRaw);

            // ── Employment type ─────────────────────────────────────────────
            const employmentRaw = info.timeType || info.jobType || null;
            const employmentType = inferEmploymentType(employmentRaw);

            // ── Department ─────────────────────────────────────────────────
            const department = info.jobFunctionSummary || info.jobFamily || hiringOrg.industry || null;

            // ── Plain-text description (strip any HTML Workday sometimes includes) ──
            const descriptionHtml  = info.jobDescription || '';
            const descriptionPlain = StripHtml(descriptionHtml);

            return {
                Description:    descriptionPlain || null,
                ApplicationURL: info.externalUrl  || `${baseUrl}/${_company}/${_site}/job${externalPath}`,
                DirectApplyURL: info.externalUrl  || null,
                PostedDate:     info.startDate ? new Date(info.startDate) : null,
                ContractType:   employmentRaw      || null,
                EmploymentType: employmentType,
                WorkplaceType:  workplaceType,
                Department:     department          || null,
                Company:        hiringOrg.name      || _companyName,
            };
        } catch (err) {
            return null;
        }
    },
};