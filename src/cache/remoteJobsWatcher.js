// ─── Remote jobs cache watcher ─────────────────────────────────────────────
//
// Keeps the RAM cache in step with the `remoteJobs` collection in real time,
// without polling and without reloading the collection.
//
// The cache used to be filled at boot and refreshed only by the German
// scraper's daily cron, so anything the remote scraper wrote was invisible to
// the API until the next restart. This replaces that with change data capture:
// MongoDB pushes each write to us as it commits, and we mutate the affected
// cache entry in place.
//
// Design, and why each part is here:
//
//   Push, not poll — a change stream costs one idle connection. Polling for
//   freshness would mean a query every few seconds forever, most of them
//   finding nothing, which is precisely the cost this is meant to avoid.
//
//   Batching — the scraper commits in bulks of 500. Applying those one at a
//   time would re-sort the salary index once per document. Events are collected
//   over a short window and applied as a single batch.
//
//   Resume tokens — the token of the last applied event is persisted, so a
//   restart resumes from that point instead of silently missing whatever landed
//   while the process was down.
//
//   Reconciliation — a periodic full reload, cheap and infrequent, as a floor
//   under any drift: a missed event, an expired token, a bug here.
//
//   Fallback — a deployment without a replica set cannot serve change streams
//   at all. Rather than fail, the watcher degrades to a watermark poll that
//   reloads only when the collection has actually changed.

import { connectToRemoteDb } from '../db/connection.js';
import {
    initRemoteJobsCache,
    applyRemoteJobChanges,
    getRemoteCacheStats,
} from './remoteJobsCache.js';

const JOBS_COLLECTION = 'remoteJobs';
const TOKEN_COLLECTION = 'cacheState';
const TOKEN_ID = 'remoteJobsWatcher';

// Events are collected for this long before being applied. Long enough to
// coalesce a 500-document bulk write into one batch, short enough that a single
// edit still reaches the API effectively immediately.
const BATCH_WINDOW_MS = 300;

// Safety net against drift. Infrequent by design — this is a backstop, not the
// mechanism.
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Backoff bounds for reconnecting after a stream error.
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60000;

// Only these fields can change what the cache or its indexes hold. An update
// touching just `scrapedAt` — which is most of what a scraper run produces —
// is not worth a cache mutation.
const SIGNIFICANT_FIELDS = [
    'Status', 'JobTitle', 'Company', 'Country', 'WorkplaceType', 'EmploymentType',
    'ExperienceLevel', 'Category', 'Domain', 'SubDomain', 'Description',
    'DescriptionHtml', 'ApplicationURL', 'DirectApplyURL', 'PostedDate',
    'SalaryMin', 'SalaryMax', 'SalaryCurrency', 'SalaryInterval',
    'filterWorkplace', 'filterExperience', 'filterEmployment',
    'filterSalaryTier', 'filterSalaryMin', 'filterSalaryMax',
];

let changeStream = null;
let reconcileTimer = null;
let pollTimer = null;
let batchTimer = null;
let stopped = false;
let retryDelay = RETRY_BASE_MS;

/** Events awaiting their batch window. */
let pending = [];

const stats = {
    mode: 'stopped',          // 'changestream' | 'polling' | 'stopped'
    eventsReceived: 0,
    eventsApplied: 0,
    batchesApplied: 0,
    reconciliations: 0,
    reconnects: 0,
    lastEventAt: null,
    lastError: null,
};

// ─── Resume token persistence ──────────────────────────────────────────────

async function loadResumeToken(db) {
    try {
        const doc = await db.collection(TOKEN_COLLECTION).findOne({ _id: TOKEN_ID });
        return doc?.resumeToken ?? null;
    } catch {
        return null;
    }
}

async function saveResumeToken(db, token) {
    if (!token) return;
    try {
        await db.collection(TOKEN_COLLECTION).updateOne(
            { _id: TOKEN_ID },
            { $set: { resumeToken: token, updatedAt: new Date() } },
            { upsert: true },
        );
    } catch (error) {
        // A token we cannot persist costs us resume-after-restart, not
        // correctness — reconciliation still covers the gap.
        console.warn('[remoteJobsWatcher] could not persist resume token:', error.message);
    }
}

// ─── Batch application ─────────────────────────────────────────────────────

/** True when an update touched a field the cache actually indexes. */
function isSignificantUpdate(event) {
    if (event.operationType !== 'update') return true;

    const description = event.updateDescription;
    if (!description) return true;

    const touched = [
        ...Object.keys(description.updatedFields || {}),
        ...(description.removedFields || []),
    ];

    // A field inside a nested path still counts — compare on the root segment.
    return touched.some(field => SIGNIFICANT_FIELDS.includes(field.split('.')[0]));
}

