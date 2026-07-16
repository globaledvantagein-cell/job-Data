/**
 * Career Guide article queries — the `careerGuide` collection.
 *
 * Articles are admin-authored markdown. `content` stores RAW markdown; it is
 * rendered to HTML at serve time (see api/careerGuide.routes.js), never at
 * write time — so fixing the renderer never requires a data migration.
 *
 * Status is 'draft' | 'published'. Every public query filters to 'published';
 * only getAllArticlesAdmin() sees drafts.
 */
import { ObjectId } from 'mongodb';
import { connectToDb } from './connection.js';

export const CAREER_GUIDE_CATEGORIES = [
    'finding-jobs',
    'companies',
    'visas-immigration',
    'salaries-careers',
    'students-graduates',
    'living-in-germany',
];

export const CAREER_GUIDE_CATEGORY_LABELS = {
    'finding-jobs': 'Finding Jobs',
    'companies': 'Companies',
    'visas-immigration': 'Visas & Immigration',
    'salaries-careers': 'Salaries & Careers',
    'students-graduates': 'Students & Graduates',
    'living-in-germany': 'Living in Germany',
};

/**
 * Builds a URL-safe slug from a title.
 * Strips diacritics so "Anmeldung für Ausländer" → "anmeldung-fur-auslander".
 */
export function slugify(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // drop combining accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

/** Idempotent index setup — slug is the public lookup key, so it must be unique. */
let indexesCreated = false;
async function ensureIndexes(db) {
    if (indexesCreated) return;
    await db.collection('careerGuide').createIndex({ slug: 1 }, { unique: true }).catch(() => {});
    await db.collection('careerGuide').createIndex({ status: 1, publishedAt: -1 }).catch(() => {});
    await db.collection('careerGuide').createIndex({ category: 1, status: 1 }).catch(() => {});
    indexesCreated = true;
}

async function getCollection() {
    const db = await connectToDb();
    await ensureIndexes(db);
    return db.collection('careerGuide');
}

/**
 * Ensures the slug is unique by appending -2, -3, … on collision.
 * Without this the unique index would throw a raw E11000 at the route.
 */
async function findAvailableSlug(collection, baseSlug, excludeId) {
    let candidate = baseSlug;
    let suffix = 2;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const query = { slug: candidate };
        if (excludeId) query._id = { $ne: new ObjectId(excludeId) };
        const clash = await collection.findOne(query, { projection: { _id: 1 } });
        if (!clash) return candidate;
        candidate = `${baseSlug}-${suffix}`;
        suffix += 1;
    }
}

export async function createArticle({ title, slug, category, content, description, author, tags, status }) {
    const collection = await getCollection();

    if (!title || !String(title).trim()) throw new Error('Title is required');
    if (!CAREER_GUIDE_CATEGORIES.includes(category)) throw new Error('Invalid category');

    const baseSlug = slugify(slug || title);
    if (!baseSlug) throw new Error('Could not derive a slug from the title');

    const now = new Date();
    const finalStatus = status === 'published' ? 'published' : 'draft';

    const article = {
        title: String(title).trim(),
        slug: await findAvailableSlug(collection, baseSlug),
        category,
        content: String(content || ''),
        description: String(description || '').slice(0, 160),
        author: String(author || '').trim() || 'English Jobs Germany',
        tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
        status: finalStatus,
        // publishedAt is only meaningful once live — stays null for drafts so
        // "first publish" can be detected later.
        publishedAt: finalStatus === 'published' ? now : null,
        createdAt: now,
        updatedAt: now,
    };

    const result = await collection.insertOne(article);
    return { ...article, _id: result.insertedId };
}

export async function updateArticle(id, updates) {
    const collection = await getCollection();
    if (!ObjectId.isValid(id)) throw new Error('Invalid article id');

    const fields = { updatedAt: new Date() };

    if (updates.title !== undefined) fields.title = String(updates.title).trim();
    if (updates.content !== undefined) fields.content = String(updates.content);
    if (updates.description !== undefined) fields.description = String(updates.description).slice(0, 160);
    if (updates.author !== undefined) fields.author = String(updates.author).trim();
    if (updates.tags !== undefined) {
        fields.tags = Array.isArray(updates.tags) ? updates.tags.map(t => String(t).trim()).filter(Boolean) : [];
    }
    if (updates.category !== undefined) {
        if (!CAREER_GUIDE_CATEGORIES.includes(updates.category)) throw new Error('Invalid category');
        fields.category = updates.category;
    }
    if (updates.slug !== undefined) {
        const baseSlug = slugify(updates.slug);
        if (!baseSlug) throw new Error('Invalid slug');
        fields.slug = await findAvailableSlug(collection, baseSlug, id);
    }

    await collection.updateOne({ _id: new ObjectId(id) }, { $set: fields });
    return await collection.findOne({ _id: new ObjectId(id) });
}

export async function deleteArticle(id) {
    const collection = await getCollection();
    if (!ObjectId.isValid(id)) throw new Error('Invalid article id');
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount > 0;
}

export async function getArticleBySlug(slug) {
    const collection = await getCollection();
    return await collection.findOne({ slug: String(slug || '').toLowerCase(), status: 'published' });
}

export async function getArticlesByCategory(category, { limit = 50, skip = 0 } = {}) {
    const collection = await getCollection();
    return await collection
        .find({ category, status: 'published' })
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
}

export async function getAllPublishedArticles({ limit = 50, skip = 0 } = {}) {
    const collection = await getCollection();
    return await collection
        .find({ status: 'published' })
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
}

/** Admin listing — includes drafts. Drafts have no publishedAt, so sort by updatedAt. */
export async function getAllArticlesAdmin() {
    const collection = await getCollection();
    return await collection.find({}).sort({ updatedAt: -1 }).toArray();
}

export async function getArticleById(id) {
    const collection = await getCollection();
    if (!ObjectId.isValid(id)) return null;
    return await collection.findOne({ _id: new ObjectId(id) });
}

/**
 * Sets status='published'. publishedAt is stamped only on FIRST publish, so
 * re-publishing after an unpublish keeps the original date (and its SEO age).
 */
export async function publishArticle(id) {
    const collection = await getCollection();
    if (!ObjectId.isValid(id)) throw new Error('Invalid article id');

    const existing = await collection.findOne({ _id: new ObjectId(id) });
    if (!existing) return null;

    const now = new Date();
    const fields = { status: 'published', updatedAt: now };
    if (!existing.publishedAt) fields.publishedAt = now;

    await collection.updateOne({ _id: new ObjectId(id) }, { $set: fields });
    return await collection.findOne({ _id: new ObjectId(id) });
}

export async function unpublishArticle(id) {
    const collection = await getCollection();
    if (!ObjectId.isValid(id)) throw new Error('Invalid article id');

    await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'draft', updatedAt: new Date() } }
    );
    return await collection.findOne({ _id: new ObjectId(id) });
}

/** Published article counts per category, for the hub page and sitemap. */
export async function getCategories() {
    const collection = await getCollection();
    const rows = await collection.aggregate([
        { $match: { status: 'published' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
    ]).toArray();

    const counts = new Map(rows.map(r => [r._id, r.count]));

    // Every category is returned (count 0 included) so the hub can render the
    // full set; the sitemap filters to count > 0 itself.
    return CAREER_GUIDE_CATEGORIES.map(slug => ({
        slug,
        label: CAREER_GUIDE_CATEGORY_LABELS[slug],
        count: counts.get(slug) || 0,
    }));
}
