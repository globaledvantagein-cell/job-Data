import { ObjectId } from 'mongodb';
import { connectToDb } from '../connection.js';

/**
 * Get all users who should receive the weekly digest.
 * Excludes waitlist-only entries (legacy) and unsubscribed users.
 */
export async function getSubscribedUsers() {
    const db = await connectToDb();
    return await db.collection('users').find({
        isSubscribed: true,
    }).toArray();
}

/**
 * Mark that we successfully sent the weekly digest to one or more users.
 * Accepts a single email string or an array of emails.
 */
export async function updateLastEmailSent(emails) {
    const db = await connectToDb();
    const list = Array.isArray(emails) ? emails : [emails];
    if (list.length === 0) return { modified: 0 };

    const result = await db.collection('users').updateMany(
        { email: { $in: list } },
        { $set: { lastEmailSent: new Date(), updatedAt: new Date() } },
    );
    return { modified: result.modifiedCount };
}

/**
 * Flip `isSubscribed` to false for a user. Used by the one-click
 * unsubscribe endpoint. Returns true if a user was updated.
 */
export async function unsubscribeUser(email) {
    const db = await connectToDb();
    const result = await db.collection('users').updateOne(
        { email },
        { $set: { isSubscribed: false, updatedAt: new Date() } },
    );
    return result.modifiedCount > 0;
}

/**
 * Update a logged-in user's email preferences from the Profile page.
 * Accepts any combination of: desiredCategories, isSubscribed.
 * Returns the updated user document (without password).
 */
export async function updateUserPreferences(userId, { desiredCategories, isSubscribed }) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const set = { updatedAt: new Date() };
    if (Array.isArray(desiredCategories)) {
        set.desiredCategories = desiredCategories;
    }
    if (typeof isSubscribed === 'boolean') {
        set.isSubscribed = isSubscribed;
    }

    await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: set });

    return await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { password: 0 } },
    );
}

/**
 * Saves the AI-parsed resume profile and its hash on the user document.
 * Called after Gemini parses a resume so we don't re-parse the same file.
 */
export async function saveMatchProfile(userId, parsedProfile, resumeHash) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: {
            parsedProfile,
            lastResumeHash: resumeHash,
            profileParsedAt: new Date(),
            profileUpdatedAt: new Date(),
        }},
    );
}

/**
 * Returns the stored parsed profile + job preferences for the matcher.
 */
export async function getMatchProfile(userId) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        // dailyMatches is included so the Today's Matches route can read its
        // own cache — without it, `stored?.dailyMatches` is always undefined
        // and every request recomputes (the cache write becomes dead weight).
        { projection: { parsedProfile: 1, lastResumeHash: 1, jobPreferences: 1, dailyMatches: 1 } },
    );
    return user || null;
}

/**
 * Saves user-editable job matching preferences (salary, work style, etc.).
 */
export async function updateJobPreferences(userId, prefs) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { jobPreferences: prefs, profileUpdatedAt: new Date() } },
    );

    return await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { jobPreferences: 1 } },
    );
}