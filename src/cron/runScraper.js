import { SITES_CONFIG } from '../config.js';
import { loadAllExistingIDs, deleteOldJobs } from '../db/index.js';
import { scrapeSite } from '../core/scraperEngine.js';
import { refreshJobsCache } from '../cache/index.js';
import { Analytics } from '../models/analyticsModel.js';

let isScraping = false;

export const runScraper = async function () {
    if (isScraping) {
        console.log('Scraper is already running. Skipping this scheduled run.');
        return;
    }
    isScraping = true;
    console.log("🚀 Starting scheduled scrape task...");

    try {
        // Track "Connected Sources" metric
        const totalSources = SITES_CONFIG.filter(s => s && s.siteName).length;
        await Analytics.setValue('connectedSources', totalSources);
        console.log(`📊 Analytics updated: ${totalSources} connected sources.`);

        const existingIDsMap = await loadAllExistingIDs();

        // Shared across ALL sites — detects same job posted by different legal entities
        // e.g., "Databricks GmbH" on Greenhouse and "Databricks Inc." on Ashby
        const crossEntityKeys = new Map();

        for (const siteConfig of SITES_CONFIG) {
            if (!siteConfig || !siteConfig.siteName) continue;

            const scrapeStartTime = new Date();
            const newJobs = await scrapeSite(siteConfig, existingIDsMap, crossEntityKeys);

            console.log(`[${siteConfig.siteName}] Found ${newJobs.length} new jobs.`);
            await deleteOldJobs(siteConfig.siteName, scrapeStartTime);
        }

        console.log("\n✅ All scraping complete.");

        // ── Refresh the RAM cache so newly approved jobs appear ──────
        // (Most new jobs come in as 'pending_review' and won't enter the
        // cache until an admin approves them — but deleteOldJobs may have
        // removed expired actives. Refresh is cheap, ~150ms.)
        try {
            await refreshJobsCache();
        } catch (cacheErr) {
            console.warn('[Cache] refresh failed after scrape:', cacheErr.message);
        }
    } catch (error) {
        console.error("An error occurred during the scheduled scrape:", error);
    } finally {
        isScraping = false;
        console.log("Scrape task finished.");
    }
}
