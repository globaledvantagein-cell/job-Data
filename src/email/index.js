// Email module — public API
export { sendEmail, sendBulkEmails } from './sender.js';
export { renderWeeklyDigest } from './templates/weeklyDigest.js';
export {
    generateUnsubscribeToken,
    verifyUnsubscribeToken,
    buildUnsubscribeUrl,
} from './unsubscribe.js';