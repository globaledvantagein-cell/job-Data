import { ObjectId } from 'mongodb';
import { connectToDb, cleanAllDescriptions } from '../../db/index.js';
import { verifyToken, verifyAdmin } from '../../middleware/authMiddleware.js';
import { backfillExperienceForCollection } from './helpers.js';

export function attachAdminMaintenanceRoutes(router) {
    router.post('/admin/clean-descriptions', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const summary = await cleanAllDescriptions();
            res.status(200).json(summary);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/admin/fix-salaries', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const db = await connectToDb();
            const jobsCollection = db.collection('jobs');

            const jobs = await jobsCollection.find({
                $or: [
                    { SalaryMin: { $gt: 0, $lt: 1000 } },
                    { SalaryMax: { $gt: 0, $lt: 1000 } }
                ]
            }).toArray();

            let fixed = 0;
            for (const job of jobs) {
                const update = {};
                if (job.SalaryMin && job.SalaryMin > 0 && job.SalaryMin < 1000) {
                    update.SalaryMin = job.SalaryMin * 1000;
                }
                if (job.SalaryMax && job.SalaryMax > 0 && job.SalaryMax < 1000) {
                    update.SalaryMax = job.SalaryMax * 1000;
                }
                if (Object.keys(update).length > 0) {
                    await jobsCollection.updateOne({ _id: job._id }, { $set: update });
                    fixed += 1;
                }
            }

            res.status(200).json({ total: jobs.length, fixed });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/admin/backfill-experience', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const db = await connectToDb();
            const jobsSummary = await backfillExperienceForCollection(db.collection('jobs'));
            const logsSummary = await backfillExperienceForCollection(db.collection('jobTestLogs'));

            res.status(200).json({
                total: jobsSummary.total,
                updated: jobsSummary.updated,
                logsTotal: logsSummary.total,
                logsUpdated: logsSummary.updated,
                message: 'Backfill complete'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.patch('/admin/update/:id', verifyToken, verifyAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

            const allowedFields = ['Location', 'Company', 'JobTitle', 'WorkplaceType'];
            const updates = {};
            for (const field of allowedFields) {
                if (req.body[field] !== undefined) {
                    updates[field] = req.body[field];
                }
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }
            updates.updatedAt = new Date();

            const db = await connectToDb();
            await db.collection('jobs').updateOne(
                { _id: new ObjectId(id) },
                { $set: updates }
            );
            const updated = await db.collection('jobs').findOne({ _id: new ObjectId(id) });
            res.status(200).json(updated);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
