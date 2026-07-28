import { ObjectId } from 'mongodb';
import { connectToDb } from '../connection.js';
import { createSubscription } from '../promoCodeQueries.js';

// ─── Usage limits (per weekly window) ───────────────────────────────────────
// Anonymous visitors get a small taste before they must sign up (0 applies —
// applying requires an account). Free signed-up users get a larger allowance.
// Premium is unlimited. These drive getUsageStats, which the frontend polls to
// render "5/20 JD views used".
const ANONYMOUS_JD_VIEWS_LIMIT = 5;
const ANONYMOUS_APPLY_CLICKS_LIMIT = 0;
const FREE_JD_VIEWS_LIMIT = 20;
const FREE_APPLY_CLICKS_LIMIT = 15;

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
        { email: String(email).toLowerCase().trim() },
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

// ─── Premium status + usage ─────────────────────────────────────────────────

/**
 * Pure check — no DB call. True only if premiumUntil is a Date in the future.
 * Always compares as Date objects (never string comparison) so ISO strings
 * loaded from JSON still work. Null / undefined / past dates → false.
 */
export function isPremium(user) {
    if (!user || !user.premiumUntil) return false;
    const until = new Date(user.premiumUntil);
    if (isNaN(until.getTime())) return false;
    return until > new Date();
}

/**
 * Increment jdViewsThisWeek by 1 on the user doc. Returns the updated count
 * (0 if the user could not be found or the id is invalid).
 */
export async function incrementJdViews(userId) {
    if (!userId) return 0;
    const db = await connectToDb();
    let _id;
    try {
        _id = userId instanceof ObjectId ? userId : new ObjectId(userId);
    } catch {
        return 0;
    }
    const updated = await db.collection('users').findOneAndUpdate(
        { _id },
        { $inc: { jdViewsThisWeek: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after', projection: { jdViewsThisWeek: 1 } },
    );
    return updated?.jdViewsThisWeek ?? 0;
}

/**
 * Increment applyClicksThisWeek by 1 on the user doc. Returns the updated count
 * (0 if the user could not be found or the id is invalid).
 */
export async function incrementApplyClicks(userId) {
    if (!userId) return 0;
    const db = await connectToDb();
    let _id;
    try {
        _id = userId instanceof ObjectId ? userId : new ObjectId(userId);
    } catch {
        return 0;
    }
    const updated = await db.collection('users').findOneAndUpdate(
        { _id },
        { $inc: { applyClicksThisWeek: 1 }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after', projection: { applyClicksThisWeek: 1 } },
    );
    return updated?.applyClicksThisWeek ?? 0;
}

/**
 * Pure — no DB call. Given a user doc (or null/undefined for an anonymous
 * visitor) returns the current usage counters and the limits that apply to
 * their tier. Premium tiers get Infinity limits. Never throws on missing fields.
 */
export function getUsageStats(user) {
    const premium = isPremium(user);
    // A signed-up user always has an _id; a null/undefined user is anonymous.
    const isAnonymous = !user || !user._id;

    let jdViewsLimit;
    let applyClicksLimit;
    if (premium) {
        jdViewsLimit = Infinity;
        applyClicksLimit = Infinity;
    } else if (isAnonymous) {
        jdViewsLimit = ANONYMOUS_JD_VIEWS_LIMIT;
        applyClicksLimit = ANONYMOUS_APPLY_CLICKS_LIMIT;
    } else {
        jdViewsLimit = FREE_JD_VIEWS_LIMIT;
        applyClicksLimit = FREE_APPLY_CLICKS_LIMIT;
    }

    return {
        jdViewsUsed: Number(user?.jdViewsThisWeek) || 0,
        jdViewsLimit,
        applyClicksUsed: Number(user?.applyClicksThisWeek) || 0,
        applyClicksLimit,
        isPremium: premium,
        premiumExpiresAt: user?.premiumUntil ? new Date(user.premiumUntil) : null,
        weekResetAt: user?.weekResetAt ? new Date(user.weekResetAt) : null,
    };
}

/**
 * Activate premium for a user: set premiumUntil to now + durationDays, bump the
 * subscriptionTier, and record a subscription (see promoCodeQueries.js).
 * Returns the updated user doc (without password), or null if not found.
 */
export async function activatePremium(userId, durationDays, promoCode = null) {
    if (!userId) return null;
    const db = await connectToDb();
    const usersCollection = db.collection('users');
    const _id = new ObjectId(userId);

    const days = Number(durationDays) || 0;
    const premiumUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await usersCollection.updateOne(
        { _id },
        { $set: { premiumUntil, subscriptionTier: 'premium', updatedAt: new Date() } },
    );

    // Append a subscription history record for this activation.
    await createSubscription(userId, 'premium_6mo', 0, promoCode, days);

    return await usersCollection.findOne({ _id }, { projection: { password: 0 } });
}