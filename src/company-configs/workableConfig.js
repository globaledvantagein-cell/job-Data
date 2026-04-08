import fetch from 'node-fetch';
import { StripHtml } from '../utils.js';
import { normalizeWorkplaceType, normalizeEmploymentType } from '../core/locationPrefilters.js';
import { normalizeArray } from '../core/jobExtractor.js';

// Workable-specific: maps experience keywords to ExperienceLevel enum
function normalizeExperienceLevel(value) {
    if (!value) return null;
    const lower = String(value).toLowerCase();
    if (lower.includes('director') || lower.includes('vp') || lower.includes('executive') || lower.includes('c-level')) return 'Lead';
    if (lower.includes('senior') || lower.includes('sr') || lower.includes('principal') || lower.includes('staff') || lower.includes('lead')) return 'Senior';
    if (lower.includes('junior') || lower.includes('jr') || lower.includes('entry') || lower.includes('graduate') || lower.includes('intern')) return 'Entry';
    if (lower.includes('mid') || lower.includes('intermediate') || lower.includes('manager')) return 'Mid';
    return 'Mid';
}

// ─── Pagination & Fetching ─────────────────────────────────────────────────────
// The old per-company API (www.workable.com/api/accounts/{slug}) is dead — it
// returns 302 → apply.workable.com which serves 0 jobs or 404s.
//
// The working API is jobs.workable.com/api/v1/jobs which is a search/aggregator
// endpoint. We query it with location=Germany to get ALL Workable Germany jobs
// in one go, paginated via nextPageToken.
// ────────────────────────────────────────────────────────────────────────────────

const API_BASE = 'https://jobs.workable.com/api/v1/jobs';
const PAGE_SIZE = 100;
const MAX_PAGES = 8; // Safety cap: 100 × 8 = 800 jobs max per scrape run

// ─── Config export ─────────────────────────────────────────────────────────────

