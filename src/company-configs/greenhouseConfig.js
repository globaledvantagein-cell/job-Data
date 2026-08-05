import fetch from 'node-fetch';
import { StripHtml, SanitizeHtml } from '../utils.js';
import { GERMAN_CITIES, isGermanyString, normalizeWorkplaceType, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';


function metadataToObject(metadata) {
    if (!metadata) return {};
    if (Array.isArray(metadata)) {
        const result = {};
        for (const item of metadata) {
            if (!item?.name) continue;
            result[item.name] = item.value;
        }
        return result;
    }
    if (typeof metadata === 'object') return metadata;
    return {};
}

function findMetadataValue(metadataObj, keywords = []) {
    const entries = Object.entries(metadataObj || {});
    for (const [key, value] of entries) {
        const lowered = key.toLowerCase();
        if (keywords.some(keyword => lowered.includes(keyword))) {
            return value;
        }
    }
    return null;
}

function parseSalaryFromText(text) {
    if (!text) return {};
    const cleaned = StripHtml(text).replace(/\./g, '').replace(/,/g, '.');

    const currencyMatch = cleaned.match(/(USD|EUR|GBP|CHF|CAD|AUD|JPY|SEK|NOK|DKK|PLN)/i);
    const symbolMatch = cleaned.match(/[�$�]/);
    const rangeMatch = cleaned.match(/(\d{2,7}(?:\.\d+)?)\s*(?:-|�|�|to)\s*(\d{2,7}(?:\.\d+)?)/i);

    let salaryCurrency = null;
    if (currencyMatch) {
        salaryCurrency = currencyMatch[1].toUpperCase();
    } else if (symbolMatch) {
        if (symbolMatch[0] === '�') salaryCurrency = 'EUR';
        if (symbolMatch[0] === '$') salaryCurrency = 'USD';
        if (symbolMatch[0] === '�') salaryCurrency = 'GBP';
    }

    let salaryInterval = null;
    const lower = cleaned.toLowerCase();
    if (lower.includes('per hour') || lower.includes('/hour') || lower.includes('hourly')) salaryInterval = 'per-hour-wage';
    if (lower.includes('per month') || lower.includes('/month') || lower.includes('monthly')) salaryInterval = 'per-month-salary';
    if (lower.includes('per year') || lower.includes('/year') || lower.includes('annual') || lower.includes('yearly')) salaryInterval = 'per-year-salary';

    return {
        SalaryMin: rangeMatch ? Number(rangeMatch[1]) : null,
        SalaryMax: rangeMatch ? Number(rangeMatch[2]) : null,
        SalaryCurrency: salaryCurrency,
        SalaryInterval: salaryInterval
    };
}

export const greenhouseConfig = {
    siteName: "Greenhouse Jobs",
    baseUrl: "https://boards-api.greenhouse.io/v1/boards",

    companyBoardTokens: [
        // ? WORKING TOKENS (verified)
        'airbnb',
        'stripe',
        'figma',
        'airtable',
        'gitlab',
        'reddit',
        'pinterest',
        'twitch',
        'deliveryhero',
        'getaround',
        'wolt',
        'personio',
        'contentful',
        'celonis',
        'adjust',
        'signavio',
        'sennder',
        'n26',
        'gorillas',
        'flink',
        'trade-republic',
        'taxfix',
        'raisin',
        'heyjobs',
        'omio',
        'scalablecapital',
        'eyeo',
        'jimdo',
        'shopify',          // Try alternative
        'datadog',
        'notion',           // Try alternative  
        'miro',
        'zapier',
        'asana',
        'dropbox',
        'docusign',
        'confluent',
        'databricks',
        'snowflake',
        'hashicorp',
        'cloudflare',
        'mongodb',
        'elastic',
        'okta',
        'zendesk',
        'hubspot',
        'intercom',
        'segment',
        'amplitude',
        'mixpanel',
        'launchdarkly',
        'pagerduty',
        'sumo-logic',
        'new-relic',
        'splunk',
        'dynatrace',
        // --- BEGIN APPENDED ENTRIES ---
        'doctolib', 'sumup', 'flix', 'jetbrains', 'ionos', 'helsing', 'isaraerospace', 'staffbase', 'moia', 'freenow', 'scout24', 'parloa', 'autoscout24', 'trustpilot', 'finanzcheck', 'nice', 'grafanalabs', 'catawiki', 'navvis', 'clickhouse', 'flaconi', 'moonfare', 'trivago', 'adyen', 'zscaler', 'anaplan', 'think-cell', 'commercetools', 'grover', 'pleo', 'apaleo', 'idnow', 'typeform', 'dataiku', 'workato', 'mirakl', 'bitpanda', 'tanium', 'smartsheet', 'anydesk', 'spryker', 'strato', 'fivetran', 'tripadvisor', 'fireblocks', 'bitgo', 'beyondtrust', 'tekla', 'adahealth', 'qualtrics', 'sofi', 'riotgames', 'udemy', 'klaviyo', 'cultureamp', 'planradar', 'five9', 'wooga', 'braze', 'bloomreach', 'konux', 'jfrog', 'cockroachlabs', 'scaleai', 'algolia', 'veracode', 'wrike', 'zuora', 'propstack', 'pendo',
        // --- END APPENDED ENTRIES ---
        // --- GERMAN EXPANSION 2026-08-04 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'hellofresh',  // 59 DE / 333 total
        'getyourguide',  // 39 DE / 55 total
        'solarisbank',  // 34 DE / 34 total
        'dept',  // 23 DE / 229 total
        'remotecom',  // 23 DE / 193 total
        'formlabs',  // 17 DE / 191 total
        'caronsale',  // 16 DE / 16 total
        'hubspotjobs',  // 15 DE / 163 total
        'talonone',  // 13 DE / 19 total
        'superchat',  // 12 DE / 12 total
        'mozilla',  // 11 DE / 85 total
        'hive',  // 10 DE / 18 total
        'linkedinjobs',  // 10 DE / 16 total
        'ebury',  // 10 DE / 164 total
        'valtech',  // 10 DE / 135 total
        'marvelfusion',  // 10 DE / 12 total
        'toogoodtogo',  // 10 DE / 77 total
        'tide',  // 8 DE / 102 total
        'gigs',  // 7 DE / 39 total
        'spire',  // 7 DE / 48 total
        'flatironhealth',  // 6 DE / 36 total
        'ivalua',  // 5 DE / 40 total
        'cognite',  // 5 DE / 48 total
        'pandadoc',  // 5 DE / 55 total
        'ledgy',  // 4 DE / 22 total
        'samsara',  // 4 DE / 298 total
        'flexport',  // 4 DE / 153 total
        'forter',  // 4 DE / 40 total
        'rubrik',  // 4 DE / 106 total
        'vay',  // 4 DE / 11 total
        'relex',  // 3 DE / 36 total
        'gostudent',  // 3 DE / 24 total
        'chainguard',  // 3 DE / 71 total
        'wunderflats',  // 3 DE / 3 total
        'prophet',  // 3 DE / 27 total
        'agency',  // 2 DE / 821 total
        'newrelic',  // 2 DE / 51 total
        'temporaltechnologies',  // 2 DE / 56 total
        'sumologic',  // 2 DE / 21 total
        'anthropic',  // 2 DE / 393 total
        'urbansportsclub',  // 2 DE / 4 total
        'blacklane',  // 2 DE / 8 total
        'ecoworks',  // 2 DE / 2 total
        'oliver',  // 2 DE / 53 total
        'coalition',  // 2 DE / 30 total
        'singlestore',  // 1 DE / 37 total
        'shifttechnology',  // 1 DE / 29 total
        'mentimeter',  // 1 DE / 22 total
        'scandit',  // 1 DE / 15 total
        'mattermost',  // 1 DE / 12 total
        'traderepublic',  // 1 DE / 1 total
        'project44',  // 1 DE / 34 total
        'descope',  // 1 DE / 6 total
        'storyblok',  // 1 DE / 12 total
        'jamf',  // 1 DE / 39 total
        'postman',  // 1 DE / 106 total
        'solarwinds',  // 1 DE / 94 total
        'kayak',  // 1 DE / 1 total
        'playlist',  // 1 DE / 33 total
        'ireland',  // 1 DE / 12 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'artefact',  // 7 DE / 126 total
        'gallup',  // 6 DE / 54 total
        'goodman',  // 6 DE / 35 total
        'onemedical',  // 6 DE / 333 total
        'quince',  // 5 DE / 148 total
        'mullins',  // 5 DE / 82 total
        'tulip',  // 5 DE / 68 total
        'braineffectjobs',  // 5 DE / 5 total
        'eucalyptus',  // 4 DE / 109 total
        'asm',  // 3 DE / 425 total
        'octagon',  // 2 DE / 12 total
        'berlinbrands',  // 2 DE / 12 total
        'equipmentsharecom',  // 2 DE / 993 total
        'monks',  // 1 DE / 349 total
        'fetch',  // 1 DE / 53 total
        'fender',  // 1 DE / 37 total
        'airship',  // 1 DE / 18 total
        'staged',  // 1 DE / 5 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'spektrum',  // 3 DE / 173 total
        'flipp',  // 2 DE / 11 total
        'janes',  // 1 DE / 10 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'teampicnic',  // 154 DE / 313 total
        'wppmedia',  // 132 DE / 1202 total
        'speechify',  // 30 DE / 1302 total
        'alixpartners',  // 25 DE / 112 total
        'cfoinsights',  // 20 DE / 303 total
        'ionos2',  // 20 DE / 33 total
        'veeamsoftware',  // 15 DE / 232 total
        'blackforestlabs',  // 12 DE / 13 total
        'emnify',  // 11 DE / 14 total
        'auterion',  // 9 DE / 20 total
        'atolls',  // 9 DE / 21 total
        'dkbcodefactory',  // 7 DE / 22 total
        'headborneai',  // 4 DE / 5 total
        'verifone',  // 3 DE / 44 total
        'airup',  // 3 DE / 3 total
        'stackadapt',  // 3 DE / 92 total
        'boxinc',  // 1 DE / 128 total
        'unframe',  // 1 DE / 34 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'forvismazars',  // 334 DE / 336 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'andurilindustries',  // 1 DE / 2171 total
        // --- GERMAN EXPANSION 2026-08-05 ---
        // Verified: board reachable AND >=1 job located in Germany.
        'intersystems',  // 4 DE / 143 total
],

    // Internal state
    _currentBoardIndex: 0,
    _allJobsQueue: [],
    _initialized: false,

    // Fetch all jobs from all boards upfront
    async initialize() {
        if (this._initialized) return;

        console.log(`[Greenhouse] Fetching jobs from ${this.companyBoardTokens.length} companies...`);

        let successCount = 0;
        let failCount = 0;

        for (const boardToken of this.companyBoardTokens) {
            try {
                const url = `${this.baseUrl}/${boardToken}/jobs?content=true`;
                const response = await fetch(url);

                if (!response.ok) {
                    failCount++;
                    // Only log if you want to see failures (comment out to reduce noise)
                    // console.log(`[Greenhouse] ? ${boardToken}: ${response.status}`);
                    continue;
                }

                const data = await response.json();

                if (!data.jobs || data.jobs.length === 0) {
                    continue;
                }

                // Filter for Germany and add board token
                const germanyJobs = data.jobs
                    .filter(job => {
                        const location = job.location?.name || '';
                        return this.isGermanyLocation(location);
                    })
                    .map(job => ({
                        ...job,
                        _boardToken: boardToken
                    }));

                if (germanyJobs.length > 0) {
                    console.log(`[Greenhouse] ✅ ${boardToken}: ${germanyJobs.length} jobs in Germany (${data.jobs.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    successCount++;
                }

                // Rate limit: wait 500ms between companies
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failCount++;
                console.error(`[Greenhouse] ? ${boardToken}: ${error.message}`);
            }
        }

        console.log(`[Greenhouse] ? Summary: ${successCount} companies with Germany jobs, ${failCount} failed/empty`);
        console.log(`[Greenhouse] ?? Total jobs found: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },

    // Fetch jobs page (required by scraperEngine)
    async fetchPage(offset, limit) {
        // Initialize on first call
        if (!this._initialized) {
            await this.initialize();
        }

        // Return paginated chunk
        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    // Required by scraperEngine
    getJobs(data) {
        return data.jobs || [];
    },

    // Get total (for pagination)
    getTotal(data) {
        return data.total || 0;
    },

    // Extract job ID
    extractJobID(job) {
        return `greenhouse_${job._boardToken}_${job.id}`;
    },

    // Extract job title
    extractJobTitle(job) {
        return job.title;
    },

    // Extract company name
    extractCompany(job) {
        const boardToken = job._boardToken;

        // Try to get from metadata
        if (job.metadata && job.metadata.length > 0) {
            const companyField = job.metadata.find(m => m.name.toLowerCase().includes('company'));
            if (companyField) return companyField.value;
        }

        // Format board token to readable name
        return boardToken
            .split(/[-_]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    },

    // Extract location
    extractLocation(job) {
        return job.location?.name || 'Germany';
    },

    // Extract description
    extractDescription(job) {
        return StripHtml(job.content || '');
    },

    extractDescriptionHtml(job) {
        return SanitizeHtml(job.content || '');
    },

    // Extract URL
    extractURL(job) {
        return job.absolute_url;
    },

    // Extract posted date
    extractPostedDate(job) {
        return job.updated_at;
    },

    extractDepartment(job) {
        const fromDepartments = Array.isArray(job.departments) && job.departments.length > 0 ? job.departments[0]?.name : null;
        if (fromDepartments) return fromDepartments;
        const metadata = metadataToObject(job.metadata);
        return findMetadataValue(metadata, ['department', 'team']) || 'N/A';
    },

    extractTeam(job) {
        const metadata = metadataToObject(job.metadata);
        return findMetadataValue(metadata, ['team']) || null;
    },

    extractOffice(job) {
        return Array.isArray(job.offices) && job.offices.length > 0 ? job.offices[0]?.name || null : null;
    },

    extractAllLocations(job) {
        const officeLocations = (job.offices || []).map(office => office?.location).filter(Boolean);
        return normalizeArray([job.location?.name, ...officeLocations]);
    },

    extractCountry(job) {
        const allLocations = this.extractAllLocations(job).join(' ').toLowerCase();
        if (allLocations.includes('germany') || allLocations.includes('deutschland')) return 'DE';
        return null;
    },

    extractEmploymentType(job) {
        const metadata = metadataToObject(job.metadata);
        const value = findMetadataValue(metadata, ['employment', 'contract', 'time']);
        return normalizeEmploymentType(value);
    },

    extractWorkplaceType(job) {
        return 'Unspecified';
    },

    extractIsRemote(job) {
        return false;
    },

    extractTags(job) {
        const metadata = metadataToObject(job.metadata);
        const tags = [];
        for (const [key, value] of Object.entries(metadata)) {
            if (!value) continue;
            if (Array.isArray(value)) {
                tags.push(...value.map(v => `${key}:${v}`));
            } else {
                tags.push(`${key}:${value}`);
            }
        }
        return normalizeArray(tags);
    },

    extractDirectApplyURL() {
        return null;
    },

    extractSalaryCurrency(job) {
        const fromContent = parseSalaryFromText(job.content || '');
        if (fromContent.SalaryCurrency) return fromContent.SalaryCurrency;
        const metadata = metadataToObject(job.metadata);
        return findMetadataValue(metadata, ['currency']) || null;
    },

    extractSalaryMin(job) {
        const fromContent = parseSalaryFromText(job.content || '');
        if (Number.isFinite(fromContent.SalaryMin)) return fromContent.SalaryMin;
        const metadata = metadataToObject(job.metadata);
        const val = Number(findMetadataValue(metadata, ['salary min', 'min salary', 'minimum salary', 'comp min']));
        return Number.isFinite(val) ? val : null;
    },

    extractSalaryMax(job) {
        const fromContent = parseSalaryFromText(job.content || '');
        if (Number.isFinite(fromContent.SalaryMax)) return fromContent.SalaryMax;
        const metadata = metadataToObject(job.metadata);
        const val = Number(findMetadataValue(metadata, ['salary max', 'max salary', 'maximum salary', 'comp max']));
        return Number.isFinite(val) ? val : null;
    },

    extractSalaryInterval(job) {
        const fromContent = parseSalaryFromText(job.content || '');
        if (fromContent.SalaryInterval) return fromContent.SalaryInterval;
        const metadata = metadataToObject(job.metadata);
        const raw = findMetadataValue(metadata, ['salary interval', 'interval']);
        if (!raw) return null;
        const lower = String(raw).toLowerCase();
        if (lower.includes('hour')) return 'per-hour-wage';
        if (lower.includes('month')) return 'per-month-salary';
        if (lower.includes('year')) return 'per-year-salary';
        return null;
    },

    extractATSPlatform() {
        return 'greenhouse';
    },

    // Check if location is in Germany � delegates to shared isGermanyString() helper
    isGermanyLocation(location) {
        return isGermanyString(location);
    }
};
