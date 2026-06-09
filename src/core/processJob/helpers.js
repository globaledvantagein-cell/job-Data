import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { AbortController } from 'abort-controller';
import { GERMAN_CITIES_CHECK, SanitizeHtml } from '../../utils.js';

/**
 * Fetch a job's HTML page and pull description text out of it using
 * the site config's CSS selector. Falls back gracefully on errors.
 */
export async function scrapeJobDetailsFromPage(mappedJob, siteConfig) {
    console.log(`[${siteConfig.siteName}] Visiting job page: ${mappedJob.ApplicationURL}`);
    const pageController = new AbortController();
    const pageTimeoutId = setTimeout(() => pageController.abort(), 30000);
    try {
        const jobPageRes = await fetch(mappedJob.ApplicationURL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'text/html,application/xhtml+xml',
            },
            signal: pageController.signal
        });
        const html = await jobPageRes.text();
        const dom = new JSDOM(html);
        const document = dom.window.document;
        if (siteConfig.descriptionSelector) {
            const descriptionElement = document.querySelector(siteConfig.descriptionSelector);
            if (descriptionElement) {
                mappedJob.Description = descriptionElement.textContent.replace(/\s+/g, ' ').trim();
                mappedJob.DescriptionHtml = SanitizeHtml(descriptionElement.innerHTML);
            }
        }
    } catch (error) {
        console.error(`[Scrape Error] ${error.message}`);
    } finally {
        clearTimeout(pageTimeoutId);
    }
    return mappedJob;
}

/**
 * Normalize a job's stored Location field. Picks the German city/region
 * from Location + AllLocations and formats it as "City, Germany".
 * Falls back to "Remote, Germany" / "Germany" when no specific city found.
 */
export function normalizeStoredLocation(mappedJob) {
    const allLocs = [
        mappedJob.Location || '',
        ...(mappedJob.AllLocations || [])
    ];

    const germanyLocs = allLocs.filter(loc => {
        const lower = String(loc).toLowerCase();
        if (lower.includes('germany') || lower.includes('deutschland')) return true;
        return GERMAN_CITIES_CHECK.some(city => lower.includes(city));
    });

    for (const loc of germanyLocs) {
        const cleaned = loc.replace(/\s*[-–—]\s*(Office|Hybrid|Remote|On-?site|Onsite)\s*$/i, '');
        const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);

        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower === 'germany' || lower === 'deutschland') continue;
            if (GERMAN_CITIES_CHECK.some(city => lower.includes(city))) {
                const cityName = part.split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    .join(' ');
                return `${cityName}, Germany`;
            }
        }
    }

    const hasRemoteGermany = germanyLocs.some(loc => loc.toLowerCase().includes('remote'));
    if (hasRemoteGermany || mappedJob.IsRemote) return 'Remote, Germany';

    if (germanyLocs.length > 0) return 'Germany';

    if (mappedJob.Location) {
        const parts = mappedJob.Location.split(',').map(p => p.trim()).filter(Boolean);
        const unique = [];
        for (const part of parts) {
            if (!unique.some(u => u.toLowerCase() === part.toLowerCase())) {
                unique.push(part);
            }
        }
        return unique.join(', ');
    }

    return 'Germany';
}
