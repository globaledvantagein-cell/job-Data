import fetch from 'node-fetch';
import {StripHtml} from '../utils.js';

function normalizeArray(values) {
    return [...new Set((values || []).filter(Boolean).map(v => String(v).trim()).filter(Boolean))];
}

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

function parseSalaryFromText(text) {
    if (!text) return {};
    const cleaned = StripHtml(text).replace(/\./g, '').replace(/,/g, '.');

    const currencyMatch = cleaned.match(/(USD|EUR|GBP|CHF|CAD|AUD|JPY|SEK|NOK|DKK|PLN)/i);
    const symbolMatch = cleaned.match(/[€$£]/);
    const rangeMatch = cleaned.match(/(\d{2,7}(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d{2,7}(?:\.\d+)?)/i);

    let salaryCurrency = null;
    if (currencyMatch) {
        salaryCurrency = currencyMatch[1].toUpperCase();
    } else if (symbolMatch) {
        if (symbolMatch[0] === '€') salaryCurrency = 'EUR';
        if (symbolMatch[0] === '$') salaryCurrency = 'USD';
        if (symbolMatch[0] === '£') salaryCurrency = 'GBP';
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
        // ✅ WORKING TOKENS (verified)
        'airbnb',
        'stripe',
        'figma',
        'airtable',
        'gitlab',
        'reddit',
        'pinterest',
        'twitch',
        
        // ✅ ADDITIONAL WORKING TOKENS (tech companies with Germany jobs)
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
        
        // ✅ More tech companies (may or may not have Germany jobs)
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
                    // console.log(`[Greenhouse] ❌ ${boardToken}: ${response.status}`);
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
                console.error(`[Greenhouse] ❌ ${boardToken}: ${error.message}`);
            }
        }
        
        console.log(`[Greenhouse] ✅ Summary: ${successCount} companies with Germany jobs, ${failCount} failed/empty`);
        console.log(`[Greenhouse] 📊 Total jobs found: ${this._allJobsQueue.length}`);
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
        return inferEmploymentType(value);
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
    
    // Check if location is in Germany
    isGermanyLocation(location) {
        const germanCities = [
            'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln',
            'stuttgart', 'düsseldorf', 'dortmund', 'essen', 'leipzig', 'bremen',
            'dresden', 'hanover', 'hannover', 'nuremberg', 'nürnberg', 'duisburg',
            'bochum', 'wuppertal', 'bielefeld', 'bonn', 'münster', 'karlsruhe',
            'mannheim', 'augsburg', 'wiesbaden', 'gelsenkirchen', 'mönchengladbach',
            'braunschweig', 'chemnitz', 'kiel', 'aachen', 'halle', 'magdeburg',
            'freiburg', 'krefeld', 'lübeck', 'erfurt', 'mainz', 'rostock'
        ];
        
        const locationLower = location.toLowerCase();
        
        // Check for Germany or DE
        if (locationLower.includes('germany') || 
            locationLower.includes('deutschland') || 
            locationLower.match(/\bde\b/)) {
            return true;
        }
        
        // Check for German cities
        return germanCities.some(city => locationLower.includes(city));
    }
};