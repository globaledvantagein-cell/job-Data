import { analyzeJobWithGroq } from '../gemini/index.js';
import { createJobModel } from '../models/jobModel.js';
import { lookupFingerprint, saveAiResult } from '../cache/aiResultCache.js';
import { Analytics } from '../models/analyticsModel.js';
import {
    BANNED_ROLES,
    generateJobFingerprint,
    generateCrossEntityKey,
    normalizeCompanyName,
    GERMAN_CITIES_CHECK,
} from '../utils.js';
import { detectGermanRequiredFromTitle } from '../filters/germanTitleFilter.js';
import { detectNonEnglishDescription } from '../filters/nonEnglishFilter.js';
import { detectCitizenshipRequirement } from '../filters/citizenshipFilter.js';
import { detectOtherLanguageRequired } from '../filters/otherLanguageFilter.js';
import {
    deriveDomain,
    normalizeSalaryValues,
    isSpamOrIrrelevant,
} from './jobExtractor.js';
import {
    scrapeJobDetailsFromPage,
    normalizeStoredLocation,
} from './processJob/helpers.js';
import { mapRawJob } from './processJob/mapRawJob.js';
import { rejectPreAi } from './processJob/preAiFilters.js';
import { AUTO_PUBLISH_THRESHOLD, MANUAL_REVIEW_THRESHOLD } from '../env.js';

