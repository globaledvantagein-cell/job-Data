import { initializeSession, fetchJobsPage } from './network.js';
import { shouldContinuePaging } from './pagination.js';
import { processJob } from './processJob.js';
import { saveJobs, findSavedJobsByJobIDs } from '../db/index.js';
import { extractAndStoreRequirements } from '../gemma/index.js';
import { sleep } from '../utils.js';

/**
 * Kick off Gemma requirement extraction for the auto-published jobs in a batch.
 *
 * Fire-and-forget by design: extraction is a slow AI call and must never hold up
 * the scraper loop, so each job is scheduled via setImmediate and its failure is
 * swallowed with a warning. A job that misses out simply stays live without
 * parsedRequirements, exactly like one whose admin-approval extraction failed —
 * the backfill migration picks those up later.
 *
 * Only the one DB read is awaited, so a save failure can't silently skip jobs.
 *
 * @param {object[]} savedBatch - job models just passed to saveJobs()
 * @param {string} siteName - sourceSite the batch belongs to
 */
async function scheduleAutoPublishEnrichment(savedBatch, siteName) {
    const autoPublishedIDs = savedBatch
        .filter(job => job.Status === 'active' && job.approvalMethod === 'ai_auto')
        .map(job => job.JobID);
    if (autoPublishedIDs.length === 0) return;

    try {
        const savedDocs = await findSavedJobsByJobIDs(autoPublishedIDs, siteName);
        for (const doc of savedDocs) {
            setImmediate(() => {
                extractAndStoreRequirements(doc).catch(err =>
                    console.warn(`[Gemma] Auto-publish extraction error for ${doc.JobID}: ${err.message}`)
                );
            });
        }
        console.log(`   -> [Auto-Publish] Scheduled Gemma extraction for ${savedDocs.length} job(s)`);
    } catch (err) {
        console.warn(`[Auto-Publish] Could not schedule extraction: ${err.message}`);
    }
}

export async function scrapeSite(siteConfig, existingIDsMap, crossEntityKeys) {
    const siteName = siteConfig.siteName;
    const existingIDs = existingIDsMap.get(siteName) || new Set();
    const allNewJobs = [];
    
    const limit = siteConfig.limit || 20;
    let offset = 0;
    let hasMore = true;
    let totalJobs = 0;

    console.log(`\n--- Starting scrape for [${siteName}] ---`);

    try {
        const sessionHeaders = await initializeSession(siteConfig);

        while (hasMore) {
            const scrapeStartTime = new Date();
            console.log(`[${siteName}] Fetching page with offset: ${offset}...`);
            const data = await fetchJobsPage(siteConfig, offset, limit, sessionHeaders);
            const jobs = siteConfig.getJobs(data);

            if (!jobs || jobs.length === 0) {
                break;
            }

            if (offset === 0 && siteConfig.getTotal) {
                totalJobs = siteConfig.getTotal(data);
            }

            // Batch size 1 = Sequential processing
            const batchSize = 1; 
            
            for (let i = 0; i < jobs.length; i += batchSize) {
                const batch = jobs.slice(i, i + batchSize);
                
                batch.forEach((rawJob, index) => {
                    const jobTitle = rawJob._source ? rawJob._source.title : (rawJob.titel || rawJob.title || rawJob.PositionTitle || rawJob.job_title || rawJob.name || rawJob.jobFields?.jobTitle);
                    const jobNumber = offset + i + index + 1;
                    console.log(`\n  #${jobNumber}: Analyzing: ${jobTitle}`);
                });

                const jobPromises = batch.map(rawJob => 
                    processJob(rawJob, siteConfig, existingIDs, sessionHeaders, null, crossEntityKeys)
                );
                
                const processedJobs = await Promise.all(jobPromises);
                const newJobsInBatch = processedJobs.filter(job => job !== null);

                if (newJobsInBatch.length > 0) {
                    console.log(`   -> Saving ${newJobsInBatch.length} valid job(s)...`);
                    const jobsToSave = newJobsInBatch.map(job => ({ ...job, scrapedAt: scrapeStartTime }));
                    await saveJobs(jobsToSave);

                    // Auto-published jobs are live the moment they're saved, so they
                    // need the same enrichment an admin approval would have triggered:
                    // Gemma requirements + the filter* fields resolveAll() derives from
                    // them. This has to happen HERE rather than in processJob() — the
                    // models it returns have no _id until saveJobs() upserts them, and
                    // extractAndStoreRequirements() no-ops without one.
                    await scheduleAutoPublishEnrichment(newJobsInBatch, siteName);

                    allNewJobs.push(...newJobsInBatch);
                    newJobsInBatch.forEach(job => existingIDs.add(job.JobID));
                }

                // 2s between jobs is safe: 3 keys × 15 RPM = 45 RPM capacity.
                // The AI layer's KeyState handles any burst automatically.
                if (i + batchSize < jobs.length) {
                    await sleep(2000); 
                }
            }
            
            hasMore = shouldContinuePaging(siteConfig, jobs, offset, limit, totalJobs);
            offset += limit;
        }
    } catch (error) {
        console.error(`[${siteName}] ERROR during scrape: ${error.message}.`);
    }

    if (allNewJobs.length > 0) {
        console.log(`\n[${siteName}] Finished. Found ${allNewJobs.length} total new jobs.`);
    } else {
        console.log(`\n[${siteName}] No new jobs found.`);
    }
    return allNewJobs;
}