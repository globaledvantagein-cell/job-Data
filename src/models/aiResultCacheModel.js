// ─── AI Result Cache Model ─────────────────────────────────────────────────────
//
// Replaces the jobTestLogs collection as the backing store for the scraper's
// fingerprint cache. jobTestLogs kept a full copy of every job it had ever seen
// — Description included — which is how it reached 91MB across 15K docs while
// only five of its fields were ever read back.
//
// This schema stores exactly what the cache hit needs to reconstruct an AI
// verdict and nothing else: no Description, JobTitle, Company, Location,
// Evidence, sourceSite or JobID. The fingerprint (MD5 of title + company +
// first 500 chars of description) is the only identity that matters here.

import mongoose from 'mongoose';

const { Schema } = mongoose;

const aiResultCacheSchema = new Schema({
    fingerprint: { type: String, required: true, unique: true, index: true },
    germanRequired: { type: Boolean, required: true },
    confidence: { type: Number, required: true },
    domain: { type: String, default: 'Unclear' },
    subDomain: { type: String, default: 'Other' },
    createdAt: { type: Date, default: Date.now },
}, {
    collection: 'aiResultCache',
    // No __v: nothing versions these docs, and the point of the collection is
    // to be small. 15K entries × a few bytes each is free to not store.
    versionKey: false,
});

export const AiResultCache = mongoose.models.AiResultCache
    || mongoose.model('AiResultCache', aiResultCacheSchema);
