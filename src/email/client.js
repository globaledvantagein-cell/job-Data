/**
 * Shared SES v2 client (singleton).
 *
 * One instance is reused across all sends so the SDK can pool TCP/TLS
 * connections. Importing this file is cheap; the client is lazily
 * created the first time you use it.
 */
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SES_CONFIG } from '../env.js';

let _client = null;

export function getSesClient() {
    if (_client) return _client;

    if (!SES_CONFIG.credentials.accessKeyId || !SES_CONFIG.credentials.secretAccessKey) {
        throw new Error(
            '[email/client] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in .env',
        );
    }

    _client = new SESv2Client({
        region: SES_CONFIG.region,
        credentials: SES_CONFIG.credentials,
    });

    return _client;
}

export const FROM_EMAIL = SES_CONFIG.fromEmail;
export const FROM_NAME = SES_CONFIG.fromName;
export const REPLY_TO = 'support@englishjobsgermany.com';