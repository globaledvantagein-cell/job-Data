import { connectToDb } from '../connection.js';
import { ALL_CATEGORIES } from '../../core/categorize.js';

export async function getJobsPaginated(page = 1, limit = 30, filters = {}) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const skip = (page - 1) * limit;

    // ── Base query ────────────────────────────────────────────────────────────
    const query = {
        Status: { $in: ['active'] },
        GermanRequired: false
    };

    // ── Company filter (multi-select array) ───────────────────────────────────
    if (filters.company && filters.company.length > 0) {
        query.Company = { $in: filters.company };
    }

    // ── Category filter (multi-select array) ──────────────────────────────────
    // Validates against the canonical list so we don't accept arbitrary input.
    if (filters.category && filters.category.length > 0) {
        const valid = filters.category.filter(c => ALL_CATEGORIES.includes(c));
        if (valid.length > 0) {
            query.Category = { $in: valid };
        }
    }

    // ── Additional $and conditions (search + date) ────────────────────────────
    const conditions = [];

    // Full-text search across title, company, location
    if (filters.search && filters.search.trim()) {
        const escaped = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        conditions.push({
            $or: [
                { JobTitle: regex },
                { Company: regex },
                { Location: regex }
            ]
        });
    }

    // Date range filter — falls back to scrapedAt when PostedDate is null
    if (filters.date && filters.date !== 'All') {
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysMap = { 'Today': 1, 'This Week': 7, 'This Month': 30 };
        const days = daysMap[filters.date];
        if (days) {
            const cutoff = new Date(Date.now() - days * msPerDay);
            conditions.push({
                $or: [
                    { PostedDate: { $gte: cutoff } },
                    { PostedDate: null,              scrapedAt: { $gte: cutoff } },
                    { PostedDate: { $exists: false }, scrapedAt: { $gte: cutoff } }
                ]
            });
        }
    }

    if (conditions.length > 0) {
        query.$and = conditions;
    }

    // ── Sort ──────────────────────────────────────────────────────────────────
    const sortOrder = filters.sort === 'company'
        ? { Company: 1, PostedDate: -1 }
        : { PostedDate: -1, createdAt: -1 };

    // ── Run count + find in parallel ──────────────────────────────────────────
    const [totalJobs, jobs] = await Promise.all([
        jobsCollection.countDocuments(query),
        jobsCollection.find(query)
            .sort(sortOrder)
            .skip(skip)
            .limit(limit)
            .toArray()
    ]);

    const normalizedJobs = jobs.map(job => ({
        ...job,
        applyClicks: job.applyClicks || 0
    }));

    return { jobs: normalizedJobs, totalJobs };
}

/**
 * All distinct active company names, sorted alphabetically.
 * Used to populate the company filter dropdown on the frontend.
 */
export async function getCompanyNames() {
    const db = await connectToDb();
    const names = await db.collection('jobs').distinct('Company', {
        Status: 'active',
        GermanRequired: false
    });
    return names.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/**
 * Job counts per Category, e.g.:
 *   { software: 533, data: 92, product_tech: 53, other_tech: 226, ... }
 * Used to populate the category filter dropdown with counts.
 * Only counts active, non-German-required jobs (same filter as the list endpoint).
 */
export async function getCategoryCounts() {
    const db = await connectToDb();
    const pipeline = [
        { $match: { Status: 'active', GermanRequired: false } },
        { $group: { _id: '$Category', count: { $sum: 1 } } },
    ];
    const results = await db.collection('jobs').aggregate(pipeline).toArray();

    // Build a complete map including zero-count categories so the UI can
    // render every option even when one has no jobs right now.
    const counts = {};
    for (const cat of ALL_CATEGORIES) counts[cat] = 0;
    for (const row of results) {
        if (row._id && counts.hasOwnProperty(row._id)) {
            counts[row._id] = row.count;
        }
    }
    return counts;
}
