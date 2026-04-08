import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { AbortController } from 'abort-controller';

import { analyzeJobWithGroq } from '../gemini/index.js';
import { createJobModel } from '../models/jobModel.js';
import { createJobTestLog } from '../models/jobTestLogModel.js';
import { saveJobTestLog, findTestLogByFingerprint } from '../db/index.js';
import { Analytics } from '../models/analyticsModel.js';
import { BANNED_ROLES, generateJobFingerprint, generateCrossEntityKey, normalizeCompanyName } from '../utils.js';
import { detectGermanRequiredFromTitle } from '../filters/germanTitleFilter.js';
import { detectNonEnglishDescription } from '../filters/nonEnglishFilter.js';
import { detectCitizenshipRequirement } from '../filters/citizenshipFilter.js';
import { detectOtherLanguageRequired } from '../filters/otherLanguageFilter.js';
import {
    deriveDomain,
    deriveExperienceLevelFromTitle,
    deriveIsEntryLevelFromTitle,
    inferAtsPlatform,
    normalizeSalaryValues,
    normalizeArray,
    isSpamOrIrrelevant,
} from './jobExtractor.js';

async function scrapeJobDetailsFromPage(mappedJob, siteConfig) {
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
            }
        }
    } catch (error) {
        console.error(`[Scrape Error] ${error.message}`);
    } finally {
        clearTimeout(pageTimeoutId);
    }
    return mappedJob;
}


