import { deriveExperienceLevelFromTitle, deriveIsEntryLevelFromTitle } from '../../core/jobExtractor.js';

/**
 * Strip a full job document to a public-safe "teaser" used by list endpoints.
 * Description, ApplicationURL, and salary are DELIBERATELY omitted —
 * those are gated behind the /:id/full endpoint.
 */
export function toTeaser(job) {
    if (!job) return null;
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
        ATSPlatform: job.ATSPlatform,
        sourceSite: job.sourceSite,
        AllLocations: job.AllLocations,
        Country: job.Country,
        IsRemote: job.IsRemote,
        GermanRequired: job.GermanRequired,
        // Deliberately omitted: Description, DescriptionHtml, ApplicationURL,
        // DirectApplyURL, SalaryMin, SalaryMax, SalaryCurrency, SalaryInterval
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
