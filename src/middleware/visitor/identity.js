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
    return match ? decodeURIComponent(match[1]) : null;
}
