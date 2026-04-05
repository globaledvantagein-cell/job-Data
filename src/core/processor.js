import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { AbortController } from 'abort-controller';

import { analyzeJobWithGroq } from "../grokAnalyzer.js"; 
import { createJobModel } from '../models/jobModel.js';
import { createJobTestLog } from '../models/Jobtestlogmodel.js';
import { saveJobTestLog, findTestLogByFingerprint } from '../Db/databaseManager.js';
import { Analytics } from '../models/analyticsModel.js';
import { BANNED_ROLES, generateJobFingerprint, generateCrossEntityKey, normalizeCompanyName } from '../utils.js';

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

// ─── Title-Based German Detection (skips AI entirely) ────────────────────────
// If the job TITLE already says "German Speaking" or similar, we reject immediately
// without calling the AI. Saves tokens, cost, and ~2 seconds per job.
//
// Returns { matched: true, phrase: "..." } or null
//
const GERMAN_TITLE_PATTERNS = [
    // English patterns
    /\bgerman[\s-]*speak(?:ing|er)\b/i,          // "German Speaking", "German-speaking", "German Speaker"
    /\bgerman[\s-]*fluent\b/i,                    // "German fluent"
    /\bfluent[\s-]*german\b/i,                    // "Fluent German"
    /\bgerman[\s-]*native\b/i,                    // "German native"
    /\bnative[\s-]*german\b/i,                    // "Native German"
    /\bgerman[\s-]*(?:required|mandatory)\b/i,    // "German required", "German mandatory"
    /\bgerman[\s-]*(?:c[12]|b[12])\b/i,           // "German C1", "German B2"
    /\b(?:c[12]|b[12])[\s-]*german\b/i,           // "C1 German", "B2 German"

    // German-language patterns in titles
    /\bdeutschsprachig(?:e[rn]?)?\b/i,            // "Deutschsprachig", "Deutschsprachiger"
    /\bmuttersprachler(?:in)?\b/i,                // "Muttersprachler", "Muttersprachlerin"
    /\bflie[ßs]end[\s-]*deutsch\b/i,              // "fließend Deutsch", "fliessend Deutsch"
    /\bdeutschkenntnisse\b/i,                     // "Deutschkenntnisse"
];

function detectGermanRequiredFromTitle(title) {
    if (!title) return null;
    const titleStr = String(title);

    for (const pattern of GERMAN_TITLE_PATTERNS) {
        const match = titleStr.match(pattern);
        if (match) {
            return { matched: true, phrase: match[0] };
        }
    }
    return null;
}

// ─── Pre-AI Non-English Description Detection ────────────────────────────────
// Catches obviously non-English descriptions (fully French, Spanish, etc.)
// BEFORE calling the AI. Saves tokens for clear-cut cases like SumUp France x7.
//
// Strategy: count high-frequency French/Spanish/Italian/Dutch words in the
// first 600 chars. If they exceed a threshold → it's not English.
// Conservative: only catches descriptions that are CLEARLY non-English.
//
const NON_ENGLISH_MARKERS = {
    french: [
        // Words that almost never appear in English job descriptions
        'nous', 'vous', 'sont', 'avec', 'pour', 'dans', 'votre', 'notre',
        'être', 'avoir', 'cette', 'aussi', 'mais', 'chez', 'depuis',
        'toutes', 'leurs', 'comme', 'après', 'entre', 'fait', 'très',
        'peut', 'plus', 'tout', 'elle', 'aux', 'ces', 'ses', 'une',
        'des', 'les', 'sur', 'par', 'qui', 'que', 'est', 'ont',
    ],
    spanish: [
        'para', 'como', 'está', 'tiene', 'puede', 'todos', 'esta',
        'desde', 'cuando', 'entre', 'donde', 'hacia', 'según', 'sobre',
        'nuestro', 'nuestra', 'también', 'porque', 'empresa', 'trabajo',
    ],
    dutch: [
        'voor', 'zijn', 'worden', 'naar', 'hebben', 'onze', 'deze',
        'maar', 'ook', 'niet', 'bij', 'jouw', 'jij', 'wij', 'ons',
    ],
    italian: [
        'sono', 'della', 'questo', 'anche', 'essere', 'questo',
        'nella', 'delle', 'nostro', 'nostra', 'lavoro', 'ogni',
    ],
    polish: [
        'jest', 'oraz', 'jako', 'przez', 'będzie', 'które', 'więcej',
        'nasz', 'pracy', 'może', 'tylko', 'jeśli', 'bardzo',
    ],
};

