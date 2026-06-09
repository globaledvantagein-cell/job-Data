import { ObjectId } from 'mongodb';
import {
    addCuratedJob,
    deleteJobById,
    deleteJobsByCompany,
} from '../../db/index.js';

export function attachAdminCuratedRoutes(router) {
    router.delete('/company', async (req, res) => {
        try {
            const { name } = req.query;
            if (name) {
                const result = await deleteJobsByCompany(name);
                return res.status(200).json({ message: `Deleted ${result.deletedCount} jobs for ${name}.` });
            }
            res.status(400).json({ error: "Name required" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/', async (req, res) => {
        try {
            const jobData = req.body;
            const newJob = await addCuratedJob(jobData);
            res.status(201).json(newJob);
        } catch (error) {
            if (error.message.includes('duplicate URL')) {
                return res.status(409).json({ error: error.message });
            }
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });
            await deleteJobById(new ObjectId(id));
            res.status(200).json({ message: 'Job deleted.' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
