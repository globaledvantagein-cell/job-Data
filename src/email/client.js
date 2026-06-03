/**
 * Shared Resend client (singleton).
 *
 * One instance is reused across all sends.
 * Importing this file is cheap; the client is lazily
 * created the first time you use it.
 */
import { Resend } from 'resend';
import { RESEND_API_KEY } from '../env.js';

let _client = null;

export function getResendClient() {
    if (_client) return _client;

    if (!RESEND_API_KEY) {
        throw new Error(
            '[email/client] RESEND_API_KEY must be set in .env',
        );
    }

    _client = new Resend(RESEND_API_KEY);
    return _client;
}

export const FROM_EMAIL = 'noreply@englishjobsgermany.com';
export const FROM_NAME = 'English Jobs Germany';
export const REPLY_TO = 'support@englishjobsgermany.com';