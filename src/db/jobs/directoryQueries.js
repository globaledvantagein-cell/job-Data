import { connectToDb } from '../connection.js';
import { normalizeCompanyName } from '../../utils/companyUtils.js';

// ─── Company Profiles ─────────────────────────────────────────────────────
// Admin-authored descriptions for the directory, in `companyProfiles`.
//
// Keyed by normalizeCompanyName() rather than the raw name, so "Databricks
// GmbH" and "Databricks Inc." resolve to one profile. displayName keeps the
// last name an admin actually typed, for the admin UI.

let profileIndexCreated = false;
async function ensureProfileIndex(db) {
    if (profileIndexCreated) return;
    await db.collection('companyProfiles').createIndex({ companyKey: 1 }, { unique: true }).catch(() => {});
    profileIndexCreated = true;
}

/**
 * Upserts a company profile. Only the fields provided are written, so a caller
 * updating just the description can't blank out an existing website or logo.
 */
export async function updateCompanyDescription(companyName, { description, website, logo } = {}) {
    const db = await connectToDb();
    await ensureProfileIndex(db);

    const companyKey = normalizeCompanyName(companyName);
    if (!companyKey) throw new Error('Company name is required');

    const fields = { updatedAt: new Date() };
    if (description !== undefined) fields.description = String(description || '').trim();
    if (website !== undefined) fields.website = String(website || '').trim() || null;
    if (logo !== undefined) fields.logo = String(logo || '').trim() || null;

    await db.collection('companyProfiles').updateOne(
        { companyKey },
        {
            $set: { ...fields, displayName: String(companyName).trim() },
            $setOnInsert: { companyKey, createdAt: new Date() },
        },
        { upsert: true },
    );

    return await db.collection('companyProfiles').findOne({ companyKey });
}

export async function getCompanyProfile(companyName) {
    const db = await connectToDb();
    const companyKey = normalizeCompanyName(companyName);
    if (!companyKey) return null;
    return await db.collection('companyProfiles').findOne({ companyKey });
}

export async function getAllCompanyProfiles() {
    const db = await connectToDb();
    return await db.collection('companyProfiles').find({}).sort({ displayName: 1 }).toArray();
}

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

        // Attach admin-authored descriptions. Matched on the normalized key, so
        // one profile covers every legal-suffix variant of the same company.
        const profiles = await db.collection('companyProfiles').find({}).toArray();
        if (profiles.length > 0) {
            const profilesByKey = new Map(profiles.map(p => [p.companyKey, p]));
            for (const company of merged) {
                const profile = profilesByKey.get(normalizeCompanyName(company.companyName));
                if (!profile) continue;
                company.description = profile.description || null;
                company.website = profile.website || null;
                company.logo = profile.logo || null;
            }
        }

        return merged;
    } catch (error) {
        console.error("Stats: Aggregation failed:", error);
        return [];
    }
}
