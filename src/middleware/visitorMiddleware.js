/**
 * Visitor middleware — thin re-export hub.
 *
 * Implementation lives in middleware/visitor/:
 *   identity.js  — IP / cookie / fingerprint extraction + hashing
 *   resolver.js  — find or create the visitor record for a request
 *   gate.js      — gate decisions, view recording, user linking
 *
 * Existing imports like `import { attachVisitor } from '../middleware/visitorMiddleware.js'`
 * continue working unchanged.
 */
import { resolveVisitor } from './visitor/resolver.js';

export { shouldGate, recordJobView, linkVisitorToUser } from './visitor/gate.js';

// ─── Express middleware: lazy req.resolveVisitor() ───────────────────────
// Most requests (list, health check, etc.) don't need the visitor record.
// Only routes that gate content actually call `await req.resolveVisitor()`.
export function attachVisitor(req, res, next) {
    let cached = null;
    req.resolveVisitor = async () => {
        if (cached) return cached;
        cached = await resolveVisitor(req);
        return cached;
    };
    next();
}
