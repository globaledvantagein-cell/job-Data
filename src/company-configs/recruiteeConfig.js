import fetch from 'node-fetch';
import { StripHtml } from '../utils.js';
import { GERMAN_CITIES } from '../core/Locationprefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';


// --- Helpers ------------------------------------------------------------------

// NOTE: normalizeWorkplaceType here takes a JOB OBJECT (not a string) — Recruitee
// uses boolean flags (job.remote, job.hybrid, job.on_site), not a string field.
// This is intentionally different from the shared string-based normalizeWorkplaceType.

function normalizeWorkplaceType(job) {
    // Recruitee gives three explicit boolean flags
    const isRemote = Boolean(job.remote);
    const isHybrid = Boolean(job.hybrid);
    const isOnSite = Boolean(job.on_site);

    // Priority: Remote > Hybrid > Onsite > Unspecified
    if (isRemote && !isOnSite && !isHybrid) return 'Remote';
    if (isHybrid) return 'Hybrid';
    if (isRemote) return 'Remote'; // remote + on_site = still prefer Remote tag
    if (isOnSite) return 'Onsite';
    return 'Unspecified';
}

function mapEmploymentType(code) {
    if (!code) return null;
    const lower = String(code).toLowerCase();
    if (lower === 'fulltime' || lower === 'full_time' || lower.includes('full')) return 'FullTime';
    if (lower === 'parttime' || lower === 'part_time' || lower.includes('part')) return 'PartTime';
    if (lower === 'contract' || lower.includes('contract')) return 'Contract';
    if (lower === 'internship' || lower.includes('intern')) return 'Intern';
    if (lower === 'temporary' || lower.includes('temp')) return 'Temporary';
    if (lower === 'freelance') return 'Contract';
    if (lower === 'volunteer') return null;
    return null;
}

function mapExperienceLevel(code) {
    if (!code) return null;
    const lower = String(code).toLowerCase();
    if (lower.includes('entry') || lower.includes('junior') || lower.includes('intern') || lower.includes('associate')) return 'Entry';
    if (lower.includes('mid') || lower.includes('intermediate') || lower.includes('regular')) return 'Mid';
    if (lower.includes('senior') || lower.includes('experienced') || lower.includes('expert')) return 'Senior';
    if (lower.includes('executive') || lower.includes('director') || lower.includes('lead') || lower.includes('principal') || lower.includes('vp')) return 'Lead';
    if (lower.includes('staff') || lower.includes('distinguished')) return 'Staff';
    if (lower.includes('not_applicable') || lower.includes('not applicable')) return null;
    return null;
}

function mapContractType(employmentTypeCode, minHours, maxHours) {
    if (!employmentTypeCode) return 'N/A';
    const lower = String(employmentTypeCode).toLowerCase();
    if (lower === 'fulltime' || lower === 'full_time') return 'Full-time';
    if (lower === 'parttime' || lower === 'part_time') {
        if (minHours && maxHours) return `Part-time (${minHours}-${maxHours}h/week)`;
        return 'Part-time';
    }
    if (lower === 'contract') return 'Contract';
    if (lower === 'internship') return 'Internship';
    if (lower === 'temporary') return 'Temporary';
    if (lower === 'freelance') return 'Freelance';
    return 'N/A';
}




/**
 * Checks if a job has at least one Germany location.
 *
 * Uses both:
 *   - The `locations` array (from the list endpoint) which has structured city/country/country_code
 *   - The flat `city`, `country`, `country_code` fields (from the detail endpoint)
 *   - The `location` string field
 */
function hasGermanyLocation(job) {
    // 1. Check structured locations array (list endpoint)
    if (Array.isArray(job.locations) && job.locations.length > 0) {
        for (const loc of job.locations) {
            // Most reliable: country_code
            if (loc.country_code && String(loc.country_code).toUpperCase() === 'DE') return true;

            // Fallback: country name
            const country = String(loc.country || '').toLowerCase();
            if (country === 'germany' || country === 'deutschland') return true;

            // Fallback: city name
            const city = String(loc.city || '').toLowerCase();
            if (GERMAN_CITIES.some(gc => city.includes(gc))) return true;
        }
    }

    // 2. Check flat country_code field (detail endpoint / some list responses)
    if (job.country_code && String(job.country_code).toUpperCase() === 'DE') return true;

    // 3. Check flat country field
    const country = String(job.country || '').toLowerCase();
    if (country === 'germany' || country === 'deutschland') return true;

    // 4. Check flat city field against German cities
    const city = String(job.city || '').toLowerCase();
    if (city && GERMAN_CITIES.some(gc => city.includes(gc))) return true;

    // 5. Check location string field
    const locationStr = String(job.location || '').toLowerCase();
    if (locationStr.includes('germany') || locationStr.includes('deutschland')) return true;
    if (GERMAN_CITIES.some(gc => locationStr.includes(gc))) return true;

    return false;
}

