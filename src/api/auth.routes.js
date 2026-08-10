import { Router } from 'express';
import { attachSigninRoutes } from './auth/signin.routes.js';
import { attachProfileRoutes } from './auth/profile.routes.js';
import { attachUnsubscribeRoute } from './auth/unsubscribe.routes.js';
import { attachPremiumRoutes } from './auth/premium.routes.js';
import { attachCohortWaitlistRoutes } from './auth/cohortWaitlist.routes.js';

/**
 * Auth router. Sub-modules live under ./auth/.
 */
export const authRouter = Router();

attachSigninRoutes(authRouter);       // /talent-pool, /login, /google
attachProfileRoutes(authRouter);      // /me, /preferences
attachUnsubscribeRoute(authRouter);   // /unsubscribe
attachPremiumRoutes(authRouter);      // /redeem-promo, /subscription, /usage
attachCohortWaitlistRoutes(authRouter); // /cohort-waitlist (demand test)
