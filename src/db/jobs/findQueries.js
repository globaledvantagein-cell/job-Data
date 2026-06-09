import { ObjectId } from 'mongodb';
import { connectToDb } from '../connection.js';

export async function getAllJobs(page = 1, limit = 50) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');
    const skip = (page - 1) * limit;
    const totalJobs = await jobsCollection.countDocuments();
    const jobs = await jobsCollection.find({})
        .sort({ PostedDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    return {
        jobs,
        totalJobs,
        totalPages: Math.ceil(totalJobs / limit),
        currentPage: page
    };
}

export async function getPublicBaitJobs() {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const jobs = await jobsCollection.find({
        Status: { $in: ['active'] },
        GermanRequired: false
    })
        .sort({ PostedDate: -1, createdAt: -1 })
        .limit(9)
        .project({
            JobTitle: 1, Company: 1, Location: 1, Department: 1,
            PostedDate: 1, ApplicationURL: 1, GermanRequired: 1, applyClicks: 1
        })
        .toArray();
    return jobs.map(job => ({ ...job, applyClicks: job.applyClicks || 0 }));
}

export async function findJobById(id) {
    const db = await connectToDb();
    return await db.collection('jobs').findOne({ _id: new ObjectId(id) });
}

export async function findJobByIdOrJobID(idOrJobID) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    if (ObjectId.isValid(idOrJobID)) {
        const byObjectId = await jobsCollection.findOne({ _id: new ObjectId(idOrJobID) });
        if (byObjectId) return byObjectId;
    }

    return await jobsCollection.findOne({ JobID: idOrJobID });
}