function detectNonEnglishDescription(description) {
    if (!description || description.length < 100) return null;

    const sample = description.substring(0, 600).toLowerCase();
    const words = sample.split(/\s+/);
    if (words.length < 20) return null;

    for (const [language, markers] of Object.entries(NON_ENGLISH_MARKERS)) {
        let hits = 0;
        for (const marker of markers) {
            // Match whole words only
            const regex = new RegExp(`\\b${marker}\\b`, 'g');
            const matches = sample.match(regex);
            if (matches) hits += matches.length;
        }
        // If >15% of words in the sample are non-English markers → flag it
        const ratio = hits / words.length;
        if (ratio > 0.15) {
            return { language, ratio: Math.round(ratio * 100) };
        }
    }
    return null;
}

// ─── Pre-AI Citizenship / Nationality Detection ──────────────────────────────
// "German citizenship is mandatory" is NOT a language requirement — the AI
// correctly returns german_required=false. But the job should still be rejected
// because it excludes most of our international audience.
//
// Returns { matched: true, phrase: "..." } or null
//
const CITIZENSHIP_PATTERNS = [
    // English — German citizenship
    /\bgerman\s+(?:citizenship|nationality)\s+(?:is\s+)?(?:required|mandatory|essential|necessary|needed)\b/i,
    /\b(?:require[sd]?|must\s+have|must\s+hold|must\s+possess)\s+german\s+(?:citizenship|nationality)\b/i,
    /\bmust\s+be\s+a\s+german\s+citizen\b/i,
    /\bgerman\s+(?:citizen|national)\s+(?:only|required)\b/i,
    /\b(?:no|not)\s+dual\s+citizenship\b/i,
    /\bdual\s+citizenship\s+(?:is\s+)?not\s+(?:allowed|accepted|permitted)\b/i,

    // English — EU/EEA citizenship (still excludes non-EU internationals)
    /\b(?:eu|eea)\s+(?:citizenship|nationality|work\s+(?:permit|authorization))\s+(?:is\s+)?(?:required|mandatory|essential)\b/i,
    /\b(?:require[sd]?|must\s+have|must\s+hold)\s+(?:eu|eea)\s+(?:citizenship|nationality)\b/i,
    /\bmust\s+be\s+(?:an?\s+)?(?:eu|eea)\s+(?:citizen|national|resident)\b/i,

    // German language — citizenship/nationality
    /\bStaatsbürgerschaft\s+erforderlich\b/i,
    /\bdeutsche\s+Staats(?:bürgerschaft|angehörigkeit)\b/i,
    /\bdeutsche[rn]?\s+(?:Pass|Ausweis)\s+erforderlich\b/i,
];

function detectCitizenshipRequirement(description) {
    if (!description) return null;
    const text = String(description);

    for (const pattern of CITIZENSHIP_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            return { matched: true, phrase: match[0] };
        }
    }
    return null;
}

// ─── Pre-AI Other Language Requirement Detection ─────────────────────────────
// "Dutch C2 required" / "French native speaker" / "fluent in Polish"
// These are NOT English-language jobs even if they're in Berlin.
// Catches Jobs 32, 33, 143, 165 from the report.
//
// Returns { matched: true, language: "...", phrase: "..." } or null
//
const OTHER_LANGUAGES = [
    'french', 'dutch', 'polish', 'turkish', 'spanish', 'italian',
    'portuguese', 'czech', 'hungarian', 'romanian', 'danish',
    'swedish', 'norwegian', 'finnish', 'greek', 'arabic',
    'russian', 'ukrainian', 'japanese', 'chinese', 'mandarin',
    'cantonese', 'korean', 'hindi', 'hebrew',
];

const OTHER_LANG_PATTERNS = OTHER_LANGUAGES.map(lang => ({
    language: lang,
    patterns: [
        new RegExp(`\\b(?:fluent|fluency|native|proficient|proficiency)\\s+(?:in\\s+)?${lang}\\b`, 'i'),
        new RegExp(`\\b${lang}\\s+(?:required|mandatory|essential|fluent|native|proficiency)\\b`, 'i'),
        new RegExp(`\\b${lang}\\s+(?:c[12]|b2)\\b`, 'i'),
        new RegExp(`\\b(?:c[12]|b2)\\s+(?:level\\s+)?(?:in\\s+)?${lang}\\b`, 'i'),
        new RegExp(`\\b${lang}\\s+(?:native\\s+)?speaker\\b`, 'i'),
        new RegExp(`\\bnative[\\s-]+(?:level\\s+)?${lang}\\b`, 'i'),
    ],
}));

function detectOtherLanguageRequired(description) {
    if (!description) return null;
    const text = String(description);

    for (const { language, patterns } of OTHER_LANG_PATTERNS) {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return { matched: true, language, phrase: match[0] };
            }
        }
    }
    return null;
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