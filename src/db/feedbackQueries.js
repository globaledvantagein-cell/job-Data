import { ObjectId } from 'mongodb';
import { connectToDb } from './connection.js';

export async function saveFeedback(feedbackData) {
    const db = await connectToDb();
    const collection = db.collection('feedback');
    const result = await collection.insertOne(feedbackData);
    return { id: result.insertedId, ...feedbackData };
}

export async function getAllFeedback(page = 1, limit = 50, statusFilter = null) {
    const db = await connectToDb();
    const collection = db.collection('feedback');
    const skip = (page - 1) * limit;

    const query = {};
    if (statusFilter && statusFilter !== 'all') {
        query.status = statusFilter;
    }

    const total = await collection.countDocuments(query);
    const feedback = await collection.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    return { feedback, total, totalPages: Math.ceil(total / limit), currentPage: page };
}

export async function updateFeedbackStatus(feedbackId, status, adminNote = null) {
    const db = await connectToDb();
    const collection = db.collection('feedback');

    const update = { status, updatedAt: new Date() };
    if (adminNote !== null) update.adminNote = adminNote;

    await collection.updateOne(
        { _id: new ObjectId(feedbackId) },
        { $set: update }
    );
    return { success: true };
}

export async function deleteFeedback(feedbackId) {
    const db = await connectToDb();
    const collection = db.collection('feedback');
    await collection.deleteOne({ _id: new ObjectId(feedbackId) });
    return { success: true };
}

export async function getFeedbackStats() {
    const db = await connectToDb();
    const collection = db.collection('feedback');

    const total = await collection.countDocuments();
    const unread = await collection.countDocuments({ status: 'unread' });
    const read = await collection.countDocuments({ status: 'read' });
    const resolved = await collection.countDocuments({ status: 'resolved' });

    return { total, unread, read, resolved };
}
