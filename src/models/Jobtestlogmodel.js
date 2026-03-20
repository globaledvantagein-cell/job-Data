const jobTestLogSchemaDefinition = {
    JobID: { type: String, required: true },
    sourceSite: { type: String, required: true },
    JobTitle: { type: String, required: true, trim: true },
    ApplicationURL: { type: String, required: true },
    DirectApplyURL: { type: String, default: null },
    Description: { type: String, default: "" },
    Location: { type: String, default: "N/A" },
    Company: { type: String, default: "N/A" },
    ATSPlatform: { type: String, default: "N/A" },
    
    GermanRequired: { type: Boolean, default: false },
    Domain: { type: String, default: "Unclear" },
    SubDomain: { type: String, default: "Other" },
    ConfidenceScore: { type: Number, default: 0 },
    
    Evidence: {
        type: Object,
        default: {
            german_reason: ""
        }
    },
    
    FinalDecision: { type: String, default: "rejected" },
    RejectionReason: { type: String, default: null },
    
    Status: { type: String, default: "pending_review" },
    
    Department: { type: String, default: "N/A" },
    Team: { type: String, default: null },
    Office: { type: String, default: null },
    WorkplaceType: { type: String, default: "Unspecified" },
    EmploymentType: { type: String, default: null },
    IsRemote: { type: Boolean, default: false },
    Country: { type: String, default: null },
    AllLocations: { type: Array, default: [] },
    Tags: { type: Array, default: [] },
    SalaryCurrency: { type: String, default: null },
    SalaryMin: { type: Number, default: null },
    SalaryMax: { type: Number, default: null },
    SalaryInterval: { type: String, default: null },
    isEntryLevel: { type: Boolean, default: false },
    ContractType: { type: String, default: "N/A" },
    ExperienceLevel: { type: String, default: "N/A" },
    PostedDate: { type: Date, default: null },
    createdAt: { type: Date },
    scrapedAt: { type: Date }
};

class JobTestLog {
    constructor(data) {
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.scrapedAt = new Date();

        for (const key in jobTestLogSchemaDefinition) {
            if (key === 'createdAt' || key === 'scrapedAt') continue;

            const schemaField = jobTestLogSchemaDefinition[key];
            let value = data[key];

            if (value === undefined || value === null) {
                this[key] = schemaField.default;
            } else {
                if (schemaField.type === String) {
                    this[key] = schemaField.trim ? String(value).trim() : String(value);
                } else if (schemaField.type === Number) {
                    this[key] = Number(value) || schemaField.default;
                } else if (schemaField.type === Boolean) {
                    if (typeof value === 'string') {
                        this[key] = value === 'true';
                    } else {
                        this[key] = Boolean(value);
                    }
                } else if (schemaField.type === Date) {
                    this[key] = new Date(value);
                } else if (schemaField.type === Object) {
                    this[key] = value;
                } else if (schemaField.type === Array) {
                    this[key] = Array.isArray(value) ? value : schemaField.default;
                } else {
                    this[key] = value;
                }
            }
        }
    }
}

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
        
        Evidence: jobData.Evidence || {
            german_reason: ""
        },
        
        FinalDecision: jobData.FinalDecision || "pending",
        RejectionReason: jobData.RejectionReason || null,
        Status: jobData.Status || "pending_review",
        fingerprint: jobData.fingerprint || null,
        
        createdAt: new Date(),
        scrapedAt: new Date()
    };
}