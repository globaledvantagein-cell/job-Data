import { connectToDb } from '../connection.js';

/**
 * Builds the public Company Directory page data.
 * Combines two sources:
 *   1. Scraped companies (from jobs with Status=active, GermanRequired=false)
 *   2. Manually curated companies (from manual_companies collection)
 *
 * Manual ones whose name matches a scraped company are skipped to avoid dupes.
 */
export async function getCompanyDirectoryStats() {
    try {
        const db = await connectToDb();
        const jobsCollection = db.collection('jobs');
        const manualCompaniesCollection = db.collection('manual_companies');

        // SCRAPED COMPANIES
        const pipeline = [
            {
                $match: {
                    Status: 'active',
                    GermanRequired: false
                }
            },
            {
                $group: {
                    _id: "$Company",
                    openRoles: { $sum: 1 },
                    locations: { $addToSet: "$Location" }
                }
            },
            { $sort: { openRoles: -1 } }
        ];
        const scrapedStats = await jobsCollection.aggregate(pipeline).toArray();
        const formattedScraped = scrapedStats.map(stat => ({
            _id: stat._id,
            companyName: stat._id || "Unknown",
            openRoles: stat.openRoles,
            cities: [...new Set((stat.locations || []).map(l => l.split(',')[0].trim()))].slice(0, 3),
            domain: null,
            careersUrl: null,
            source: 'scraped'
        }));

        // MANUAL COMPANIES
        const manualCompanies = await manualCompaniesCollection.find({}).toArray();
        // Deduplicate: skip manual if name matches a scraped company (case-insensitive)
        const scrapedNames = new Set(formattedScraped.map(c => c.companyName.toLowerCase()));
        const formattedManual = manualCompanies
            .filter(c => !scrapedNames.has((c.name || '').toLowerCase()))
            .map(c => ({
                _id: c._id.toString(),
                companyName: c.name,
                openRoles: 0,
                cities: c.cities ? (typeof c.cities === 'string' ? c.cities.split(',').map(s => s.trim()) : (Array.isArray(c.cities) ? c.cities : [])) : [],
                careersUrl: c.domain || null,
                source: 'manual'
            }));

        // Merge and sort: scraped (by openRoles desc), then manual (alpha)
        const merged = [
            ...formattedScraped,
            ...formattedManual.sort((a, b) => a.companyName.localeCompare(b.companyName))
        ];
        return merged;
    } catch (error) {
        console.error("Stats: Aggregation failed:", error);
        return [];
    }
}
