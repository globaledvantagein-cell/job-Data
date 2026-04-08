import fetch from 'node-fetch';
import { StripHtml } from '../utils.js';
import { GERMAN_CITIES, isGermanyString, normalizeWorkplaceType, normalizeEmploymentType } from '../core/Locationprefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';


// --- Germany location matching -------------------------------------------------

function hasGermanyLocation(job) {
    // Check locationsText first (most companies populate this)
    const locationsText = (typeof job === 'string') ? job : (job.locationsText || '');
    if (locationsText && isGermanyString(locationsText)) return true;

    // Fallback: check bulletFields (some companies like Europcar store country/city here)
    // bulletFields format: ['Germany', 'Hamburg', 'JR108514'] — country in [0], city in [1]
    if (typeof job === 'object' && Array.isArray(job.bulletFields)) {
        const bfText = job.bulletFields.map(b => String(b)).join(' ');
        if (isGermanyString(bfText)) return true;
    }

    return false;
}

// --- Company list -------------------------------------------------------------
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

    // -- Original verified companies --
    { company: 'leidos', instance: 'wd5', site: 'External', name: 'Leidos' },
    { company: 'cadence', instance: 'wd1', site: 'External_Careers', name: 'Cadence' },
    { company: 'redhat', instance: 'wd5', site: 'Jobs', name: 'Red Hat' },
    { company: 'paypal', instance: 'wd1', site: 'Jobs', name: 'PayPal' },
    { company: 'nxp', instance: 'wd3', site: 'Careers', name: 'NXP' },
    { company: 'astrazeneca', instance: 'wd3', site: 'Careers', name: 'AstraZeneca' },
    { company: 'takeda', instance: 'wd3', site: 'External', name: 'Takeda' },
    { company: 'analogdevices', instance: 'wd1', site: 'External', name: 'Analog Devices' },
    { company: 'kone', instance: 'wd3', site: 'Careers', name: 'KONE' },
    { company: 'equinix', instance: 'wd1', site: 'External', name: 'Equinix' },
    { company: 'trendmicro', instance: 'wd3', site: 'External', name: 'Trend Micro' },
    { company: 'broadridge', instance: 'wd5', site: 'Careers', name: 'Broadridge' },
    { company: 'thales', instance: 'wd3', site: 'Careers', name: 'Thales' },
    { company: 'dupont', instance: 'wd5', site: 'Jobs', name: 'DuPont' },
    { company: 'mars', instance: 'wd3', site: 'External', name: 'Mars' },
    { company: 'dell', instance: 'wd1', site: 'External', name: 'Dell' },
    { company: 'intel', instance: 'wd1', site: 'External', name: 'Intel' },
    { company: 'globalfoundries', instance: 'wd1', site: 'External', name: 'GlobalFoundries' },
    { company: 'micron', instance: 'wd1', site: 'External', name: 'Micron' },
    { company: 'shell', instance: 'wd3', site: 'ShellCareers', name: 'Shell' },

    // -- New from dorking --
    { company: 'mufgub', instance: 'wd3', site: 'MUFG-Careers', name: 'MUFG' },
    { company: 'gsk', instance: 'wd5', site: 'GSKCareers', name: 'GSK' },
    { company: 'illumina', instance: 'wd1', site: 'illumina-careers', name: 'Illumina' },
    { company: 'fastretailing', instance: 'wd3', site: 'graduates_eu_Uniqlo', name: 'Uniqlo' },
    { company: 'aresmgmt', instance: 'wd1', site: 'External', name: 'Ares Management' },
    { company: 'tmhcc', instance: 'wd108', site: 'External', name: 'Tokio Marine HCC' },
    { company: 'sabre', instance: 'wd1', site: 'SabreJobs', name: 'Sabre' },
    { company: 'maersk', instance: 'wd3', site: 'Maersk_Careers', name: 'Maersk' },
    { company: 'philips', instance: 'wd3', site: 'jobs-and-careers', name: 'Philips' },
    { company: 'bdx', instance: 'wd1', site: 'EXTERNAL_CAREER_SITE_GERMANY', name: 'BD (Becton Dickinson)' },
    { company: 'alcon', instance: 'wd5', site: 'careers_alcon', name: 'Alcon' },
    { company: 'sandvik', instance: 'wd3', site: 'walter-jobs', name: 'Walter (Sandvik)' },
    { company: 'condenast', instance: 'wd5', site: 'CondeCareers', name: 'Condé Nast' },
    { company: 'freseniusglobal', instance: 'wd3', site: 'FK_Careers', name: 'Fresenius Kabi' },
    { company: 'solenis', instance: 'wd1', site: 'Solenis', name: 'Solenis' },
    { company: 'athora', instance: 'wd3', site: 'athora-careers', name: 'Athora' },
    { company: 'alantra', instance: 'wd3', site: 'Alantra', name: 'Alantra' },
    { company: 'aesop', instance: 'wd3', site: 'aesopcareers', name: 'Aesop' },
    { company: 'bb', instance: 'wd3', site: 'BlackBerry', name: 'BlackBerry' },
    { company: 'novanta', instance: 'wd5', site: 'Novanta-Careers', name: 'Novanta' },
    { company: 'airliquidehr', instance: 'wd3', site: 'AirLiquideExternalCareer', name: 'Air Liquide' },
    { company: 'covestro', instance: 'wd3', site: 'cov_external', name: 'Covestro' },
    { company: 'galileo', instance: 'wd3', site: 'global_education_germany_career_site', name: 'Galileo Global Education' },
    { company: 'insulet', instance: 'wd5', site: 'insuletcareers', name: 'Insulet (Omnipod)' },
    { company: 'ossur', instance: 'wd3', site: 'ossurcareersglobal', name: 'Össur' },
    { company: 'rentschler', instance: 'wd3', site: 'Rentschler_Career', name: 'Rentschler Biopharma' },
    { company: 'raymondjames', instance: 'wd1', site: 'RaymondJamesCareers', name: 'Raymond James' },
    { company: 'brenntag', instance: 'wd3', site: 'brenntag_jobs', name: 'Brenntag' },
    { company: 'unilever', instance: 'wd3', site: 'Unilever_Experienced_Professionals', name: 'Unilever' },
    { company: 'iberdrola', instance: 'wd3', site: 'Iberdrola', name: 'Iberdrola' },
    { company: 'hl', instance: 'wd1', site: 'Campus', name: 'Houlihan Lokey' },
    { company: 'bf', instance: 'wd5', site: 'International', name: 'Brown-Forman' },
    { company: 'wilhelmsen', instance: 'wd3', site: 'Wilhelmsen', name: 'Wilhelmsen' },
    { company: 'europcar', instance: 'wd103', site: 'EuropcarCareerPage', name: 'Europcar' },
    { company: 'db', instance: 'wd3', site: 'DBWebsite', name: 'Deutsche Bank' },
    { company: 'pae', instance: 'wd1', site: 'Amentum_Careers', name: 'Amentum' },
    { company: 'villeroyboch', instance: 'wd3', site: 'careers', name: 'Villeroy & Boch' },
    { company: 'holmanautogroup', instance: 'wd1', site: 'HolmanEnterprisesCareers', name: 'Holman' },
    { company: 'kbr', instance: 'wd5', site: 'KBR_Careers', name: 'KBR' },
    { company: 'movadogroup', instance: 'wd1', site: 'Careers', name: 'Movado Group' },
    { company: 'barrywehmiller', instance: 'wd1', site: 'BWCareers', name: 'Barry-Wehmiller' },
    { company: 'skechers', instance: 'wd5', site: 'One-career-site', name: 'Skechers' },
    { company: 'otis', instance: 'wd5', site: 'REC_Ext_Gateway', name: 'Otis' },
    { company: 'esab', instance: 'wd5', site: 'esabcareers', name: 'ESAB' },
    { company: 'ttiemea', instance: 'wd3', site: 'TTI', name: 'TTI (Techtronic Industries)' },
    { company: 'jm', instance: 'wd103', site: 'External', name: 'Johnson Matthey' },
    { company: 'faro', instance: 'wd1', site: 'FARO', name: 'FARO Technologies' },
    { company: 'cw', instance: 'wd1', site: 'External', name: 'Curtiss-Wright' },
    { company: 'livanova', instance: 'wd5', site: 'Search', name: 'LivaNova' },
    { company: 'relx', instance: 'wd3', site: 'ReedExhibitions', name: 'RELX (Reed Exhibitions)' },
    { company: 'zuehlke', instance: 'wd3', site: 'Zuhlke-Careers', name: 'Zühlke' },

];