// --- Company subdomain list ---------------------------------------------------
//
// Recruitee Careers Site API:  GET https://{subdomain}.recruitee.com/api/offers/
// No auth key needed — completely free public API.
//
// To find a company's subdomain:
//   1. Visit their careers page
//   2. If it redirects to {something}.recruitee.com, the subdomain is {something}
//   3. Or check job listing URLs — they contain the subdomain
//
// Add new companies here as you discover them.

const companySubdomains = [
    // -- Auto-discovered 2026-04-02 --
    'limehome',                    // limehome — 11 DE / 14 total
    // 'sharpist',                    // Sharpist GmbH — 6 DE / 6 total
    // 'masterplan',                  // Masterplan — 4 DE / 4 total
    // 'ginmon',                      // Ginmon GmbH — 3 DE / 3 total
    // 'rebuy',                       // rebuy — 3 DE / 3 total
    // 'channable',                   // Channable — 3 DE / 15 total
    // 'companisto',                  // Companisto GmbH — 2 DE / 2 total
    // 'effectory',                   // Effectory — 2 DE / 8 total
    // 'personio',                    // FD Sandbox — 1 DE / 1 total
    // 'jobs',                        // Tellent — 1 DE / 7 total
];

// --- Config export -------------------------------------------------------------

export const recruiteeConfig = {
    siteName: 'Recruitee Jobs',
    limit: 20,
    _allJobsQueue: [],
    _initialized: false,
    needsDescriptionScraping: false, // List endpoint returns full description + requirements

    // -- Pre-fetch: hit every company subdomain, filter to Germany --------------
    async initialize() {
        if (this._initialized) return;

        this._allJobsQueue = [];

        console.log(`[Recruitee] Fetching jobs from ${companySubdomains.length} companies...`);

        let successCount = 0;
        let failCount = 0;
        let germanyJobsTotal = 0;

        for (const subdomain of companySubdomains) {
            try {
                const url = `https://${subdomain}.recruitee.com/api/offers/`;

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 20000);

                const res = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!res.ok) {
                    failCount++;
                    continue;
                }

                const data = await res.json();
                const allOffers = data.offers || [];

                if (allOffers.length === 0) continue;

                // Filter for published + Germany
                const germanyJobs = allOffers
                    .filter(offer => {
                        // Only published offers
                        if (offer.status && offer.status !== 'published') return false;
                        return hasGermanyLocation(offer);
                    })
                    .map(offer => ({
                        ...offer,
                        _subdomain: subdomain,
                    }));

                if (germanyJobs.length > 0) {
                    console.log(`[Recruitee] ? ${subdomain}: ${germanyJobs.length} Germany jobs (${allOffers.length} total)`);
                    this._allJobsQueue.push(...germanyJobs);
                    germanyJobsTotal += germanyJobs.length;
                    successCount++;
                }

                // Polite delay between companies (300ms)
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                failCount++;
                // Only log non-abort errors
                if (error.name !== 'AbortError') {
                    console.error(`[Recruitee] ? ${subdomain}: ${error.message}`);
                }
            }
        }

        console.log(`[Recruitee] ? Summary: ${successCount} companies with Germany jobs, ${failCount} failed/empty`);
        console.log(`[Recruitee] ?? Total Germany jobs queued: ${germanyJobsTotal}`);
        this._initialized = true;
    },

    // -- Called by network.js (fetchJobsPage detects this method) ---------------
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

    // --- Field extractors (used by processor.js) ------------------------------

    extractJobID(job) {
        // slug is human-readable and unique per company; id is numeric and globally unique
        return `recruitee_${job._subdomain}_${job.id}`;
    },

    extractJobTitle(job) {
        return job.title || '';
    },

    extractCompany(job) {
        // Prefer the company_name field from the API
        if (job.company_name) return job.company_name;

        // Fallback: format subdomain as readable name
        return job._subdomain
            .replace(/[-_]/g, ' ')
            .replace(/\d+$/, '')                   // strip trailing numbers like "billie1"
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
            .trim();
    },

    extractLocation(job) {
        // Build from structured locations array (Germany ones only)
        if (Array.isArray(job.locations) && job.locations.length > 0) {
            const germanyLocs = job.locations.filter(loc => {
                if (loc.country_code && String(loc.country_code).toUpperCase() === 'DE') return true;
                const c = String(loc.country || '').toLowerCase();
                return c === 'germany' || c === 'deutschland';
            });

            const locsToUse = germanyLocs.length > 0 ? germanyLocs : job.locations;
            const parts = locsToUse.map(loc => {
                const city = loc.city || loc.name || '';
                const country = loc.country || '';
                return [city, country].filter(Boolean).join(', ');
            }).filter(Boolean);

            if (parts.length > 0) return parts.join('; ');
        }

        // Fallback: flat city + country fields
        const parts = [job.city, job.country].filter(Boolean);
        if (parts.length > 0) return parts.join(', ');

        // Fallback: location string
        if (job.location) return job.location;

        return 'Germany';
    },

    extractAllLocations(job) {
        const locations = [];

        // From structured locations array
        if (Array.isArray(job.locations)) {
            for (const loc of job.locations) {
                const parts = [loc.city, loc.country].filter(Boolean);
                if (parts.length > 0) locations.push(parts.join(', '));
                if (loc.name && !locations.includes(loc.name)) locations.push(loc.name);
            }
        }

        // From flat fields
        if (job.city) locations.push(job.city);
        if (job.location) locations.push(job.location);

        return normalizeArray(locations);
    },

    extractDescription(job) {
        // Combine description + requirements (both are HTML from the API)
        const parts = [
            job.description || '',
            job.requirements || '',
        ].filter(Boolean);

        return StripHtml(parts.join('\n'));
    },

    extractURL(job) {
        // careers_url is the public listing page
        return job.careers_url || null;
    },

    extractDirectApplyURL(job) {
        // careers_apply_url goes straight to the application form
        return job.careers_apply_url || null;
    },

    extractPostedDate(job) {
        return job.published_at || job.created_at || null;
    },

    extractDepartment(job) {
        return job.department || 'N/A';
    },

    extractTeam(job) {
        // Recruitee doesn't have a separate team field — department covers it
        return null;
    },

    extractOffice(job) {
        // First Germany location city
        if (Array.isArray(job.locations)) {
            for (const loc of job.locations) {
                if (loc.country_code && String(loc.country_code).toUpperCase() === 'DE') {
                    return loc.city || loc.name || null;
                }
            }
        }
        return job.city || null;
    },

    extractCountry(job) {
        // Check structured locations for Germany
        if (Array.isArray(job.locations)) {
            for (const loc of job.locations) {
                if (loc.country_code && String(loc.country_code).toUpperCase() === 'DE') return 'DE';
            }
        }
        if (job.country_code && String(job.country_code).toUpperCase() === 'DE') return 'DE';
        const country = String(job.country || '').toLowerCase();
        if (country === 'germany' || country === 'deutschland') return 'DE';
        return null;
    },

    extractWorkplaceType(job) {
        return normalizeWorkplaceType(job);
    },

    extractIsRemote(job) {
        return Boolean(job.remote);
    },

    extractEmploymentType(job) {
        return mapEmploymentType(job.employment_type_code);
    },

    extractExperienceLevel(job) {
        return mapExperienceLevel(job.experience_code);
    },

    extractIsEntryLevel(job) {
        const level = mapExperienceLevel(job.experience_code);
        return level === 'Entry';
    },

    extractTags(job) {
        const tags = [];

        // Recruitee tags array
        if (Array.isArray(job.tags)) {
            tags.push(...job.tags);
        }

        // Category code as a tag (e.g. "information_technology", "marketing")
        if (job.category_code) {
            tags.push(`Category: ${job.category_code.replace(/_/g, ' ')}`);
        }

        // Education code as a tag
        if (job.education_code && job.education_code !== 'not_applicable') {
            tags.push(`Education: ${job.education_code.replace(/_/g, ' ')}`);
        }

        // Hours info as a tag
        if (job.min_hours && job.max_hours) {
            tags.push(`${job.min_hours}-${job.max_hours}h/week`);
        }

        return normalizeArray(tags);
    },

    extractSalaryCurrency(job) {
        // The salary object structure from Recruitee (if present)
        if (job.salary && typeof job.salary === 'object') {
            return job.salary.currency || null;
        }
        return null;
    },

    extractSalaryMin(job) {
        if (job.salary && typeof job.salary === 'object') {
            const val = Number(job.salary.min);
            return Number.isFinite(val) && val > 0 ? val : null;
        }
        return null;
    },

    extractSalaryMax(job) {
        if (job.salary && typeof job.salary === 'object') {
            const val = Number(job.salary.max);
            return Number.isFinite(val) && val > 0 ? val : null;
        }
        return null;
    },

    extractSalaryInterval(job) {
        if (job.salary && typeof job.salary === 'object') {
            const period = String(job.salary.period || '').toLowerCase();
            if (period.includes('year') || period.includes('annual')) return 'per-year-salary';
            if (period.includes('month')) return 'per-month-salary';
            if (period.includes('hour')) return 'per-hour-wage';
            if (period) return 'per-year-salary'; // default assumption
        }
        return null;
    },

    extractATSPlatform() {
        return 'recruitee';
    },
};