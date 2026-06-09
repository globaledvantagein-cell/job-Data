import {
    deriveExperienceLevelFromTitle,
    deriveIsEntryLevelFromTitle,
    inferAtsPlatform,
    normalizeArray,
} from '../jobExtractor.js';

/**
 * Convert a raw ATS job into our internal shape. Two code paths:
 *
 *  1. New-style site configs export individual `extract*` functions
 *     (greenhouse, ashby, lever, workday, …). We call each one and
 *     compose the mapped job here.
 *  2. Legacy site configs export a single `mapper()` function. We
 *     just run that.
 */
export function mapRawJob(rawJob, siteConfig) {
    if (siteConfig.extractJobID) {
        const extractedTitle = siteConfig.extractJobTitle(rawJob);
        const extractedExperience = siteConfig.extractExperienceLevel
            ? siteConfig.extractExperienceLevel(rawJob)
            : null;
        const derivedExperience = extractedExperience || deriveExperienceLevelFromTitle(extractedTitle);
        const extractedEntryLevel = siteConfig.extractIsEntryLevel
            ? siteConfig.extractIsEntryLevel(rawJob)
            : null;
        const derivedEntryLevel = extractedEntryLevel ?? deriveIsEntryLevelFromTitle(extractedTitle);

        return {
            JobID:           siteConfig.extractJobID(rawJob),
            JobTitle:        extractedTitle,
            Company:         siteConfig.extractCompany(rawJob),
            Location:        siteConfig.extractLocation(rawJob),
            Description:     siteConfig.extractDescription(rawJob),
            DescriptionHtml: siteConfig.extractDescriptionHtml ? siteConfig.extractDescriptionHtml(rawJob) : null,
            ApplicationURL:  siteConfig.extractURL(rawJob),
            PostedDate:      siteConfig.extractPostedDate ? siteConfig.extractPostedDate(rawJob) : new Date().toISOString(),
            DirectApplyURL:  siteConfig.extractDirectApplyURL ? siteConfig.extractDirectApplyURL(rawJob) : null,
            ATSPlatform:     siteConfig.extractATSPlatform ? siteConfig.extractATSPlatform(rawJob) : inferAtsPlatform(siteConfig),
            SalaryCurrency:  siteConfig.extractSalaryCurrency ? siteConfig.extractSalaryCurrency(rawJob) : null,
            SalaryMin:       siteConfig.extractSalaryMin ? siteConfig.extractSalaryMin(rawJob) : null,
            SalaryMax:       siteConfig.extractSalaryMax ? siteConfig.extractSalaryMax(rawJob) : null,
            SalaryInterval:  siteConfig.extractSalaryInterval ? siteConfig.extractSalaryInterval(rawJob) : null,
            Department:      siteConfig.extractDepartment ? siteConfig.extractDepartment(rawJob) : 'N/A',
            Team:            siteConfig.extractTeam ? siteConfig.extractTeam(rawJob) : null,
            WorkplaceType:   siteConfig.extractWorkplaceType ? siteConfig.extractWorkplaceType(rawJob) : 'Unspecified',
            EmploymentType:  siteConfig.extractEmploymentType ? siteConfig.extractEmploymentType(rawJob) : null,
            IsRemote:        siteConfig.extractIsRemote ? Boolean(siteConfig.extractIsRemote(rawJob)) : false,
            Country:         siteConfig.extractCountry ? siteConfig.extractCountry(rawJob) : null,
            AllLocations:    normalizeArray(siteConfig.extractAllLocations ? siteConfig.extractAllLocations(rawJob) : []),
            Office:          siteConfig.extractOffice ? siteConfig.extractOffice(rawJob) : null,
            Tags:            normalizeArray(siteConfig.extractTags ? siteConfig.extractTags(rawJob) : []),
            isEntryLevel:    Boolean(derivedEntryLevel),
            ExperienceLevel: derivedExperience,
        };
    }

    // Legacy mapper path
    const mappedJob = siteConfig.mapper(rawJob);
    const derivedExperience = mappedJob.ExperienceLevel || deriveExperienceLevelFromTitle(mappedJob.JobTitle);
    mappedJob.ExperienceLevel = derivedExperience;
    mappedJob.isEntryLevel = mappedJob.isEntryLevel ?? deriveIsEntryLevelFromTitle(mappedJob.JobTitle);
    mappedJob.AllLocations = normalizeArray(mappedJob.AllLocations);
    mappedJob.Tags = normalizeArray(mappedJob.Tags);
    mappedJob.ATSPlatform = mappedJob.ATSPlatform || inferAtsPlatform(siteConfig);
    return mappedJob;
}
