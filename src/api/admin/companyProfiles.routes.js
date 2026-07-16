// ─── Company Profiles — admin JSON API ────────────────────────────────────
//
//   GET   /api/admin/company-profiles              → list all profiles
//   PATCH /api/admin/company-profiles/:companyName → upsert description/website/logo
//
// Both behind verifyToken + verifyAdmin.
//
// :companyName is the RAW display name, URL-encoded by the client. The DB keys
// on normalizeCompanyName() internally, so "Databricks GmbH" and
// "Databricks Inc." resolve to the same profile.
import { Router } from 'express';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { getAllCompanyProfiles, updateCompanyDescription } from '../../db/index.js';

export const adminCompanyProfilesRouter = Router();

adminCompanyProfilesRouter.use(verifyToken, verifyAdmin);

adminCompanyProfilesRouter.get('/', async (req, res) => {
    try {
        const profiles = await getAllCompanyProfiles();
        res.status(200).json({ success: true, profiles });
    } catch (error) {
        console.error('[Admin/CompanyProfiles] list failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to load company profiles' });
    }
});

adminCompanyProfilesRouter.patch('/:companyName', async (req, res) => {
    try {
        const companyName = String(req.params.companyName || '').trim();
        if (!companyName) {
            return res.status(400).json({ success: false, error: 'Company name is required' });
        }

        const { description, website, logo } = req.body || {};
        if (description === undefined && website === undefined && logo === undefined) {
            return res.status(400).json({ success: false, error: 'Nothing to update' });
        }

        const profile = await updateCompanyDescription(companyName, { description, website, logo });
        res.status(200).json({ success: true, profile });
    } catch (error) {
        console.error('[Admin/CompanyProfiles] update failed:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});
