const jobSchemaDefinition = {
    JobID: { type: String, required: true },
    sourceSite: { type: String, required: true },
    JobTitle: { type: String, required: true, trim: true },
    ApplicationURL: { type: String, required: true },
    DirectApplyURL: { type: String, default: null },
    Description: { type: String, default: "" },
    DescriptionHtml: { type: String, default: null },
    Location: { type: String, default: "N/A" },
    Company: { type: String, default: "N/A" },
    ATSPlatform: { type: String, default: "N/A" },
    
    GermanRequired: { type: Boolean, default: false },
    Domain: { type: String, default: "Unclear" },
    SubDomain: { type: String, default: "Other" },
    ConfidenceScore: { type: Number, default: 0 },
    
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
    applyClicks: { type: Number, default: 0 },
    PostedDate: { type: Date, default: null },
    createdAt: { type: Date },
    updatedAt: { type: Date },
    scrapedAt: { type: Date }
};

class Job {
    constructor(data) {
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.updatedAt = new Date();
        this.scrapedAt = new Date();

        for (const key in jobSchemaDefinition) {
            if (key === 'createdAt' || key === 'updatedAt' || key === 'scrapedAt') continue;

            const schemaField = jobSchemaDefinition[key];
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
                } else if (schemaField.type === Array) {
                    this[key] = Array.isArray(value) ? value : schemaField.default;
                } else {
                    this[key] = value;
                }
            }
        }
    }
}

export const createJobModel = (mappedJob, siteName) => {
    return new Job({
        ...mappedJob,
        sourceSite: siteName,
        Company: mappedJob.Company || siteName,
    });
}