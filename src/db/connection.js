import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';
import { MONGO_URI } from '../env.js';

export const client = new MongoClient(MONGO_URI);
let db;

export async function connectToDb() {
    if (db) return db;

    await client.connect();

    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGO_URI);
        console.log("🍃 Mongoose Connected");
    }

    db = client.db("job-scraper");
    const clicksCollection = db.collection('applyClicks');
    await clicksCollection.createIndex({ jobId: 1, visitorId: 1 }, { unique: true });

    // Premium: promo codes are unique by code; subscription history is queried
    // per-user, newest-first.
    await db.collection('promoCodes').createIndex({ code: 1 }, { unique: true });
    await db.collection('subscriptions').createIndex({ userId: 1, createdAt: -1 });

    console.log("🗄️  Successfully connected to MongoDB.");
    return db;
}
