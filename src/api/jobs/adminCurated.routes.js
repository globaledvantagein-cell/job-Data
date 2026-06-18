import { ObjectId } from 'mongodb';
import {
    addCuratedJob,
    deleteJobById,
    deleteJobsByCompany,
    findJobById,
} from '../../db/index.js';
import { upsertJob, removeJob, refreshJobsCache } from '../../cache/index.js';

export function attachAdminCuratedRoutes(router) {

    // Bulk-delete jobs by company. Easier to refresh whole cache than
    // figure out exactly which entries to drop.
    router.delete('/company', async (req, res) => {
        try {
            const { name } = req.query;
            if (name) {
                const result = await deleteJobsByCompany(name);

                try { await refreshJobsCache(); }
                catch (cacheErr) { console.warn('[Cache] refresh failed after company delete:', cacheErr.message); }

                return res.status(200).json({ message: `Deleted ${result.deletedCount} jobs for ${name}.` });
            }
            res.status(400).json({ error: "Name required" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Admin manually adds a job. Created with Status:'active', so upsert
    // straight into the cache so it shows on the site immediately.
    router.post('/', async (req, res) => {
        try {
            const jobData = req.body;
            const newJob = await addCuratedJob(jobData);

            try { upsertJob(newJob); }
            catch (cacheErr) { console.warn('[Cache] upsert failed after curate:', cacheErr.message); }

            res.status(201).json(newJob);
        } catch (error) {
            if (error.message.includes('duplicate URL')) {
                return res.status(409).json({ error: error.message });
            }
            res.status(500).json({ error: error.message });
        }
    });

    // Delete one job by _id. Need to fetch first to know the JobID for
    // the cache key (cache is keyed by JobID, not _id).
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

            // Fetch before deleting so we know the JobID to drop from cache
            const job = await findJobById(id);
            await deleteJobById(new ObjectId(id));

            try { if (job?.JobID) removeJob(job.JobID); }
            catch (cacheErr) { console.warn('[Cache] remove failed after delete:', cacheErr.message); }

            res.status(200).json({ message: 'Job deleted.' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
