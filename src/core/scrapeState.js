// ─── Scrape state (main German pipeline) ───────────────────────────────────
//
// Change detection for the ATS configs' _fetchCompany methods, so a board that
// hasn't changed since the last run is skipped BEFORE its jobs enter
// _allJobsQueue — they never consume RAM and never reach the AI pipeline.
//
// Two layers, both inside _fetchCompany:
//   1. HTTP ETag — If-None-Match on the request; a 304 means nothing was even
//      downloaded. Additive: platforms that don't emit ETags just never 304.
//   2. Content hash — SHA-256 over sorted "id|title|location"-style
//      fingerprints of the RAW (pre-filter) job list. Descriptions are
//      deliberately excluded: copy edits shouldn't force a reprocess.
//
// The scrapeState collection is SHARED with ejg-remote-scraper (same document
// shape: { ats, slug, contentHash, ... } with a unique { slug, ats } index).
// Main-pipeline entries prefix the ats field with "de_" so the two pipelines
// never collide: remote writes ats:"greenhouse", we write ats:"de_greenhouse".

import { createHash } from 'node:crypto';
import { connectToDb } from '../db/connection.js';

const STATE_COLLECTION = 'scrapeState';
const MAIN_PIPELINE_PREFIX = 'de_';

function prefixedAts(ats) {
    return `${MAIN_PIPELINE_PREFIX}${ats}`;
}

/** Map key for a company — matches the loaded Map's keys. */
export function stateKey(ats, slug) {
    return `${prefixedAts(ats)}|${slug}`;
}

/**
 * Loads this platform's states into a Map keyed by stateKey(ats, slug).
 * One query per platform at initialize() time; the per-company loop then
 * performs zero database round-trips.
 */
export async function loadScrapeStates(ats) {
    const db = await connectToDb();
    // Safe to call every run; matches the remote scraper's index.
    await db.collection(STATE_COLLECTION).createIndex(
        { slug: 1, ats: 1 },
        { unique: true, name: 'slug_ats_unique' },
    );
    const docs = await db.collection(STATE_COLLECTION).find({ ats: prefixedAts(ats) }).toArray();
    const stateMap = new Map();
    for (const doc of docs) stateMap.set(`${doc.ats}|${doc.slug}`, doc);
    console.log(`[ScrapeState] ${ats}: loaded ${stateMap.size} company states`);
    return stateMap;
}

/**
 * SHA-256 over deterministically sorted fingerprint strings (one per job,
 * e.g. "id|title|location"). Sorting uses code-unit comparison — never
 * localeCompare, whose ordering is locale-dependent and would make the same
 * board hash differently on different machines.
 */
export function computeContentHash(fingerprints) {
    const sorted = [...(fingerprints || [])].sort((a, b) => {
        if (a === b) return 0;
        return a < b ? -1 : 1;
    });
    return createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex');
}

/**
 * Bulk-saves a platform's states in one round-trip.
 * Each entry: { slug, etag, contentHash, jobCount, changed }.
 * `changed: true` also stamps lastChangedAt; unchanged entries only refresh
 * lastCheckedAt (and the etag, which can rotate without content changing).
 */
export async function saveScrapeStatesBulk(ats, states) {
    if (!states || states.length === 0) return 0;

    const db = await connectToDb();
    const now = new Date();
    const operations = states.map(({ slug, etag, contentHash, jobCount, changed }) => ({
        updateOne: {
            filter: { slug, ats: prefixedAts(ats) },
            update: {
                $set: {
                    etag: etag ?? null,
                    contentHash: contentHash ?? null,
                    jobCount: jobCount ?? 0,
                    lastCheckedAt: now,
                    ...(changed ? { lastChangedAt: now } : {}),
                },
                $setOnInsert: { slug, ats: prefixedAts(ats), createdAt: now },
            },
            upsert: true,
        },
    }));

    const result = await db.collection(STATE_COLLECTION).bulkWrite(operations, { ordered: false });
    console.log(`[ScrapeState] ${ats}: saved ${states.length} states (${result.upsertedCount || 0} new, ${result.modifiedCount || 0} updated)`);
    return (result.upsertedCount || 0) + (result.modifiedCount || 0);
}
