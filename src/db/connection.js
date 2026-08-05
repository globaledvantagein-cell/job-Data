import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';
import { MONGO_URI, REMOTE_MONGO_URI, describeMongoUri } from '../env.js';

export const client = new MongoClient(MONGO_URI);
let db;

// ── Remote vertical connection ────────────────────────────────────────────
// Separate client only when REMOTE_MONGO_URI differs from MONGO_URI. When they
// match — the production case — the existing connection is reused, so this
// costs nothing there.
let remoteClient = null;
let remoteDb = null;

/**
 * Database handle for the `remoteJobs` collection.
 *
 * Reuses the primary connection unless REMOTE_MONGO_URI points somewhere else,
 * which is how a laptop can run the German product against a local mongod while
 * the remote vertical reads the hosted cluster the scraper actually writes to.
 *
 * @returns {Promise<import('mongodb').Db>}
 */
export async function connectToRemoteDb() {
    if (remoteDb) return remoteDb;

    if (!REMOTE_MONGO_URI || REMOTE_MONGO_URI === MONGO_URI) {
        remoteDb = await connectToDb();
        return remoteDb;
    }

    remoteClient = new MongoClient(REMOTE_MONGO_URI);
    await remoteClient.connect();
    remoteDb = remoteClient.db('job-scraper');

    console.log(`🌍 Remote vertical connected to ${describeMongoUri(REMOTE_MONGO_URI)}`);
    return remoteDb;
}

/** Closes the remote client, if one was opened. */
export async function closeRemoteDb() {
    if (remoteClient) {
        await remoteClient.close().catch(() => {});
        remoteClient = null;
        remoteDb = null;
    }
}

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

    console.log(`🗄️  Successfully connected to MongoDB — ${describeMongoUri(MONGO_URI)}`);
    return db;
}
