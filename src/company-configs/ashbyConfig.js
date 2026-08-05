import fetch from 'node-fetch';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { isGermanyString, normalizeWorkplaceType, normalizeCountry, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';


function findCompensationComponent(job, typeName) {
    const summaryComponents = job?.compensation?.summaryComponents || [];
    const tierComponents = (job?.compensation?.compensationTiers || []).flatMap(tier => tier.components || []);
    const all = [...summaryComponents, ...tierComponents];
    return all.find(component => String(component?.compensationType || '').toLowerCase() === String(typeName).toLowerCase()) || null;
}

export const ashbyConfig = {
    siteName: "Ashby Jobs",
    baseUrl: "https://api.ashbyhq.com/posting-api/job-board",

    // ? VERIFIED WORKING COMPANIES (with Germany jobs potential)
    companyBoardNames: [
        // Companies confirmed to have Germany jobs
        'Ashby',
        'Deel',
        'OpenAI',
        'Cohere',
        'Linear',
        'Notion',
        'Ramp',
        'Mercury',
        'Lattice',
        'Supabase',
        'Vercel',
        'Replit',
        'Cal',
        'Modal',
        'Sourcegraph',
        'Grammarly',
        'Scale',
        'Hugging-Face',
        'Weights-Biases',
        'dbt-labs',
        'Replicate',
        'Together',
        'Perplexity',
        'Cursor',
        'Anthropic',
        'Mistral',
        'Stability',
        'Adept',
        'Character',
        'Inflection',
        'Personio',
        'Contentful',
        'Celonis',
        'Taxfix',
        'Raisin',
        'N26',
        'Trade-Republic',
        'Sennder',
        'Adjust',
        'GetYourGuide',
        'Delivery-Hero',
        'Auto1',
        'Zalando',
        'HelloFresh',
        'Rocket-Internet',
        // --- BEGIN APPENDED ENTRIES ---
        'moss', 'upvest', 'deepl', 'amboss', 'bunch', 'leapsome', 'carwow', 'rohlik', 'pleo', 'lemon-markets', 'forto', 'billie', 'alephalpha', 'docker', 'babbel', 'mollie', 'cosmos', 'rasa', 'airwallex', 'redis', 'uipath', 'deliveroo', 'camunda', 'enpal', 'neon', 'langchain', 'kestra', 'voodoo',
        // --- END APPENDED ENTRIES ---
        // --- GERMAN EXPANSION 2026-08-04 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'doctolib',  // 83 DE / 155 total
        'statista',  // 41 DE / 48 total
        'andercore',  // 38 DE / 39 total
        'almedia',  // 37 DE / 54 total
        'voize',  // 36 DE / 41 total
        'sereact',  // 36 DE / 44 total
        'vrey',  // 34 DE / 34 total
        'focused',  // 28 DE / 31 total
        'reonic',  // 27 DE / 32 total
        'n8n',  // 24 DE / 39 total
        'applied',  // 22 DE / 261 total
        'taktile',  // 20 DE / 46 total
        'langdock',  // 19 DE / 19 total
        'nelly',  // 17 DE / 17 total
        'pliant',  // 17 DE / 43 total
        'telli',  // 16 DE / 16 total
        'zenjob',  // 15 DE / 15 total
        'buena',  // 15 DE / 15 total
        'jupus',  // 14 DE / 15 total
        'klim',  // 13 DE / 15 total
        'plancraft',  // 12 DE / 20 total
        'trading212',  // 11 DE / 39 total
        'knowunity',  // 11 DE / 13 total
        'trawa',  // 11 DE / 12 total
        'mercura',  // 11 DE / 11 total
        'mapbox',  // 10 DE / 63 total
        'doinstruct',  // 10 DE / 12 total
        'kayak',  // 10 DE / 44 total
        'snowflake',  // 9 DE / 395 total
        'eye-security',  // 9 DE / 24 total
        'pplwise',  // 9 DE / 10 total
        'praxipal',  // 9 DE / 9 total
        'toogoodtogo',  // 9 DE / 78 total
        'pennylane',  // 8 DE / 116 total
        'ideals',  // 7 DE / 50 total
        'yepoda',  // 7 DE / 8 total
        'legora',  // 6 DE / 279 total
        'harvey',  // 6 DE / 364 total
        'bettermile',  // 6 DE / 6 total
        'zeit-ai',  // 5 DE / 5 total
        'synthesia',  // 5 DE / 74 total
        'egym',  // 5 DE / 5 total
        'kittl',  // 5 DE / 5 total
        'secfix',  // 5 DE / 14 total
        'choco',  // 4 DE / 11 total
        'flip',  // 4 DE / 7 total
        'uplane',  // 4 DE / 6 total
        'powerus',  // 4 DE / 4 total
        'zip',  // 4 DE / 124 total
        'ostrom',  // 4 DE / 4 total
        'taxforce',  // 4 DE / 4 total
        'satispay',  // 3 DE / 88 total
        'qonto',  // 3 DE / 36 total
        'litmus',  // 3 DE / 34 total
        'dataleap',  // 3 DE / 5 total
        'climatiq',  // 3 DE / 3 total
        'passionfroot',  // 3 DE / 10 total
        'onebrief',  // 2 DE / 26 total
        'odys-aviation',  // 2 DE / 12 total
        'temporal',  // 2 DE / 56 total
        'quantexa',  // 2 DE / 32 total
        'viessmann',  // 2 DE / 2 total
        'miro',  // 2 DE / 47 total
        'luminovo',  // 2 DE / 5 total
        'ygo',  // 2 DE / 5 total
        'overview',  // 1 DE / 43 total
        'supercell',  // 1 DE / 38 total
        'bynder',  // 1 DE / 23 total
        'epidemic-sound',  // 1 DE / 16 total
        'rescale',  // 1 DE / 17 total
        'complir',  // 1 DE / 6 total
        'docebo',  // 1 DE / 51 total
        'benchling',  // 1 DE / 50 total
        'kong',  // 1 DE / 91 total
        'chainalysis-careers',  // 1 DE / 45 total
        'constructor',  // 1 DE / 47 total
        'sanity',  // 1 DE / 25 total
        'sardine',  // 1 DE / 39 total
        'wayflyer',  // 1 DE / 18 total
        'mural',  // 1 DE / 10 total
        'illumio',  // 1 DE / 65 total
        'tourlane',  // 1 DE / 9 total
        'cognition',  // 1 DE / 79 total
        'barnes',  // 1 DE / 88 total
        // --- GERMAN EXPANSION 2026-08-04 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'comena',  // 6 DE / 6 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'vogel',  // 34 DE / 47 total
        'peec',  // 28 DE / 38 total
        'lio',  // 18 DE / 20 total
        'perk',  // 15 DE / 139 total
        'kuro',  // 8 DE / 8 total
        'augustus',  // 5 DE / 13 total
        'reteam',  // 5 DE / 90 total
        'cello',  // 4 DE / 5 total
        'synthflow',  // 4 DE / 5 total
        'dandy',  // 3 DE / 79 total
        'hiya',  // 2 DE / 19 total
        'zeno',  // 2 DE / 2 total
        'industrious',  // 1 DE / 69 total
        'artsy',  // 1 DE / 11 total
        'molecule',  // 1 DE / 4 total
        'gorilla',  // 1 DE / 3 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'zauber',  // 8 DE / 8 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'zuru',  // 1 DE / 75 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'clera',  // 74 DE / 317 total
        'the-exploration-company',  // 53 DE / 111 total
        'proxima-fusion',  // 40 DE / 48 total
        'munich-electrification',  // 35 DE / 35 total
        'adjoe',  // 30 DE / 43 total
        'sunday-natural',  // 18 DE / 24 total
        'integral-de',  // 17 DE / 19 total
        'sosafe',  // 16 DE / 23 total
        'skalar',  // 16 DE / 16 total
        'dataguard',  // 15 DE / 15 total
        'almetra',  // 13 DE / 13 total
        'anyone-ai',  // 11 DE / 200 total
        'sensmore',  // 10 DE / 10 total
        'blp-digital',  // 10 DE / 27 total
        'netbird',  // 10 DE / 11 total
        'atira',  // 10 DE / 10 total
        'lyceum',  // 9 DE / 13 total
        'pergolux',  // 8 DE / 19 total
        'yazio',  // 7 DE / 7 total
        'dash0',  // 6 DE / 47 total
        'siteminder',  // 6 DE / 44 total
        'phlair',  // 6 DE / 6 total
        'bowatt',  // 5 DE / 5 total
        'founders-factory',  // 5 DE / 21 total
        'orbem',  // 5 DE / 5 total
        'workerbase',  // 5 DE / 5 total
        'omegga',  // 5 DE / 5 total
        'deepslate',  // 5 DE / 5 total
        'gotphoto',  // 5 DE / 5 total
        'omaze',  // 4 DE / 13 total
        'angi',  // 4 DE / 43 total
        'rhoda-ai',  // 3 DE / 55 total
        'engflow',  // 3 DE / 9 total
        'liqid-lam',  // 3 DE / 3 total
        'thrivo-wealth',  // 2 DE / 3 total
        '3e',  // 1 DE / 13 total
        'linro',  // 1 DE / 7 total
        'alta-ares',  // 1 DE / 28 total
        'lupapets',  // 1 DE / 12 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'publiccloudgroup',  // 8 DE / 18 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'buildlinx',  // 4 DE / 4 total
        'emagine',  // 2 DE / 4 total
],

    // Internal state
    _allJobsQueue: [],
    _initialized: false,

    // Fetch all jobs from all boards upfront
    async initialize() {
        if (this._initialized) return;

        console.log(`[Ashby] Fetching jobs from ${this.companyBoardNames.length} companies...`);

        let successCount = 0;
        let failCount = 0;

        for (const boardName of this.companyBoardNames) {
            try {
                const url = `${this.baseUrl}/${boardName}?includeCompensation=true`;
                const response = await fetch(url);

                if (!response.ok) {
                    failCount++;
                    // Only log 404s if you want to see which ones failed
                    // console.log(`[Ashby] ? ${boardName}: ${response.status}`);
                    continue;
                }

                const data = await response.json();

                if (!data.jobs || data.jobs.length === 0) {
                    continue;
                }

                // Filter for Germany jobs
                const germanyJobs = data.jobs.filter(job => {
                    return this.hasGermanyLocation(job);
                }).map(job => ({
                    ...job,
                    _boardName: boardName
                }));

                if (germanyJobs.length > 0) {
                    console.log(`[Ashby] ? ${boardName}: ${germanyJobs.length} jobs in Germany (${data.jobs.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    successCount++;
                }

                // Rate limit: 300ms between companies
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                failCount++;
                console.error(`[Ashby] ? ${boardName}: ${error.message}`);
            }
        }

        console.log(`[Ashby] ? Summary: ${successCount} companies with Germany jobs, ${failCount} failed/empty`);
        console.log(`[Ashby] ?? Total jobs found: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    // Check if job has Germany location � delegates to shared isGermanyString() + per-ATS field mapping
    hasGermanyLocation(job) {
        // Check primary location
        if (job.location && isGermanyString(job.location)) return true;

        // Check address country
        if (job.address?.postalAddress?.addressCountry) {
            const country = job.address.postalAddress.addressCountry.toLowerCase();
            if (country === 'de' || country === 'deu' || isGermanyString(country)) return true;
        }

        // Check secondary locations
        if (job.secondaryLocations?.length > 0) {
            for (const secLoc of job.secondaryLocations) {
                if (secLoc.location && isGermanyString(secLoc.location)) return true;
                if (secLoc.address?.addressCountry) {
                    const c = secLoc.address.addressCountry.toLowerCase();
                    if (c === 'de' || c === 'deu' || isGermanyString(c)) return true;
                }
            }
        }

        // Remote jobs � only if explicitly Germany+Remote
        if (job.isRemote && job.location) {
            const l = job.location.toLowerCase();
            if ((l.includes('germany') || l.includes('deutschland')) && l.includes('remote')) return true;
        }

        return false;
    },

    // Fetch jobs page (required by scraperEngine)
    async fetchPage(offset, limit) {
        if (!this._initialized) {
            await this.initialize();
        }

        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    // Required by scraperEngine
    getJobs(data) {
        return data.jobs || [];
    },

    // Get total
    getTotal(data) {
        return data.total || 0;
    },

    // Extract job ID
    extractJobID(job) {
        // Use jobUrl as unique ID
        const urlParts = job.jobUrl.split('/');
        return `ashby_${job._boardName}_${urlParts[urlParts.length - 1]}`;
    },

    // Extract job title
    extractJobTitle(job) {
        return job.title;
    },

    // Extract company name
    extractCompany(job) {
        // Format board name to readable company name
        return job._boardName
            .replace(/-/g, ' ')
            .replace(/_/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    },

    // Extract location
    extractLocation(job) {
        // Combine all Germany locations
        let locations = [];

        // Add primary location if it's Germany
        if (job.location && this.isGermanyString(job.location)) {
            locations.push(job.location);
        }

        // Add secondary Germany locations
        if (job.secondaryLocations && job.secondaryLocations.length > 0) {
            for (const secLoc of job.secondaryLocations) {
                if (secLoc.location && this.isGermanyString(secLoc.location)) {
                    locations.push(secLoc.location);
                }
            }
        }

        return locations.length > 0 ? locations.join(', ') : 'Germany';
    },

    // Helper to check if a location string is Germany-related � delegates to shared helper
    isGermanyString(locationStr) {
        return isGermanyString(locationStr);
    },

    // Extract description
    extractDescription(job) {
        // Prefer plain text, fallback to HTML
        return StripHtml(job.descriptionPlain || job.descriptionHtml || '');
    },

    extractDescriptionHtml(job) {
        return SanitizeHtml(job.descriptionHtml || '');
    },

    // Extract URL
    extractURL(job) {
        return job.jobUrl || job.applyUrl;
    },

    // Extract posted date
    extractPostedDate(job) {
        return job.publishedAt;
    },

    extractDepartment(job) {
        return job.department || 'N/A';
    },

    extractTeam(job) {
        return job.team || null;
    },

    extractOffice(job) {
        return job.location || null;
    },

    extractAllLocations(job) {
        const secondaries = (job.secondaryLocations || []).map(sec => sec?.location).filter(Boolean);
        return normalizeArray([job.location, ...secondaries]);
    },

    extractCountry(job) {
        const primary = job?.address?.postalAddress?.addressCountry;
        return normalizeCountry(primary);
    },

    extractEmploymentType(job) {
        return normalizeEmploymentType(job.employmentType);
    },

    extractWorkplaceType(job) {
        return normalizeWorkplaceType(job.workplaceType);
    },

    extractIsRemote(job) {
        if (typeof job.isRemote === 'boolean') return job.isRemote;
        const workplace = normalizeWorkplaceType(job.workplaceType);
        return workplace === 'Remote' || workplace === 'Hybrid';
    },

    extractTags(job) {
        return normalizeArray([job.department, job.team, job.workplaceType, job.employmentType]);
    },

    extractDirectApplyURL(job) {
        return job.applyUrl || null;
    },

    extractSalaryCurrency(job) {
        const salary = findCompensationComponent(job, 'Salary');
        return salary?.currencyCode || null;
    },

    extractSalaryMin(job) {
        const salary = findCompensationComponent(job, 'Salary');
        return Number.isFinite(salary?.minValue) ? salary.minValue : null;
    },

    extractSalaryMax(job) {
        const salary = findCompensationComponent(job, 'Salary');
        return Number.isFinite(salary?.maxValue) ? salary.maxValue : null;
    },

    extractSalaryInterval(job) {
        const salary = findCompensationComponent(job, 'Salary');
        if (!salary?.interval) return null;
        const lower = String(salary.interval).toLowerCase();
        if (lower.includes('year')) return 'per-year-salary';
        if (lower.includes('month')) return 'per-month-salary';
        if (lower.includes('hour')) return 'per-hour-wage';
        return null;
    },

    extractATSPlatform() {
        return 'ashby';
    }
};