function queueEvent(event) {
    stats.eventsReceived++;
    stats.lastEventAt = new Date();

    switch (event.operationType) {
        case 'insert':
        case 'replace':
        case 'update':
            if (!isSignificantUpdate(event)) return;
            // fullDocument is present because the stream requests updateLookup.
            if (event.fullDocument) {
                pending.push({ type: 'upsert', job: event.fullDocument });
            }
            break;

        case 'delete':
            // Only _id is available on a delete, so the JobID has to be resolved
            // from the cache side. documentKey._id is not the JobID.
            pending.push({ type: 'delete-by-id', _id: event.documentKey?._id });
            break;

        case 'drop':
        case 'dropDatabase':
        case 'rename':
            // The collection went away underneath us; a full reload is the only
            // coherent response.
            pending.push({ type: 'reconcile' });
            break;

        default:
            break;
    }
}

async function flushPending(db) {
    if (pending.length === 0) return;

    const batch = pending;
    pending = [];

    if (batch.some(change => change.type === 'reconcile')) {
        await reconcile('collection-level change');
        return;
    }

    // Deletes arrive with only _id. Resolve them to JobIDs in one query rather
    // than one per event.
    const deleteIds = batch.filter(c => c.type === 'delete-by-id' && c._id).map(c => c._id);
    const changes = batch.filter(c => c.type === 'upsert');

    if (deleteIds.length > 0) {
        // The documents are already gone, so they cannot be looked up. Falling
        // back to reconciliation is correct but heavy; in practice this pipeline
        // expires jobs by flipping Status rather than deleting, so this path is
        // rare.
        await reconcile(`${deleteIds.length} hard delete(s)`);
        return;
    }

    const result = applyRemoteJobChanges(changes);
    stats.eventsApplied += result.upserted + result.removed;
    stats.batchesApplied++;

    console.log(`[remoteJobsWatcher] applied ${result.upserted} upserts, ${result.removed} removals (cache size ${getRemoteCacheStats().size})`);
}

function scheduleFlush(db) {
    if (batchTimer) return;

    batchTimer = setTimeout(async () => {
        batchTimer = null;
        try {
            await flushPending(db);
        } catch (error) {
            console.error('[remoteJobsWatcher] batch apply failed:', error.message);
            stats.lastError = error.message;
        }
    }, BATCH_WINDOW_MS);

    // A pending flush must never hold the process open on shutdown.
    if (typeof batchTimer.unref === 'function') batchTimer.unref();
}

// ─── Reconciliation ────────────────────────────────────────────────────────

async function reconcile(reason) {
    try {
        await initRemoteJobsCache();
        stats.reconciliations++;
        console.log(`[remoteJobsWatcher] reconciled cache (${reason}) — ${getRemoteCacheStats().size} jobs`);
    } catch (error) {
        stats.lastError = error.message;
        console.error('[remoteJobsWatcher] reconciliation failed:', error.message);
    }
}

// ─── Change stream ─────────────────────────────────────────────────────────

// Incremented per stream. Handlers capture their generation and ignore events
// from a stream that has already been replaced, so a late 'close' from a dead
// stream cannot restart a live one.
let streamGeneration = 0;

async function runChangeStream(db) {
    const resumeToken = await loadResumeToken(db);

    const options = { fullDocument: 'updateLookup' };
    if (resumeToken) options.resumeAfter = resumeToken;

    const generation = ++streamGeneration;
    changeStream = db.collection(JOBS_COLLECTION).watch([], options);
    stats.mode = 'changestream';
    console.log(`[remoteJobsWatcher] watching remoteJobs via change stream${resumeToken ? ' (resumed)' : ''}`);

    changeStream.on('change', (event) => {
        queueEvent(event);
        scheduleFlush(db);
        // Persisted per event but written lazily — updateOne on a single tiny
        // document is cheap next to the batch it accompanies.
        void saveResumeToken(db, event._id);
        retryDelay = RETRY_BASE_MS; // a delivered event proves the stream is healthy
    });

    changeStream.on('error', async (error) => {
        if (generation !== streamGeneration) return;
        stats.lastError = error.message;
        console.error('[remoteJobsWatcher] change stream error:', error.message);
        await restartAfterError(db, error);
    });

    // The driver emits 'close' BEFORE 'error', so acting on close immediately
    // would restart with a generic reason and never see the real one — which is
    // how an unsupported deployment turned into an endless reconnect loop. The
    // short delay lets the error handler classify the failure first; if it did,
    // it has already bumped the generation and this becomes a no-op.
    changeStream.on('close', () => {
        if (generation !== streamGeneration || stopped) return;

        const timer = setTimeout(() => {
            if (generation !== streamGeneration || stopped) return;
            void restartAfterError(db, new Error('stream closed unexpectedly'));
        }, 250);
        if (typeof timer.unref === 'function') timer.unref();
    });
}

