import fetch from 'node-fetch';
import {StripHtml} from '../utils.js'

function normalizeArray(values) {
    return [...new Set((values || []).filter(Boolean).map(v => String(v).trim()).filter(Boolean))];
}

function normalizeWorkplaceType(value) {
    if (!value) return 'Unspecified';
    if (value === 'OnSite') return 'Onsite';
    if (value === 'Remote') return 'Remote';
    if (value === 'Hybrid') return 'Hybrid';
    const lower = String(value).toLowerCase();
    if (lower.includes('remote')) return 'Remote';
    if (lower.includes('hybrid')) return 'Hybrid';
    if (lower.includes('onsite') || lower.includes('on-site')) return 'Onsite';
    return 'Unspecified';
}

function normalizeCountry(value) {
    if (!value) return null;
    const cleaned = String(value).trim();
    const lower = cleaned.toLowerCase();
    if (lower === 'germany' || lower === 'deutschland') return 'DE';
    if (cleaned.length === 2) return cleaned.toUpperCase();
    return cleaned;
}

function findCompensationComponent(job, typeName) {
    const summaryComponents = job?.compensation?.summaryComponents || [];
    const tierComponents = (job?.compensation?.compensationTiers || []).flatMap(tier => tier.components || []);
    const all = [...summaryComponents, ...tierComponents];
    return all.find(component => String(component?.compensationType || '').toLowerCase() === String(typeName).toLowerCase()) || null;
}

export const ashbyConfig = {
    siteName: "Ashby Jobs",
    baseUrl: "https://api.ashbyhq.com/posting-api/job-board",
    
    // ✅ VERIFIED WORKING COMPANIES (with Germany jobs potential)
    companyBoardNames: [
        // Companies confirmed to have Germany jobs
        // 'Ashby',
        // 'Deel',
        // 'OpenAI',
        // 'Cohere',
        // 'Linear',
        // 'Notion',
        // 'Ramp',
        // 'Mercury',
        // 'Lattice',
        // 'Supabase',
        // 'Vercel',
        // 'Replit',
        // 'Cal',
        // 'Modal',
        // 'Sourcegraph',
        // 'Grammarly',
        // 'Scale',
        // 'Hugging-Face',
        // 'Weights-Biases',
        // 'dbt-labs',
        // 'Replicate',
        // 'Together',
        // 'Perplexity',
        // 'Cursor',
        // 'Anthropic',
        // 'Mistral',
        // 'Stability',
        // 'Adept',
        // 'Character',
        // 'Inflection',
        // 'Personio',
        // 'Contentful',
        'Celonis',
        'Taxfix',
        'Raisin',
        'N26',
        // 'Trade-Republic',
        // 'Sennder',
        // 'Adjust',
        // 'GetYourGuide',
        // 'Delivery-Hero',
        // 'Auto1',
        // 'Zalando',
        // 'HelloFresh',
        // 'Rocket-Internet',
        // // --- BEGIN APPENDED ENTRIES ---
        // 'moss','upvest','deepl','amboss','bunch','leapsome','carwow','rohlik','pleo','lemon-markets','forto','billie','alephalpha','docker','babbel','mollie','cosmos','rasa','airwallex','redis','uipath','deliveroo','camunda','enpal','neon','langchain','kestra','voodoo',
        // // --- END APPENDED ENTRIES ---
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
                    // console.log(`[Ashby] ❌ ${boardName}: ${response.status}`);
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
                    console.log(`[Ashby] ✅ ${boardName}: ${germanyJobs.length} jobs in Germany (${data.jobs.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    successCount++;
                }
                
                // Rate limit: 300ms between companies
                await new Promise(resolve => setTimeout(resolve, 300));
                
            } catch (error) {
                failCount++;
                console.error(`[Ashby] ❌ ${boardName}: ${error.message}`);
            }
        }
        
        console.log(`[Ashby] ✅ Summary: ${successCount} companies with Germany jobs, ${failCount} failed/empty`);
        console.log(`[Ashby] 📊 Total jobs found: ${this._allJobsQueue.length}`);
        this._initialized = true;
    },
    
    // Check if job has Germany location
    hasGermanyLocation(job) {
        const germanCities = [
            'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln',
            'stuttgart', 'düsseldorf', 'dortmund', 'essen', 'leipzig', 'bremen',
            'dresden', 'hanover', 'hannover', 'nuremberg', 'nürnberg', 'duisburg',
            'bochum', 'wuppertal', 'bielefeld', 'bonn', 'münster', 'karlsruhe',
            'mannheim', 'augsburg', 'wiesbaden', 'gelsenkirchen', 'mönchengladbach',
            'braunschweig', 'chemnitz', 'kiel', 'aachen', 'halle', 'magdeburg',
            'freiburg', 'krefeld', 'lübeck', 'erfurt', 'mainz', 'rostock'
        ];
        
        // Check primary location
        if (job.location) {
            const locationLower = job.location.toLowerCase();
            if (locationLower.includes('germany') || 
                locationLower.includes('deutschland') ||
                germanCities.some(city => locationLower.includes(city))) {
                return true;
            }
        }
        
        // Check address
        if (job.address?.postalAddress?.addressCountry) {
            const country = job.address.postalAddress.addressCountry.toLowerCase();
            if (country.includes('germany') || country.includes('deutschland') || country === 'de' || country === 'deu') {
                return true;
            }
        }
        
        // Check secondary locations
        if (job.secondaryLocations && job.secondaryLocations.length > 0) {
            for (const secLoc of job.secondaryLocations) {
                if (secLoc.location) {
                    const locLower = secLoc.location.toLowerCase();
                    if (locLower.includes('germany') || 
                        locLower.includes('deutschland') ||
                        germanCities.some(city => locLower.includes(city))) {
                        return true;
                    }
                }
                if (secLoc.address?.addressCountry) {
                    const country = secLoc.address.addressCountry.toLowerCase();
                    if (country.includes('germany') || country.includes('deutschland') || country === 'de' || country === 'deu') {
                        return true;
                    }
                }
            }
        }
        
        // Check if remote is allowed AND location contains "Remote"
        if (job.isRemote && job.location) {
            const locationLower = job.location.toLowerCase();
            // Only consider as Germany if explicitly mentions Germany with Remote
            if ((locationLower.includes('germany') || locationLower.includes('deutschland')) && 
                locationLower.includes('remote')) {
                return true;
            }
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
    
    // Helper to check if a location string is Germany-related
    isGermanyString(locationStr) {
        const germanCities = [
            'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln',
            'stuttgart', 'düsseldorf', 'dortmund', 'essen', 'leipzig', 'bremen',
            'dresden', 'hanover', 'hannover', 'nuremberg', 'nürnberg'
        ];
        
        const locLower = locationStr.toLowerCase();
        return locLower.includes('germany') || 
               locLower.includes('deutschland') ||
               germanCities.some(city => locLower.includes(city));
    },
    
    // Extract description
    extractDescription(job) {
        // Prefer plain text, fallback to HTML
        return StripHtml(job.descriptionPlain || job.descriptionHtml || '');
    },
    
    // Extract URL
    extractURL(job) {
        return job.jobUrl || job.applyUrl ;
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
        const value = String(job.employmentType || '').toLowerCase();
        if (value.includes('full')) return 'FullTime';
        if (value.includes('part')) return 'PartTime';
        if (value.includes('contract')) return 'Contract';
        if (value.includes('intern')) return 'Intern';
        return null;
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