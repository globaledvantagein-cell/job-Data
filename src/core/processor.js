import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { AbortController } from 'abort-controller';

import { analyzeJobWithGroq } from "../grokAnalyzer.js"; 
import { createJobModel } from '../models/jobModel.js';
import { createJobTestLog } from '../models/Jobtestlogmodel.js';
import { saveJobTestLog, findTestLogByFingerprint } from '../Db/databaseManager.js';
import { Analytics } from '../models/analyticsModel.js';
import { BANNED_ROLES, generateJobFingerprint, generateCrossEntityKey } from '../utils.js';

// ─── Domain Classification (derived from Department + Title, no AI needed) ──
const TECHNICAL_KEYWORDS = [
    'engineering', 'software', 'data', 'ai', 'machine learning', 'devops',
    'infrastructure', 'platform', 'backend', 'frontend', 'fullstack',
    'full-stack', 'full stack', 'mobile', 'ios', 'android', 'web',
    'cloud', 'security', 'cybersecurity', 'infosec', 'it', 'sre',
    'reliability', 'qa', 'quality assurance', 'test', 'automation',
    'architect', 'systems', 'network', 'database', 'analytics',
    'bi', 'intelligence', 'research', 'science', 'ml', 'deep learning',
    'computer vision', 'nlp', 'robotics', 'firmware', 'embedded',
    'hardware', 'electronic', 'technical', 'technology', 'development',
    'developer', 'programmer', 'implementation', 'integration',
    'solutions engineer', 'technical account', 'support engineer',
    'professional services', 'devrel', 'developer relations',
    'site reliability', 'devsecops', 'secops', 'mlops', 'dataops',
    'release', 'build', 'ci/cd', 'pipeline',
];

function deriveDomain(department, jobTitle) {
    const combined = `${department || ''} ${jobTitle || ''}`.toLowerCase();
    return TECHNICAL_KEYWORDS.some(kw => combined.includes(kw)) ? 'Technical' : 'Non-Technical';
}

function normalizeArray(values) {
    return Array.isArray(values)
        ? [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))]
        : [];
}

function deriveExperienceLevelFromTitle(title) {
    const lower = String(title || '').toLowerCase();
    if (/\b(staff|staff\+|distinguished)\b/i.test(lower)) return 'Staff';
    if (/\b(lead|principal|tech lead)\b/i.test(lower)) return 'Lead';
    if (/\b(senior|sr\.?|senior level)\b/i.test(lower)) return 'Senior';
    if (/\b(junior|jr\.?|entry|associate|graduate|intern|entry level|entry-level)\b/i.test(lower)) return 'Entry';
    if (/\b(mid|mid-level|intermediate|regular)\b/i.test(lower)) return 'Mid';
    return 'Mid';
}

function deriveIsEntryLevelFromTitle(title) {
    const lower = String(title || '').toLowerCase();
    return /\b(junior|jr\.?|entry|associate|graduate|intern|entry level|entry-level)\b/i.test(lower);
}

function inferAtsPlatform(siteConfig) {
    const name = String(siteConfig?.siteName || '').toLowerCase();
    if (name.includes('greenhouse')) return 'greenhouse';
    if (name.includes('ashby')) return 'ashby';
    if (name.includes('lever')) return 'lever';
    return 'unknown';
}

function normalizeSalaryValues(mappedJob) {
    let { SalaryMin, SalaryMax, SalaryInterval } = mappedJob;

    if (SalaryMin == null && SalaryMax == null) return;

    const normalizedInterval = String(SalaryInterval || '').toLowerCase();
    const isAnnual = !normalizedInterval || normalizedInterval === 'per-year-salary' || normalizedInterval === 'yearly' || normalizedInterval === 'year';

    if (isAnnual) {
        if (SalaryMin != null && SalaryMin > 0 && SalaryMin < 1000) {
            mappedJob.SalaryMin = SalaryMin * 1000;
        }
        if (SalaryMax != null && SalaryMax > 0 && SalaryMax < 1000) {
            mappedJob.SalaryMax = SalaryMax * 1000;
        }
    }

    const isMonthly = normalizedInterval === 'per-month-salary' || normalizedInterval === 'monthly';
    if (isMonthly) {
        if (SalaryMin != null && SalaryMin > 0 && SalaryMin < 100) {
            mappedJob.SalaryMin = SalaryMin * 1000;
        }
        if (SalaryMax != null && SalaryMax > 0 && SalaryMax < 100) {
            mappedJob.SalaryMax = SalaryMax * 1000;
        }
    }

    if ((mappedJob.SalaryMin === 0 || mappedJob.SalaryMin == null)
        && (mappedJob.SalaryMax === 0 || mappedJob.SalaryMax == null)) {
        mappedJob.SalaryMin = null;
        mappedJob.SalaryMax = null;
        mappedJob.SalaryCurrency = null;
        mappedJob.SalaryInterval = null;
    }
}

function isSpamOrIrrelevant(title) {
    const lowerTitle = title.toLowerCase();
    return BANNED_ROLES.some(role => lowerTitle.includes(role));
}

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
    }

    await Analytics.increment('jobsScraped');

    // 3. Title Filter
    if (isSpamOrIrrelevant(mappedJob.JobTitle)) {
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

    // ✅ 7. FILTERING LOGIC - ONLY CHECK GERMAN REQUIREMENT
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