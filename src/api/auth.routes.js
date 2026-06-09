import { Router } from 'express';
import { attachSigninRoutes } from './auth/signin.routes.js';
import { attachProfileRoutes } from './auth/profile.routes.js';
import { attachUnsubscribeRoute } from './auth/unsubscribe.routes.js';

/**
 * Auth router. Sub-modules live under ./auth/.
 */
export const authRouter = Router();

attachSigninRoutes(authRouter);       // /talent-pool, /login, /google
attachProfileRoutes(authRouter);      // /me, /preferences
attachUnsubscribeRoute(authRouter);   // /unsubscribe