export async function processJob(rawJob, siteConfig, existingIDs, sessionHeaders, allRawJobs, crossEntityKeys) {
    // 1. Config Pre-Filter
    if (siteConfig.preFilter && !siteConfig.preFilter(rawJob)) return null;

    // Extract job data (uses extract* functions or legacy mapper())
    let mappedJob = mapRawJob(rawJob, siteConfig);

    // 2. Duplicate Check
    if (!mappedJob.JobID || existingIDs.has(mappedJob.JobID)) return null;

    // 2b. Cross-Entity Duplicate Check
    // Detects "Databricks GmbH" and "Databricks Inc." posting the same job
    if (crossEntityKeys) {
        const crossKey = generateCrossEntityKey(mappedJob.JobTitle, mappedJob.Company, mappedJob.Location);
        if (crossEntityKeys.has(crossKey)) {
            const originalEntity = crossEntityKeys.get(crossKey);
            console.log(`[Cross-Entity Dedup] ♻️ Skipping duplicate: "${mappedJob.JobTitle}" at "${mappedJob.Company}" (same as another entity: "${originalEntity}")`);
            return null;
        }
        crossEntityKeys.set(crossKey, mappedJob.Company);

        // 2c. Same-Company City-Variant Dedup
        // MongoDB posts "Solutions Architect" in 6 cities — all identical.
        // We keep the first, skip the rest.
        const titleDedupKey = `TITLE_DEDUP|${normalizeCompanyName(mappedJob.Company)}|${mappedJob.JobTitle.toLowerCase().trim()}`;
        if (crossEntityKeys.has(titleDedupKey)) {
            const firstCity = crossEntityKeys.get(titleDedupKey);
            console.log(`[City Dedup] ♻️ Skipping city-variant: "${mappedJob.JobTitle}" at "${mappedJob.Company}" — already accepted for ${firstCity}`);
            return null;
        }
        crossEntityKeys.set(titleDedupKey, mappedJob.Location || 'unknown');
    }

    await Analytics.increment('jobsScraped');

    // 3. Title Filter
    if (isSpamOrIrrelevant(mappedJob.JobTitle, BANNED_ROLES)) {
        console.log(`[Pre-Filter] Rejected: ${mappedJob.JobTitle}`);
        return null;
    }

    // 4. Keyword Match
    if (siteConfig.filterKeywords && siteConfig.filterKeywords.length > 0) {
        const titleLower = mappedJob.JobTitle.toLowerCase();
        if (!siteConfig.filterKeywords.some(kw => titleLower.includes(kw.toLowerCase()))) return null;
    }

    // 5. Get Description (visit the job page if needed)
    if ((siteConfig.needsDescriptionScraping && !mappedJob.Description)) {
        if (typeof siteConfig.getDetails === 'function') {
            try {
                const details = await siteConfig.getDetails(rawJob, sessionHeaders);
                if (details && details.skip) {
                    console.log(`[${siteConfig.siteName}] Job skipped by getDetails`);
                    return null;
                }
                if (details) Object.assign(mappedJob, details);
            } catch (error) {
                console.error(`[${siteConfig.siteName}] getDetails error: ${error.message}`);
                return null;
            }
        } else {
            mappedJob = await scrapeJobDetailsFromPage(mappedJob, siteConfig);
        }
    }

    // 5a. LOCATION RE-CHECK — reject if getDetails changed location to non-Germany
    const locationToCheck = `${mappedJob.Location || ''} ${(mappedJob.AllLocations || []).join(' ')}`.toLowerCase();
    const isStillGermany = /germany|deutschland/.test(locationToCheck)
        || GERMAN_CITIES_CHECK.some(city => locationToCheck.includes(city));
    if (!isStillGermany) {
        console.log(`🌍 [Location Reject] "${mappedJob.JobTitle}" at "${mappedJob.Company}" — location "${mappedJob.Location}" is not Germany — skipping`);
        return null;
    }
    if (!mappedJob.Description) return null;

    // 5b. TITLE-BASED GERMAN CHECK — skip AI entirely if title says it all
    const titleGermanMatch = detectGermanRequiredFromTitle(mappedJob.JobTitle);
    if (titleGermanMatch) {
        await rejectPreAi(mappedJob, siteConfig, {
            germanRequired: true,
            evidence: `German required detected from job title: "${titleGermanMatch.phrase}"`,
            rejectionReason: 'German language required (title)',
            logLabel: '🏷️ [Title Reject]',
            logSuffix: `matched: "${titleGermanMatch.phrase}"`,
        });
        return null;
    }

    // 5c. PRE-AI NON-ENGLISH CHECK — fully French/Spanish/etc. descriptions
    const nonEnglishMatch = detectNonEnglishDescription(mappedJob.Description);
    if (nonEnglishMatch) {
        await rejectPreAi(mappedJob, siteConfig, {
            germanRequired: false,
            evidence: `Description is primarily in ${nonEnglishMatch.language} (${nonEnglishMatch.ratio}% marker density) — not an English-language job`,
            rejectionReason: `Non-English description (${nonEnglishMatch.language})`,
            logLabel: '🌐 [Non-English Reject]',
            logSuffix: `${nonEnglishMatch.ratio}% ${nonEnglishMatch.language} detected`,
        });
        return null;
    }

    // 5d. PRE-AI CITIZENSHIP CHECK — "German citizenship mandatory" ≠ language
    const citizenshipMatch = detectCitizenshipRequirement(mappedJob.Description);
    if (citizenshipMatch) {
        await rejectPreAi(mappedJob, siteConfig, {
            germanRequired: false,
            evidence: `Citizenship/nationality requirement detected: "${citizenshipMatch.phrase}"`,
            rejectionReason: 'Citizenship or nationality requirement',
            logLabel: '🛂 [Citizenship Reject]',
            logSuffix: `matched: "${citizenshipMatch.phrase}"`,
        });
        return null;
    }

    // 5e. PRE-AI OTHER LANGUAGE CHECK — "Dutch C2 required" / "French native speaker"
    const otherLangMatch = detectOtherLanguageRequired(mappedJob.Description);
    if (otherLangMatch) {
        const langName = otherLangMatch.language.charAt(0).toUpperCase() + otherLangMatch.language.slice(1);
        await rejectPreAi(mappedJob, siteConfig, {
            germanRequired: false,
            evidence: `Non-English/German primary language required: ${otherLangMatch.language} — "${otherLangMatch.phrase}"`,
            rejectionReason: `${langName} language required`,
            logLabel: '🗣️ [Other Language Reject]',
            logSuffix: `${otherLangMatch.language}: "${otherLangMatch.phrase}"`,
        });
        return null;
    }

    // 6. FINGERPRINT CHECK — reuse old AI result if we already analyzed this job
    const fingerprint = generateJobFingerprint(mappedJob.JobTitle, mappedJob.Company, mappedJob.Description);
    // Synchronous — the cache lives in RAM, so this is a Map.get(), not a query.
    const cachedResult = lookupFingerprint(fingerprint);

    let aiResult;
    if (cachedResult) {
        console.log(`[Cache Hit] ♻️ Reusing AI result for: ${mappedJob.JobTitle.substring(0, 40)}...`);
        aiResult = {
            german_required: cachedResult.germanRequired,
            domain: cachedResult.domain,
            sub_domain: cachedResult.subDomain,
            confidence: cachedResult.confidence,
            // Evidence is no longer stored — it was only ever read back for
            // display, and the lean cache drops it.
            evidence: { german_reason: 'Cached result' }
        };
    } else {
        await Analytics.increment('jobsSentToAI');
        aiResult = await analyzeJobWithGroq(mappedJob.JobTitle, mappedJob.Description);
        if (!aiResult) {
            console.log(`[AI] Failed to analyze ${mappedJob.JobTitle}. Skipping.`);
            return null;
        }
    }

    // 7. FILTERING LOGIC — AI only checks German requirement
    // (Other language, non-English description, citizenship handled pre-AI above)
    let finalDecision = 'accepted';
    let rejectionReason = null;
    if (aiResult.german_required === true) {
        finalDecision = 'rejected';
        rejectionReason = 'German language required';
        console.log(`❌ [Rejected - German Required] ${mappedJob.JobTitle}`);
    } else {
        console.log(`✅ [Valid Job] ${mappedJob.JobTitle} (Confidence: ${aiResult.confidence})`);
    }

    // 7b. LOW-CONFIDENCE REJECTION — the AI said "no German required" but wasn't
    // sure enough to trust. Too ambiguous to publish and not worth an admin's
    // time, so it never reaches the review queue.
    if (finalDecision === 'accepted' && aiResult.confidence < MANUAL_REVIEW_THRESHOLD) {
        finalDecision = 'rejected';
        rejectionReason = 'Low confidence score';
        console.log(`[Low Confidence] ❌ ${mappedJob.JobTitle} (Confidence: ${aiResult.confidence}) — auto-rejected`);
        await Analytics.increment('jobsAutoRejectedLowConfidence');
    }

    // Above the auto-publish bar the job goes live straight from the scraper;
    // between the two thresholds it queues for manual approval as before.
    const isAutoPublished = finalDecision === 'accepted'
        && aiResult.confidence >= AUTO_PUBLISH_THRESHOLD;

    // 8. CACHE THE AI VERDICT (keyed by fingerprint, for future runs)
    await saveAiResult({
        fingerprint,
        germanRequired: aiResult.german_required,
        confidence: aiResult.confidence,
        domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
        subDomain: mappedJob.Department || 'Other',
    });
    console.log(`📝 [AI Cache] Stored ${finalDecision} verdict: ${mappedJob.JobTitle}`);

    // 9. RETURN NULL IF REJECTED
    if (finalDecision === 'rejected') return null;

    // 10. Create Model
    mappedJob.GermanRequired = aiResult.german_required;
    mappedJob.Domain = deriveDomain(mappedJob.Department, mappedJob.JobTitle);
    mappedJob.SubDomain = mappedJob.Department || 'Other';
    mappedJob.ConfidenceScore = aiResult.confidence;

    // 10b. THREE-BAND ROUTING — high confidence goes live now, medium waits for
    // an admin. The Gemma extraction + filter* computation for auto-published
    // jobs is scheduled by scraperEngine.js after saveJobs(), because the job
    // has no _id until Mongo assigns one on insert.
    if (isAutoPublished) {
        mappedJob.Status = 'active';
        mappedJob.approvalMethod = 'ai_auto';
        mappedJob.autoPublishedAt = new Date();
        console.log(`[Auto-Publish] ✅ ${mappedJob.JobTitle} (Confidence: ${aiResult.confidence}) — published automatically`);
        await Analytics.increment('jobsPublished');
        await Analytics.increment('jobsAutoPublished');
        await Analytics.increment('totalReviews');
        await Analytics.increment('totalAiAutoPublished');
    } else {
        mappedJob.Status = 'pending_review';
        mappedJob.approvalMethod = null;
        console.log(`[Manual Review] ⏳ ${mappedJob.JobTitle} (Confidence: ${aiResult.confidence}) — queued for review`);
        await Analytics.increment('jobsPendingReview');
    }

    normalizeSalaryValues(mappedJob);
    mappedJob.Location = normalizeStoredLocation(mappedJob);

    // 200-char plain-text preview for the cache/teaser layer — the cache load
    // projection excludes the full Description, so this is what lists serve.
    const plainDescription = String(mappedJob.Description || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    mappedJob.descriptionPreview = plainDescription.length > 200
        ? `${plainDescription.slice(0, 200)}...`
        : plainDescription;

    return createJobModel(mappedJob, siteConfig.siteName);
}
