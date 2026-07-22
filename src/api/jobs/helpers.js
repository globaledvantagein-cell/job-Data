import { deriveExperienceLevelFromTitle, deriveIsEntryLevelFromTitle } from '../../core/jobExtractor.js';
import { resolveAll } from '../../utils/filterNormalizer.js';

/**
 * Strip a full job document to a public-safe "teaser" used by list endpoints.
 * Description, ApplicationURL, and salary are DELIBERATELY omitted —
 * those are gated behind the /:id/full endpoint.
 */
export function toTeaser(job) {
    if (!job) return null;
    const filters = resolveAll(job);
    return {
        _id: job._id,
        JobID: job.JobID,
        JobTitle: job.JobTitle,
        Company: job.Company,
        Location: job.Location,
        Department: job.Department,
        Domain: job.Domain,
        SubDomain: job.SubDomain,
        Category: job.Category,
        WorkplaceType: job.WorkplaceType,
        EmploymentType: job.EmploymentType,
        ExperienceLevel: job.ExperienceLevel,
        isEntryLevel: job.isEntryLevel,
        ContractType: job.ContractType,
        Tags: job.Tags,
        PostedDate: job.PostedDate,
        scrapedAt: job.scrapedAt,
        applyClicks: job.applyClicks || 0,
        AllLocations: job.AllLocations,
        Country: job.Country,
        IsRemote: job.IsRemote,
        // Reconciled canonical filter fields (ATS + Gemma).
        filterWorkplace: filters.filterWorkplace,
        filterExperience: filters.filterExperience,
        filterEmployment: filters.filterEmployment,
        filterVisa: filters.filterVisa,
        filterRelocation: filters.filterRelocation,
        filterSalaryMin: filters.filterSalaryMin,
        filterSalaryMax: filters.filterSalaryMax,
        filterSalaryTier: filters.filterSalaryTier,
        // Deliberately omitted: Description, DescriptionHtml, ApplicationURL,
        // DirectApplyURL, SalaryMin, SalaryMax, SalaryCurrency, SalaryInterval,
        // ATSPlatform, sourceSite, GermanRequired (internal / infra leakage)
    };
}

/**
 * Strip a FULL job document to a public-safe shape before it leaves the API.
 *
 * Uses an explicit INCLUDE list (allowlist), not an exclude list — a new
 * internal field added to the schema can never leak by default; it simply won't
 * appear here until deliberately added. Everything not listed is dropped,
 * including scraping infrastructure (ATSPlatform, sourceSite), AI internals
 * (ConfidenceScore, parsedRequirements), and workflow state (Status,
 * RejectionReason, reviewedAt, reviewedBy, GermanRequired).
 */
export function toPublicJob(job) {
    if (!job) return null;
    const filters = resolveAll(job);
    return {
        // Identity
        _id: job._id,
        JobID: job.JobID,
        // Display
        JobTitle: job.JobTitle,
        Company: job.Company,
        Location: job.Location,
        AllLocations: job.AllLocations,
        Country: job.Country,
        Department: job.Department,
        // Content
        Description: job.Description,
        DescriptionHtml: job.DescriptionHtml,
        ApplicationURL: job.ApplicationURL,
        DirectApplyURL: job.DirectApplyURL,
        // Classification
        Category: job.Category,
        Domain: job.Domain,
        SubDomain: job.SubDomain,
        // Dates
        PostedDate: job.PostedDate,
        scrapedAt: job.scrapedAt,
        // Engagement
        applyClicks: job.applyClicks || 0,
        // Tags
        Tags: job.Tags,
        // Reconciled canonical filter fields (ATS + Gemma).
        filterWorkplace: filters.filterWorkplace,
        filterExperience: filters.filterExperience,
        filterEmployment: filters.filterEmployment,
        filterVisa: filters.filterVisa,
        filterRelocation: filters.filterRelocation,
        filterSalaryMin: filters.filterSalaryMin,
        filterSalaryMax: filters.filterSalaryMax,
        filterSalaryCurrency: filters.filterSalaryCurrency,
        filterSalaryInterval: filters.filterSalaryInterval,
        filterSalaryTier: filters.filterSalaryTier,
        // Legacy display fields (kept for backward compat)
        WorkplaceType: job.WorkplaceType,
        ExperienceLevel: job.ExperienceLevel,
        EmploymentType: job.EmploymentType,
        IsRemote: job.IsRemote,
        isEntryLevel: job.isEntryLevel,
        ContractType: job.ContractType,
    };
}

/**
 * Returns true if a job was manually reviewed by an admin (accept or reject).
 * Used to block AI re-analysis from overwriting admin decisions.
 */
export function isManuallyReviewed(job) {
    const reviewed = job?.reviewedAt !== undefined && job?.reviewedAt !== null;
    if (!reviewed) return false;
    return job?.Status === 'active' || job?.Status === 'rejected';
}

/**
 * Fill in WorkplaceType from Location + Description text when missing or 'Unspecified'.
 * Used during backfill — does NOT overwrite existing meaningful values.
 */
export function deriveWorkplaceType(workplaceType, location = '', description = '') {
    const current = String(workplaceType || '').trim();
    if (current && current.toLowerCase() !== 'unspecified') {
        return current;
    }

    const haystack = `${String(location).toLowerCase()} ${String(description).toLowerCase().slice(0, 500)}`;

    if (haystack.includes('remote') || haystack.includes('fully remote') || haystack.includes('work from home')) {
        return 'Remote';
    }
    if (haystack.includes('hybrid')) {
        return 'Hybrid';
    }
    return 'Unspecified';
}

/**
 * Backfill ExperienceLevel / isEntryLevel / WorkplaceType on documents that
 * were saved before those fields existed. One pass over the given collection.
 */
export async function backfillExperienceForCollection(collection) {
    const documents = await collection.find({
        $or: [
            { ExperienceLevel: 'N/A' },
            { ExperienceLevel: { $exists: false } },
            { ExperienceLevel: null }
        ]
    }).toArray();

    let updated = 0;

    for (const document of documents) {
        const title = document.JobTitle || '';
        const experienceLevel = deriveExperienceLevelFromTitle(title);
        const isEntryLevel = deriveIsEntryLevelFromTitle(title);
        const workplaceType = deriveWorkplaceType(document.WorkplaceType, document.Location, document.Description);

        await collection.updateOne(
            { _id: document._id },
            {
                $set: {
                    ExperienceLevel: experienceLevel,
                    isEntryLevel,
                    WorkplaceType: workplaceType
                }
            }
        );

        updated += 1;
    }

    return { total: documents.length, updated };
}
