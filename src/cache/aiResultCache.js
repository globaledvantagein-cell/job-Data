// ─── AI Result Cache (RAM) ─────────────────────────────────────────────────────
//
// The scraper's fingerprint cache. Every job it has already sent to the AI is
// keyed by fingerprint, so a re-scrape of an unchanged posting reuses the old
// verdict instead of spending an API call.
//
// Same shape as the remote scraper's dedupCache: the whole collection is pulled
// into a Map at boot, and every lookup during a scrape run is an O(1) Map.get()
// with zero DB round-trips. That matters because the check runs once per job —
// the old per-job findOne() against a 91MB collection was pure overhead on a
// path that is otherwise CPU-bound.
//
// Writes go to BOTH the Map and MongoDB, so a hit within the same run works
// even before the next restart.

import { connectToDb } from '../db/connection.js';
import { AiResultCache } from '../models/aiResultCacheModel.js';

/** fingerprint -> { germanRequired, confidence, domain, subDomain } */
const cache = new Map();

let isReady = false;

/**
 * Loads every cached AI result into RAM. Call once during boot, before the
 * scraper runs.
 *
 * @returns {Promise<Map<string, object>>} the populated cache
 */
export async function initAiResultCache() {
    // Mongoose models need the connection open; connectToDb() opens both it and
    // the native driver handle used elsewhere.
    await connectToDb();

    cache.clear();

    const cursor = AiResultCache.find(
        {},
        { fingerprint: 1, germanRequired: 1, confidence: 1, domain: 1, subDomain: 1, _id: 0 },
    ).lean().cursor();

    for await (const doc of cursor) {
        if (!doc.fingerprint) continue;
        cache.set(doc.fingerprint, {
            germanRequired: doc.germanRequired,
            confidence: doc.confidence,
            domain: doc.domain,
            subDomain: doc.subDomain,
        });
    }

    isReady = true;
    console.log(`[AiCache] Loaded ${cache.size} cached AI results into memory`);
    return cache;
}

/**
 * Looks up a fingerprint. Synchronous — this is a Map read, not a query.
 *
 * @param {string} fingerprint
 * @returns {{ germanRequired: boolean, confidence: number, domain: string, subDomain: string } | null}
 */
export function lookupFingerprint(fingerprint) {
    if (!fingerprint) return null;
    return cache.get(fingerprint) || null;
}

/**
 * Records an AI verdict against a fingerprint, in RAM and in MongoDB.
 * Called after every successful analysis and after each pre-AI rejection.
 *
 * Upsert rather than insert: the same posting can be re-fingerprinted across
 * runs, and a duplicate key error here would abort a job the scraper had
 * already paid the API call for.
 */
export async function saveAiResult({ fingerprint, germanRequired, confidence, domain, subDomain }) {
    if (!fingerprint) return;

    const entry = {
        germanRequired: Boolean(germanRequired),
        confidence: Number(confidence) || 0,
        domain: domain || 'Unclear',
        subDomain: subDomain || 'Other',
    };

    // RAM first so a hit later in this same run works even if the write is slow.
    cache.set(fingerprint, entry);

    await AiResultCache.updateOne(
        { fingerprint },
        { $set: entry, $setOnInsert: { fingerprint, createdAt: new Date() } },
        { upsert: true },
    );
}

/** Number of fingerprints currently held in RAM. */
export function getCacheSize() {
    return cache.size;
}

/** True once initAiResultCache() has finished. */
export function isAiResultCacheReady() {
    return isReady;
}
