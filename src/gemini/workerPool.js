// ─── Gemini Worker Pool ────────────────────────────────────────────────────────
//
// A concurrency limiter sized to the number of live API keys. Running more
// tasks in flight than we have keys just piles requests onto keys that are
// already at their per-minute ceiling; running fewer leaves keys idle.
//
// Work-stealing rather than batching: each worker pulls the next index off a
// shared cursor the moment it finishes, so one slow job never stalls the others
// the way Promise.all over fixed chunks does.
//
// NOT yet wired into the scraper — that stays sequential for now.

import { getActiveKeyCount } from './keyManager.js';

/**
 * Runs `callFn` over `tasks` with at most one in-flight call per active key.
 *
 * @param {Array<any>} tasks - arbitrary task values
 * @param {(task: any, index: number) => Promise<any>} callFn - makes the API call
 * @returns {Promise<Array<any>>} results in the SAME order as `tasks`;
 *          a task whose callFn threw yields null and does not stop the rest.
 */
export async function runParallelWithKeys(tasks, callFn) {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    if (typeof callFn !== 'function') {
        throw new Error('[Gemini] runParallelWithKeys requires a callFn');
    }

    // One slot per usable key, never more slots than there is work.
    const concurrency = Math.max(1, Math.min(getActiveKeyCount(), tasks.length));
    const results = new Array(tasks.length).fill(null);

    let cursor = 0; // next unclaimed task; single-threaded, so no lock needed

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= tasks.length) return;
            try {
                results[index] = await callFn(tasks[index], index);
            } catch (error) {
                // One bad task must not sink the batch — record null, carry on.
                console.warn(`[Gemini] Task ${index} failed: ${error?.message || error}`);
                results[index] = null;
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
}