export async function processJob(rawJob, siteConfig, existingIDs, sessionHeaders, allRawJobs, crossEntityKeys) {
    // 1. Config Pre-Filter
    if (siteConfig.preFilter && !siteConfig.preFilter(rawJob)) return null;

    // Extract job data
    let mappedJob;
    if (siteConfig.extractJobID) {
        const extractedTitle = siteConfig.extractJobTitle(rawJob);
        const extractedExperience = siteConfig.extractExperienceLevel ? siteConfig.extractExperienceLevel(rawJob) : null;
        const derivedExperience = extractedExperience || deriveExperienceLevelFromTitle(extractedTitle);
        const extractedEntryLevel = siteConfig.extractIsEntryLevel ? siteConfig.extractIsEntryLevel(rawJob) : null;
        const derivedEntryLevel = extractedEntryLevel ?? deriveIsEntryLevelFromTitle(extractedTitle);

        mappedJob = {
            JobID: siteConfig.extractJobID(rawJob),
            JobTitle: extractedTitle,
            Company: siteConfig.extractCompany(rawJob),
            Location: siteConfig.extractLocation(rawJob),
            Description: siteConfig.extractDescription(rawJob),
            ApplicationURL: siteConfig.extractURL(rawJob),
            PostedDate: siteConfig.extractPostedDate ? siteConfig.extractPostedDate(rawJob) : new Date().toISOString(),
            DirectApplyURL: siteConfig.extractDirectApplyURL ? siteConfig.extractDirectApplyURL(rawJob) : null,
            ATSPlatform: siteConfig.extractATSPlatform ? siteConfig.extractATSPlatform(rawJob) : inferAtsPlatform(siteConfig),
            SalaryCurrency: siteConfig.extractSalaryCurrency ? siteConfig.extractSalaryCurrency(rawJob) : null,
            SalaryMin: siteConfig.extractSalaryMin ? siteConfig.extractSalaryMin(rawJob) : null,
            SalaryMax: siteConfig.extractSalaryMax ? siteConfig.extractSalaryMax(rawJob) : null,
            SalaryInterval: siteConfig.extractSalaryInterval ? siteConfig.extractSalaryInterval(rawJob) : null,
            Department: siteConfig.extractDepartment ? siteConfig.extractDepartment(rawJob) : 'N/A',
            Team: siteConfig.extractTeam ? siteConfig.extractTeam(rawJob) : null,
            WorkplaceType: siteConfig.extractWorkplaceType ? siteConfig.extractWorkplaceType(rawJob) : 'Unspecified',
            EmploymentType: siteConfig.extractEmploymentType ? siteConfig.extractEmploymentType(rawJob) : null,
            IsRemote: siteConfig.extractIsRemote ? Boolean(siteConfig.extractIsRemote(rawJob)) : false,
            Country: siteConfig.extractCountry ? siteConfig.extractCountry(rawJob) : null,
            AllLocations: normalizeArray(siteConfig.extractAllLocations ? siteConfig.extractAllLocations(rawJob) : []),
            Office: siteConfig.extractOffice ? siteConfig.extractOffice(rawJob) : null,
            Tags: normalizeArray(siteConfig.extractTags ? siteConfig.extractTags(rawJob) : []),
            isEntryLevel: Boolean(derivedEntryLevel),
            ExperienceLevel: derivedExperience,
        };
    } else {
        mappedJob = siteConfig.mapper(rawJob);
        const derivedExperience = mappedJob.ExperienceLevel || deriveExperienceLevelFromTitle(mappedJob.JobTitle);
        mappedJob.ExperienceLevel = derivedExperience;
        mappedJob.isEntryLevel = mappedJob.isEntryLevel ?? deriveIsEntryLevelFromTitle(mappedJob.JobTitle);
        mappedJob.AllLocations = normalizeArray(mappedJob.AllLocations);
        mappedJob.Tags = normalizeArray(mappedJob.Tags);
        mappedJob.ATSPlatform = mappedJob.ATSPlatform || inferAtsPlatform(siteConfig);
    }


    // 2. Duplicate Check
    if (!mappedJob.JobID || existingIDs.has(mappedJob.JobID)) {
        return null;
    }

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
        // MongoDB posts "Solutions Architect" in Berlin, Munich, Hamburg, Frankfurt, Cologne, Stuttgart
        // All 6 are identical jobs with different city. We keep the first, skip the rest.
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

    // 5. Get Description
    if ((siteConfig.needsDescriptionScraping && !mappedJob.Description)) {
        if (typeof siteConfig.getDetails === 'function') {
            try {
                const details = await siteConfig.getDetails(rawJob, sessionHeaders);

                if (details && details.skip) {
                    console.log(`[${siteConfig.siteName}] Job skipped by getDetails`);
                    return null;
                }

                if (details) {
                    Object.assign(mappedJob, details);
                }
            } catch (error) {
                console.error(`[${siteConfig.siteName}] getDetails error: ${error.message}`);
                return null;
            }
        } else {
            mappedJob = await scrapeJobDetailsFromPage(mappedJob, siteConfig);
        }
    }

    if (!mappedJob.Description) return null;

    // ✅ 5b. TITLE-BASED GERMAN CHECK — Skip AI entirely if title says it all
    // "Enterprise BDR (German Speaking)" → reject instantly, zero AI cost
    const titleGermanMatch = detectGermanRequiredFromTitle(mappedJob.JobTitle);
    if (titleGermanMatch) {
        console.log(`🏷️ [Title Reject] "${mappedJob.JobTitle}" — matched: "${titleGermanMatch.phrase}" — skipping AI`);

        const fingerprint = generateJobFingerprint(mappedJob.JobTitle, mappedJob.Company, mappedJob.Description);
        const testLogData = {
            ...mappedJob,
            GermanRequired: true,
            Domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
            SubDomain: mappedJob.Department || 'Other',
            ConfidenceScore: 1.0,
            Evidence: { german_reason: `German required detected from job title: "${titleGermanMatch.phrase}"` },
            FinalDecision: 'rejected',
            RejectionReason: 'German language required (title)',
            Status: 'rejected',
            fingerprint: fingerprint,
        };

        const jobTestLog = createJobTestLog(testLogData, siteConfig.siteName);
        await saveJobTestLog(jobTestLog);
        console.log(`📝 [Test Log] Saved title-rejected job: ${mappedJob.JobTitle}`);
        return null;
    }

    // ✅ 5c. PRE-AI NON-ENGLISH CHECK — Catch fully French/Spanish/etc. descriptions
    // "Commercial(e) Terrain Indépendant" with French description → reject, skip AI
    const nonEnglishMatch = detectNonEnglishDescription(mappedJob.Description);
    if (nonEnglishMatch) {
        console.log(`🌐 [Non-English Reject] "${mappedJob.JobTitle}" — ${nonEnglishMatch.ratio}% ${nonEnglishMatch.language} detected — skipping AI`);

        const fingerprint = generateJobFingerprint(mappedJob.JobTitle, mappedJob.Company, mappedJob.Description);
        const testLogData = {
            ...mappedJob,
            GermanRequired: false,
            Domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
            SubDomain: mappedJob.Department || 'Other',
            ConfidenceScore: 1.0,
            Evidence: { german_reason: `Description is primarily in ${nonEnglishMatch.language} (${nonEnglishMatch.ratio}% marker density) — not an English-language job` },
            FinalDecision: 'rejected',
            RejectionReason: `Non-English description (${nonEnglishMatch.language})`,
            Status: 'rejected',
            fingerprint: fingerprint,
        };

        const jobTestLog = createJobTestLog(testLogData, siteConfig.siteName);
        await saveJobTestLog(jobTestLog);
        console.log(`📝 [Test Log] Saved non-English-rejected job: ${mappedJob.JobTitle}`);
        return null;
    }

    // ✅ 5d. PRE-AI CITIZENSHIP CHECK — "German citizenship mandatory" ≠ language
    // The AI correctly says german_required=false for these, but they still need rejection
    const citizenshipMatch = detectCitizenshipRequirement(mappedJob.Description);
    if (citizenshipMatch) {
        console.log(`🛂 [Citizenship Reject] "${mappedJob.JobTitle}" — matched: "${citizenshipMatch.phrase}" — skipping AI`);

        const fingerprint = generateJobFingerprint(mappedJob.JobTitle, mappedJob.Company, mappedJob.Description);
        const testLogData = {
            ...mappedJob,
            GermanRequired: false,
            Domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
            SubDomain: mappedJob.Department || 'Other',
            ConfidenceScore: 1.0,
            Evidence: { german_reason: `Citizenship/nationality requirement detected: "${citizenshipMatch.phrase}"` },
            FinalDecision: 'rejected',
            RejectionReason: 'Citizenship or nationality requirement',
            Status: 'rejected',
            fingerprint: fingerprint,
        };

        const jobTestLog = createJobTestLog(testLogData, siteConfig.siteName);
        await saveJobTestLog(jobTestLog);
        console.log(`📝 [Test Log] Saved citizenship-rejected job: ${mappedJob.JobTitle}`);
        return null;
    }

    // ✅ 5e. PRE-AI OTHER LANGUAGE CHECK — "Dutch C2 required" / "French native speaker"
    // Not an English-language job even if based in Berlin
    const otherLangMatch = detectOtherLanguageRequired(mappedJob.Description);
    if (otherLangMatch) {
        console.log(`🗣️ [Other Language Reject] "${mappedJob.JobTitle}" — ${otherLangMatch.language}: "${otherLangMatch.phrase}" — skipping AI`);

        const fingerprint = generateJobFingerprint(mappedJob.JobTitle, mappedJob.Company, mappedJob.Description);
        const testLogData = {
            ...mappedJob,
            GermanRequired: false,
            Domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
            SubDomain: mappedJob.Department || 'Other',
            ConfidenceScore: 1.0,
            Evidence: { german_reason: `Non-English/German primary language required: ${otherLangMatch.language} — "${otherLangMatch.phrase}"` },
            FinalDecision: 'rejected',
            RejectionReason: `${otherLangMatch.language.charAt(0).toUpperCase() + otherLangMatch.language.slice(1)} language required`,
            Status: 'rejected',
            fingerprint: fingerprint,
        };

        const jobTestLog = createJobTestLog(testLogData, siteConfig.siteName);
        await saveJobTestLog(jobTestLog);
        console.log(`📝 [Test Log] Saved other-language-rejected job: ${mappedJob.JobTitle}`);
        return null;
    }

    // ✅ 6. FINGERPRINT CHECK — Reuse old AI result if we already analyzed this job
    const fingerprint = generateJobFingerprint(mappedJob.JobTitle, mappedJob.Company, mappedJob.Description);
    const cachedResult = await findTestLogByFingerprint(fingerprint);

    let aiResult;

    if (cachedResult) {
        // We already analyzed this exact job before — reuse the cached classification
        console.log(`[Cache Hit] ♻️ Reusing AI result for: ${mappedJob.JobTitle.substring(0, 40)}...`);
        aiResult = {
            german_required: cachedResult.GermanRequired,
            domain: cachedResult.Domain,
            sub_domain: cachedResult.SubDomain,
            confidence: cachedResult.ConfidenceScore,
            evidence: cachedResult.Evidence || { german_reason: "Cached result" }
        };
    } else {
        // Genuinely new job — send to AI
        await Analytics.increment('jobsSentToAI');
        aiResult = await analyzeJobWithGroq(mappedJob.JobTitle, mappedJob.Description);

        if (!aiResult) {
            console.log(`[AI] Failed to analyze ${mappedJob.JobTitle}. Skipping.`);
            return null;
        }
    }

    // ✅ 7. FILTERING LOGIC — AI only checks German requirement
    // (Other language, non-English description, citizenship are already handled pre-AI in steps 5b-5e)
    let finalDecision = "accepted";
    let rejectionReason = null;

    if (aiResult.german_required === true) {
        finalDecision = "rejected";
        rejectionReason = "German language required";
        console.log(`❌ [Rejected - German Required] ${mappedJob.JobTitle}`);
    } else {
        console.log(`✅ [Valid Job] ${mappedJob.JobTitle} (Confidence: ${aiResult.confidence})`);
    }

    // ✅ 8. SAVE TO TEST LOG (with fingerprint for future cache lookups)
    const testLogData = {
        ...mappedJob,
        GermanRequired: aiResult.german_required,
        Domain: deriveDomain(mappedJob.Department, mappedJob.JobTitle),
        SubDomain: mappedJob.Department || 'Other',
        ConfidenceScore: aiResult.confidence,
        Evidence: aiResult.evidence,
        FinalDecision: finalDecision,
        RejectionReason: rejectionReason,
        Status: finalDecision === "accepted" ? "pending_review" : "rejected",
        fingerprint: fingerprint
    };

    const jobTestLog = createJobTestLog(testLogData, siteConfig.siteName);
    await saveJobTestLog(jobTestLog);
    console.log(`📝 [Test Log] Saved ${finalDecision} job: ${mappedJob.JobTitle}`);

    // ✅ 9. RETURN NULL IF REJECTED
    if (finalDecision === "rejected") {
        return null;
    }

    await Analytics.increment('jobsPendingReview');

    // 10. Create Model
    mappedJob.GermanRequired = aiResult.german_required;
    mappedJob.Domain = deriveDomain(mappedJob.Department, mappedJob.JobTitle);
    mappedJob.SubDomain = mappedJob.Department || 'Other';
    mappedJob.ConfidenceScore = aiResult.confidence;
    mappedJob.Status = "pending_review";

    normalizeSalaryValues(mappedJob);

    return createJobModel(mappedJob, siteConfig.siteName);
}
