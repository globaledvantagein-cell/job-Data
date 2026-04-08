export function createJobTestLog(jobData, sourceSite) {
    return {
        JobID: jobData.JobID,
        sourceSite: sourceSite,
        JobTitle: jobData.JobTitle,
        Company: jobData.Company,
        Location: jobData.Location,
        Description: jobData.Description,
        ApplicationURL: jobData.ApplicationURL,
        DirectApplyURL: jobData.DirectApplyURL || null,
        ATSPlatform: jobData.ATSPlatform || null,
        PostedDate: jobData.PostedDate || jobData.DatePosted || null,
        Department: jobData.Department || "N/A",
        Team: jobData.Team || null,
        Office: jobData.Office || null,
        WorkplaceType: jobData.WorkplaceType || "Unspecified",
        EmploymentType: jobData.EmploymentType || null,
        IsRemote: Boolean(jobData.IsRemote),
        Country: jobData.Country || null,
        AllLocations: Array.isArray(jobData.AllLocations) ? jobData.AllLocations : [],
        Tags: Array.isArray(jobData.Tags) ? jobData.Tags : [],
        SalaryCurrency: jobData.SalaryCurrency || null,
        SalaryMin: jobData.SalaryMin ?? null,
        SalaryMax: jobData.SalaryMax ?? null,
        SalaryInterval: jobData.SalaryInterval || null,
        isEntryLevel: Boolean(jobData.isEntryLevel),
        ExperienceLevel: jobData.ExperienceLevel || "N/A",
        ContractType: jobData.ContractType || "N/A",

        GermanRequired: jobData.GermanRequired,
        Domain: jobData.Domain || "N/A",
        SubDomain: jobData.SubDomain || "N/A",
        ConfidenceScore: jobData.ConfidenceScore || 0,

        Evidence: jobData.Evidence || { german_reason: "" },

        FinalDecision: jobData.FinalDecision || "pending",
        RejectionReason: jobData.RejectionReason || null,
        Status: jobData.Status || "pending_review",
        fingerprint: jobData.fingerprint || null,

        createdAt: new Date(),
        scrapedAt: new Date()
    };
}