// --- Config export -------------------------------------------------------------

export const workdayConfig = {
    siteName: 'Workday Jobs',
    companyBoards,
    limit: 20,
    _allJobsQueue: [],
    _initialized: false,
    needsDescriptionScraping: true,

    // -- Pre-fetch phase: runs once per scrape session --------------------------
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
                // -- First page ----------------------------------------------
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
                    console.log(`[Workday] ? ${company} (${name}): HTTP ${firstRes.status} — skipping`);
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

                // -- Subsequent pages ----------------------------------------
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

                // -- Filter to Germany-only ----------------------------------
                const germanyJobs = allJobs.filter(j => hasGermanyLocation(j));

                if (germanyJobs.length > 0) {
                    console.log(`[Workday] ? ${company} (${name}): ${germanyJobs.length} Germany jobs (${total} total)`);
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
                console.log(`[Workday] ? ${company} (${name}): ${err?.message || err}`);
            }
        }

        console.log(`[Workday] ? Summary: ${successCount} companies with Germany jobs, ${failCount} failed, ${emptyCount} empty`);
        console.log(`[Workday] ?? Total Germany jobs queued: ${germanyJobsTotal}`);
        this._initialized = true;
    },

    // -- Called by network.js (fetchJobsPage detects this method) --------------
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

    // -- Field extractors (used by processor.js) -------------------------------

    extractJobID(job) {
        // externalPath is always unique: /job/Hamburg/Revenue-Analyst_JR108514
        // bulletFields[0] is SOMETIMES the req ID, but some companies (Europcar)
        // put country in bulletFields[0] instead. Use externalPath as primary.
        const path = job.externalPath || '';
        const reqFromPath = path.split('_').pop() || '';
        const reqFromBullet = job.bulletFields?.[job.bulletFields?.length - 1] || '';
        const reqId = reqFromPath || reqFromBullet || path;
        return `workday_${job._company}_${reqId}`;
    },

    extractJobTitle(job) {
        return job.title || '';
    },

    extractCompany(job) {
        return job._companyName || job._company || '';
    },

    extractLocation(job) {
        if (job.locationsText) return job.locationsText;
        // Fallback: some companies (e.g. Europcar) store location in bulletFields
        // Format: ['Germany', 'Hamburg', 'JR108514']
        if (Array.isArray(job.bulletFields) && job.bulletFields.length >= 2) {
            const country = job.bulletFields[0];
            const city = job.bulletFields[1];
            if (city && country) return `${city}, ${country}`;
            if (country) return country;
        }
        return '';
    },

    extractAllLocations(job) {
        if (job.locationsText) {
            const raw = job.locationsText;
            return normalizeArray(raw.split(',').map(l => l.trim()));
        }
        // Fallback: bulletFields
        if (Array.isArray(job.bulletFields) && job.bulletFields.length >= 2) {
            return normalizeArray([`${job.bulletFields[1]}, ${job.bulletFields[0]}`]);
        }
        return [];
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

    // -- Detail fetch: called by processor.js when needsDescriptionScraping=true -

    async getDetails(rawJob, sessionHeaders) {
        const { _company, _instance, _site, externalPath, _companyName } = rawJob;

        if (!_company || !_instance || !_site || !externalPath) return null;

        const baseUrl = `https://${_company}.${_instance}.myworkdayjobs.com`;
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
            const info = data.jobPostingInfo || {};
            const hiringOrg = data.hiringOrganization || {};

            // -- Workplace type ---------------------------------------------
            const workplaceRaw = info.remoteType || info.workplaceType || info.locationType || null;
            const workplaceType = normalizeWorkplaceType(workplaceRaw);

            // -- Employment type ---------------------------------------------
            const employmentRaw = info.timeType || info.jobType || null;
            const employmentType = normalizeEmploymentType(employmentRaw);

            // -- Department -------------------------------------------------
            const department = info.jobFunctionSummary || info.jobFamily || hiringOrg.industry || null;

            // -- Plain-text description (strip any HTML Workday sometimes includes) --
            const descriptionHtml = info.jobDescription || '';
            const descriptionPlain = StripHtml(descriptionHtml);

            return {
                Description: descriptionPlain || null,
                ApplicationURL: info.externalUrl || `${baseUrl}/${_company}/${_site}/job${externalPath}`,
                DirectApplyURL: info.externalUrl || null,
                PostedDate: info.startDate ? new Date(info.startDate) : null,
                ContractType: employmentRaw || null,
                EmploymentType: employmentType,
                WorkplaceType: workplaceType,
                Department: department || null,
                Company: hiringOrg.name || _companyName,
            };
        } catch (err) {
            return null;
        }
    },
};