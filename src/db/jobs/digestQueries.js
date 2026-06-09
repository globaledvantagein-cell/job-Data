import { connectToDb } from '../connection.js';

/**
 * Fetch active English-only jobs posted in the last N days, grouped by Category.
 *
 * Strategy: ONE query for everyone. The weekly digest cron uses this single
 * result set to build per-user emails by filtering in memory.
 *
 * @param {number} days       - Look-back window in days (default 7)
 * @param {number} maxPerCat  - Soft cap on jobs returned per category (default 50)
 */
export async function getDigestJobs(days = 7, maxPerCat = 50) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const sinceDate = new Date(Date.now() - days * 86400000);

    // Fields the email template needs.
    // Reads the stored Category field (computed at scrape time in saveJobs)
    // instead of recomputing — faster and consistent with /api/jobs filtering.
   const jobs = await jobsCollection
    .find(
        {
            Status: 'active',
            GermanRequired: false,
            $or: [
                { PostedDate: { $gte: sinceDate } },
                { PostedDate: null,              scrapedAt: { $gte: sinceDate } },
                { PostedDate: { $exists: false }, scrapedAt: { $gte: sinceDate } },
            ],
        },
            {
                projection: {
                    JobID: 1,
                    JobTitle: 1,
                    Company: 1,
                    Location: 1,
                    EmploymentType: 1,
                    WorkplaceType: 1,
                    IsRemote: 1,
                    SalaryMin: 1,
                    SalaryMax: 1,
                    SalaryCurrency: 1,
                    SalaryInterval: 1,
                    ExperienceLevel: 1,
                    PostedDate: 1,
                    ApplicationURL: 1,
                    Category: 1,
                    applyClicks: 1,
                },
            },
        )
        .sort({ PostedDate: -1 })
        .toArray();

    // Group by stored Category, cap each bucket
    const byCategory = {};
    for (const job of jobs) {
        const cat = job.Category || 'other_tech';
        if (!byCategory[cat]) byCategory[cat] = [];
        if (byCategory[cat].length < maxPerCat) {
            byCategory[cat].push(job);
        }
    }

    return { byCategory, total: jobs.length };
}
