// Email module — public API
export { sendEmail, sendBulkEmails } from './sender.js';
export { renderWeeklyDigest } from './templates/weeklyDigest.js';
export { renderWelcomeEmail } from './templates/welcomeEmail.js';
export { renderSubscriptionConfirmation } from './templates/subscriptionConfirmation.js';
export { renderUnsubscribeConfirmation } from './templates/unsubscribeConfirmation.js';
export { renderPremiumInvite } from './templates/premiumInvite.js';
export { renderWaitlistInvite } from './templates/waitlistInvite.js';
export {
    generateUnsubscribeToken,
    verifyUnsubscribeToken,
    buildUnsubscribeUrl,
} from './unsubscribe.js';