export const workableConfig = {
    siteName: 'Workable Jobs',
    limit: 20,
    _allJobsQueue: [],
    _initialized: false,
    needsDescriptionScraping: false, // description comes from the API response

    // ── Pre-fetch phase: paginate the Germany search API ────────────────────────
    async initialize() {
        if (this._initialized) return;

        this._allJobsQueue = [];

        console.log(`[Workable] Fetching Germany jobs from jobs.workable.com API...`);

        let pageToken = null;
        let totalFetched = 0;
        let pageCount = 0;

        try {
            do {
                const params = new URLSearchParams({
                    location: 'Germany',
                    limit: String(PAGE_SIZE),
                });
                if (pageToken) params.set('pageToken', pageToken);

                const url = `${API_BASE}?${params.toString()}`;

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 20000);

                const res = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!res.ok) {
                    console.log(`[Workable] ❌ API returned HTTP ${res.status} — stopping pagination`);
                    break;
                }

                const data = await res.json();
                const jobs = data.jobs || [];

                if (jobs.length === 0) break;

                this._allJobsQueue.push(...jobs);
                totalFetched += jobs.length;
                pageCount++;
                pageToken = data.nextPageToken || null;

                console.log(`[Workable] Page ${pageCount}: ${jobs.length} jobs (${totalFetched} total so far)`);

                // Polite delay between pages
                if (pageToken) {
                    await new Promise(r => setTimeout(r, 500));
                }

            } while (pageToken && pageCount < MAX_PAGES);

        } catch (err) {
            console.log(`[Workable] ❌ Fetch error: ${err.message}`);
        }

        console.log(`[Workable] ✅ Done: ${totalFetched} Germany jobs queued from ${pageCount} page(s)`);

        // Group and log jobs by company to mimic Greenhouse output
        if (this._allJobsQueue.length > 0) {
            const companyCounts = {};
            for (const job of this._allJobsQueue) {
                const comp = job.company?.title || 'Unknown';
                companyCounts[comp] = (companyCounts[comp] || 0) + 1;
            }

            const companies = Object.entries(companyCounts).sort((a, b) => b[1] - a[1]);
            for (let i = 0; i < companies.length; i++) {
                if (i < 15) {
                    console.log(`[Workable] \u2705 ${companies[i][0]}: ${companies[i][1]} jobs in Germany`);
                }
            }
            if (companies.length > 15) {
                console.log(`[Workable] ... and ${companies.length - 15} more companies.`);
            }
        }

        this._initialized = true;
    },

    // ── Called by network.js ───────────────────────────────────────────────────
    async fetchPage(offset, limit) {
        if (!this._initialized) await this.initialize();
        const jobs = this._allJobsQueue.slice(offset, offset + limit);
        return { jobs, total: this._allJobsQueue.length };
    },

    getJobs(data) { return data.jobs || []; },
    getTotal(data) { return data.total || 0; },

    // ── Field extractors ───────────────────────────────────────────────────────
    // The jobs.workable.com API returns objects with this shape:
    //   { id, title, state, description, employmentType, benefitsSection,
    //     requirementsSection, url, language, locations, location { city,
    //     subregion, countryName }, created, updated, company { id, title,
    //     website, image, description, url }, workplace, department }

    extractJobID(job) {
        // UUID from the API — guaranteed unique
        return `workable_${job.id}`;
    },

    extractJobTitle(job) {
        return job.title || '';
    },

    extractCompany(job) {
        return job.company?.title || '';
    },

    extractLocation(job) {
        // Build "City, Country" from the structured location object
        const parts = [
            job.location?.city,
            job.location?.countryName,
        ].filter(Boolean);
        return parts.join(', ') || 'Germany';
    },

    extractAllLocations(job) {
        // `locations` is an array of full location strings like "Berlin, Berlin, Germany"
        if (Array.isArray(job.locations) && job.locations.length > 0) {
            return normalizeArray(job.locations);
        }
        const loc = [job.location?.city, job.location?.countryName].filter(Boolean).join(', ');
        return normalizeArray([loc]);
    },

    extractDepartment(job) {
        return job.department || null;
    },

    extractDescription(job) {
        // Combine description + requirements + benefits (all are HTML)
        const parts = [
            job.description || '',
            job.requirementsSection || '',
            job.benefitsSection || '',
        ].filter(Boolean);
        return StripHtml(parts.join('\n'));
    },

    extractURL(job) {
        return job.url || null;
    },

    extractDirectApplyURL(job) {
        // The jobs.workable.com URL is the listing — same as apply URL
        return job.url || null;
    },

    extractPostedDate(job) {
        return job.created ? new Date(job.created) : null;
    },

    extractCountry(job) {
        const country = job.location?.countryName;
        if (!country) return null;
        const lower = country.trim().toLowerCase();
        if (lower === 'germany' || lower === 'deutschland') return 'DE';
        return country;
    },

    extractWorkplaceType(job) {
        return normalizeWorkplaceType(job.workplace);
    },

    extractIsRemote(job) {
        return String(job.workplace || '').toLowerCase() === 'remote';
    },

    extractEmploymentType(job) {
        return normalizeEmploymentType(job.employmentType);
    },

    extractExperienceLevel(job) {
        // The search API doesn't have an experience field — let processor derive from title
        return null;
    },

    extractIsEntryLevel(job) {
        // Let processor derive from title
        return null;
    },

    extractOffice(job) {
        return job.location?.city || null;
    },

    extractATSPlatform() {
        return 'workable';
    },

    extractTags(job) {
        return normalizeArray([
            job.department,
            job.employmentType,
            job.workplace ? `Workplace: ${job.workplace}` : null,
        ]);
    },

    // No salary fields in the Workable public search API
    extractSalaryCurrency() { return null; },
    extractSalaryMin() { return null; },
    extractSalaryMax() { return null; },
    extractSalaryInterval() { return null; },

    // No team field in Workable
    extractTeam() { return null; },
};