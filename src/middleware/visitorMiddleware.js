import { resolveVisitor } from '../db/visitorQueries.js';

/**
 * Attaches a lazy visitor resolver to every request.
 *
 * We don't resolve eagerly because most requests (list endpoint, health check,
 * etc.) don't need a visitor record. Only routes that actually gate content
 * call `await req.resolveVisitor()` to get the record.
 *
 * Reads:
 *   - vid cookie (set by frontend, see utils/visitorId.ts)
 *   - x-fingerprint header (set by frontend, see utils/fingerprint.ts)
 *   - IP from x-forwarded-for (Express must have `trust proxy` set)
 */
export function attachVisitor(req, res, next) {
    let cached = null;

    req.resolveVisitor = async () => {
        if (cached) return cached;

        const vid = req.cookies?.vid || req.headers['x-vid'] || null;
        const fingerprint = req.headers['x-fingerprint'] || null;

        const forwardedFor = req.headers['x-forwarded-for'];
        const ip = Array.isArray(forwardedFor)
            ? forwardedFor[0]
            : (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null)
              || req.socket?.remoteAddress
              || req.ip
              || null;

        cached = await resolveVisitor({ vid, fingerprint, ip });
        return cached;
    };

    next();
}