/**
 * True when the deployment cannot serve change streams at all.
 *
 * A standalone mongod has no oplog, so `$changeStream` is rejected on every
 * attempt. Retrying that is not a transient recovery — it is an infinite loop
 * against a server that will never say yes, which is exactly what the first
 * test run produced: four reconnects, zero events.
 */
function isUnsupportedDeployment(error) {
    return /only supported on replica sets|\$changeStream.*not supported|not supported on standalone/i
        .test(error?.message || '');
}

async function restartAfterError(db, error) {
    if (stopped) return;

    streamGeneration++;   // retire the failed stream's handlers
    try { await changeStream?.close(); } catch { /* already closing */ }
    changeStream = null;

    // Unsupported is permanent. Stop trying and degrade to polling, which does
    // work on a standalone.
    if (isUnsupportedDeployment(error)) {
        console.warn('[remoteJobsWatcher] deployment does not support change streams — switching to polling permanently');
        startPolling(db);
        return;
    }

    // An invalid or expired resume token cannot be retried — the oplog no longer
    // reaches back that far. Drop it, reconcile, and start a fresh stream.
    const isTokenProblem = /resume|oplog|ChangeStreamHistoryLost/i.test(error.message || '');
    if (isTokenProblem) {
        console.warn('[remoteJobsWatcher] resume point lost — reconciling and restarting clean');
        await db.collection(TOKEN_COLLECTION).deleteOne({ _id: TOKEN_ID }).catch(() => {});
        await reconcile('resume token lost');
    }

    stats.reconnects++;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);

    const timer = setTimeout(() => {
        if (!stopped) runChangeStream(db).catch(err => console.error('[remoteJobsWatcher] restart failed:', err.message));
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
}

// ─── Polling fallback ──────────────────────────────────────────────────────
//
// Used only where change streams are unavailable (a standalone mongod). Reads a
// watermark — document count plus the newest scrapedAt — and reloads only when
// it moves, so a quiet collection costs one cheap query per interval and no
// reload at all.

const POLL_INTERVAL_MS = 60000;
let lastWatermark = null;

async function readWatermark(db) {
    const collection = db.collection(JOBS_COLLECTION);
    const [count, newest] = await Promise.all([
        collection.countDocuments({ Status: 'active' }),
        collection.find({}, { projection: { scrapedAt: 1 } }).sort({ scrapedAt: -1 }).limit(1).next(),
    ]);
    return `${count}|${newest?.scrapedAt?.getTime?.() ?? 0}`;
}

function startPolling(db) {
    stats.mode = 'polling';
    console.log(`[remoteJobsWatcher] change streams unavailable — falling back to ${POLL_INTERVAL_MS / 1000}s watermark polling`);

    pollTimer = setInterval(async () => {
        if (stopped) return;
        try {
            const watermark = await readWatermark(db);
            if (watermark !== lastWatermark) {
                lastWatermark = watermark;
                await reconcile('watermark changed');
            }
        } catch (error) {
            stats.lastError = error.message;
        }
    }, POLL_INTERVAL_MS);

    if (typeof pollTimer.unref === 'function') pollTimer.unref();
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Starts watching. Safe to call once at boot, after the cache is initialised.
 * Never throws — a watcher that cannot start leaves the cache exactly as it is
 * today rather than taking the API down with it.
 */
export async function startRemoteJobsWatcher() {
    if (changeStream || pollTimer) {
        console.warn('[remoteJobsWatcher] already running');
        return stats.mode;
    }

    stopped = false;

    try {
        const db = await connectToRemoteDb();

        try {
            await runChangeStream(db);
        } catch (error) {
            // $changeStream is rejected outright on a standalone deployment.
            console.warn('[remoteJobsWatcher] could not open change stream:', error.message);
            startPolling(db);
        }

        reconcileTimer = setInterval(() => {
            if (!stopped) void reconcile('scheduled');
        }, RECONCILE_INTERVAL_MS);
        if (typeof reconcileTimer.unref === 'function') reconcileTimer.unref();

        return stats.mode;

    } catch (error) {
        stats.mode = 'stopped';
        stats.lastError = error.message;
        console.error('[remoteJobsWatcher] failed to start:', error.message);
        return 'stopped';
    }
}

/** Stops the watcher and releases its timers. */
export async function stopRemoteJobsWatcher() {
    stopped = true;

    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    try { await changeStream?.close(); } catch { /* nothing to do */ }
    changeStream = null;

    stats.mode = 'stopped';
    console.log('[remoteJobsWatcher] stopped');
}

export function getRemoteJobsWatcherStats() {
    return { ...stats, pendingEvents: pending.length };
}
