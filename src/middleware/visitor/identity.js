import crypto from 'crypto';
import { VISITOR_IP_SALT } from '../../env.js';

// We never store raw IPs. Salt + sha256 + truncate is enough for matching
// while staying compliant with privacy expectations.
export function hashIp(ip) {
    if (!ip) return null;
    return crypto
        .createHash('sha256')
        .update(`${ip}|${VISITOR_IP_SALT || 'fallback-salt-change-me'}`)
        .digest('hex')
        .substring(0, 24);
}

export function extractIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (Array.isArray(forwarded)) return forwarded[0];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || null;
}

export function extractFingerprint(req) {
    const fp = req.headers['x-fingerprint'];
    if (typeof fp !== 'string' || fp.length < 8 || fp.length > 128) return null;
    return fp;
}

export function extractCookieVid(req) {
    // Read from cookie-parser if available, else parse manually
    if (req.cookies?.vid) return req.cookies.vid;
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)vid=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
    // Fallback: the frontend mirrors the vid in an x-vid header, so the very
    // first request (before the Set-Cookie round-trips) still carries the vid.
    // This stops that first request from creating a vid:null doc that a later,
    // cookie-bearing request would then fail to match — a second-doc bug.
    const headerVid = req.headers['x-vid'];
    if (typeof headerVid === 'string' && headerVid.length > 0) return headerVid;
    return null;
}
