import { Router } from 'express';
import { Analytics } from '../models/analyticsModel.js';
import { connectToDb } from '../db/connection.js';
import { verifyToken, verifyAdmin } from '../middleware/authMiddleware.js';
import { BETA_PROMO_CODE } from '../env.js';

export const analyticsRouter = Router();

// GET /api/analytics/premium — admin-only premium funnel analytics.
// Everything the /analytics admin page shows: headline totals, a 30-day
// daily series, who redeemed which code, and who is waiting on a code.
analyticsRouter.get('/premium', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await connectToDb();
        const now = new Date();

        const [
            personalTotal, personalPending, personalRedeemed, personalExpired,
            activePremiumUsers, totalUsers, betaPromo,
            redemptions, waitlist, daily,
        ] = await Promise.all([
            db.collection('promoCodes').countDocuments({ generatedFor: { $exists: true } }),
            db.collection('promoCodes').countDocuments({ generatedFor: { $exists: true }, usedCount: 0, expiresAt: { $gt: now } }),
            db.collection('promoCodes').countDocuments({ generatedFor: { $exists: true }, usedCount: { $gt: 0 } }),
            db.collection('promoCodes').countDocuments({ generatedFor: { $exists: true }, usedCount: 0, expiresAt: { $lte: now } }),
            db.collection('users').countDocuments({ premiumUntil: { $gt: now } }),
            db.collection('users').estimatedDocumentCount(),
            db.collection('promoCodes').findOne({ code: BETA_PROMO_CODE }, { projection: { usedCount: 1 } }),
            // Who redeemed: newest 100 activations joined with the user account.
            db.collection('subscriptions').aggregate([
                { $sort: { createdAt: -1 } },
                { $limit: 100 },
                { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                { $project: {
                    _id: 1, promoCode: 1, plan: 1, status: 1, startedAt: 1, expiresAt: 1,
                    email: '$user.email', name: '$user.name',
                } },
            ]).toArray(),
            // Who is waiting: newest 100 personal codes with their state.
            db.collection('promoCodes').aggregate([
                { $match: { generatedFor: { $exists: true } } },
                { $sort: { createdAt: -1 } },
                { $limit: 100 },
                { $project: { _id: 1, code: 1, generatedForEmail: 1, createdAt: 1, usedCount: 1, expiresAt: 1 } },
            ]).toArray(),
            // 30-day daily funnel series.
            Analytics.find({}).sort({ date: -1 }).limit(30).lean(),
        ]);

        res.json({
            totals: {
                waitlistCodesGenerated: personalTotal,
                waitlistPending: personalPending,
                waitlistRedeemed: personalRedeemed,
                waitlistExpiredUnused: personalExpired,
                betaCodeRedemptions: betaPromo?.usedCount || 0,
                activePremiumUsers,
                totalUsers,
            },
            daily: daily.reverse().map(d => ({
                date: d.date,
                waitlistJoins: d.waitlist_joins || 0,
                redemptions: d.promo_redemptions || 0,
                failedAttempts: d.promo_failed_attempts || 0,
                signups: d.signups || 0,
            })),
            redemptions,
            waitlist: waitlist.map(w => ({
                ...w,
                status: w.usedCount > 0 ? 'redeemed' : (new Date(w.expiresAt) <= now ? 'expired' : 'pending'),
            })),
        });
    } catch (error) {
        console.error('[Analytics/premium] Failed:', error.message);
        res.status(500).json({ error: 'Server Error' });
    }
});

// GET /api/analytics/counts — Public, lightweight counts via countDocuments()
analyticsRouter.get('/counts', async (req, res) => {
    try {
        const db = await connectToDb();
        const jobs = db.collection('jobs');
        const testLogs = db.collection('jobTestLogs');

        // Run all 4 counts in parallel — each uses index scans, no full collection scan
        const [testLogsCount, pendingReviewCount, activeJobsCount, rejectedJobsCount] = await Promise.all([
            testLogs.countDocuments({}),
            jobs.countDocuments({ Status: 'pending_review' }),
            jobs.countDocuments({ Status: 'active', GermanRequired: false }),
            jobs.countDocuments({ Status: 'rejected' }),
        ]);

        res.json({
            testLogs: testLogsCount,
            pendingReview: pendingReviewCount,
            activeJobs: activeJobsCount,
            rejectedJobs: rejectedJobsCount,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/daily
analyticsRouter.get('/daily', verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's stats
    let stats = await Analytics.findOne({ date: today });
    
    // If no stats yet today (e.g., scraper hasn't run), return zeros
    if (!stats) {
        stats = {
            connectedSources: 0,
            jobsScraped: 0,
            jobsSentToAI: 0,
            jobsPendingReview: 0,
            jobsPublished: 0
        };
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});