import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { connectToDb } from './connection.js';
import { createUserModel } from '../models/userModel.js';

// ─── Subscriber Queries (Weekly Digest) ──────────────────────────────────

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

// ─── User Registration / Subscription ────────────────────────────────────

/**
 * Used by /api/auth/talent-pool. Handles two cases:
 *   1. New email → create user with subscription preferences.
 *   2. Existing user (e.g. Google OAuth account) → update their preferences
 *      and flip isSubscribed to true.
 *
 * Returns { id, email, role, name } in both cases.
 */
export async function registerUser({ email, password, name, role = 'user', location, desiredCategories, isWaitlist }) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
        await usersCollection.updateOne(
            { email },
            {
                $set: {
                    location: location || existingUser.location,
                    desiredCategories: Array.isArray(desiredCategories) ? desiredCategories : existingUser.desiredCategories || [],
                    isSubscribed: true,
                    updatedAt: new Date(),
                },
            },
        );
        return {
            id: existingUser._id,
            email: existingUser.email,
            role: existingUser.role,
            name: existingUser.name,
        };
    }

    let hashedPassword = null;
    if (password) {
        const salt = await bcrypt.genSalt(10);
        hashedPassword = await bcrypt.hash(password, salt);
    }

    const newUser = createUserModel({
        email,
        password: hashedPassword,
        name,
        role,
        location,
        desiredCategories: Array.isArray(desiredCategories) ? desiredCategories : [],
        isWaitlist,
        isSubscribed: true,
        createdAt: new Date(),
    });

    await usersCollection.insertOne(newUser);

    return {
        id: newUser._id,
        email: newUser.email,
        role: newUser.role,
        name: newUser.name,
    };
}

// ─── Auth ────────────────────────────────────────────────────────────────

/**
 * Emergency password login (admins only). UI no longer exposes this, but
 * the route stays so you can recover access if Google OAuth breaks.
 */
export async function loginUser(email, password) {
    const db = await connectToDb();
    const user = await db.collection('users').findOne({ email });
    if (!user) throw new Error('Invalid credentials');
    if (!user.password) throw new Error('No password on this account');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error('Invalid credentials');

    return { id: user._id, email: user.email, role: user.role, name: user.name };
}

export async function getUserProfile(userId) {
    const db = await connectToDb();
    return await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { password: 0 } },
    );
}

/**
 * Find or create a user from a verified Google ID-token payload.
 *
 * Three cases:
 *   1. Existing user by googleId  → log them in.
 *   2. Existing user by email     → link Google to that account (preserves
 *      their existing role — admins stay admin, talent-pool users upgrade).
 *   3. New user                   → create a fresh Google-only user.
 *
 * acceptedTermsAt is recorded on FIRST sign-in only. Once accepted, we
 * never reset it. Existing users won't have their timestamp overwritten.
 */
export async function findOrCreateGoogleUser(payload, { acceptedTerms = false } = {}) {
    if (!payload?.sub || !payload?.email) {
        throw new Error('Invalid Google payload');
    }
    if (payload.email_verified === false) {
        throw new Error('Google email not verified');
    }

    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const email = String(payload.email).toLowerCase();
    const googleId = String(payload.sub);
    const name = payload.name || email.split('@')[0];
    const avatarUrl = payload.picture || null;

    // 1. Already linked to Google
    const byGoogleId = await usersCollection.findOne({ googleId });
    if (byGoogleId) {
        await usersCollection.updateOne(
            { _id: byGoogleId._id },
            { $set: { name, avatarUrl, updatedAt: new Date() } },
        );
        return {
            id: byGoogleId._id,
            email: byGoogleId.email,
            role: byGoogleId.role,
            name,
            avatarUrl,
        };
    }

    // 2. Existing email account — link Google to it (preserve role)
    const byEmail = await usersCollection.findOne({ email });
    if (byEmail) {
        const set = {
            googleId,
            avatarUrl,
            name: byEmail.name && byEmail.name !== 'User' ? byEmail.name : name,
            isWaitlist: false,
            updatedAt: new Date(),
        };
        // Only set acceptedTermsAt if not already set
        if (!byEmail.acceptedTermsAt && acceptedTerms) {
            set.acceptedTermsAt = new Date();
        }
        await usersCollection.updateOne({ _id: byEmail._id }, { $set: set });
        return {
            id: byEmail._id,
            email: byEmail.email,
            role: byEmail.role,
            name: set.name,
            avatarUrl,
        };
    }

    // 3. Brand new user — must have accepted terms
    if (!acceptedTerms) {
        throw new Error('You must accept the Terms before signing up');
    }

    const newUser = createUserModel({
        email,
        password: null,
        name,
        role: 'user',
        googleId,
        avatarUrl,
        isWaitlist: false,
        acceptedTermsAt: new Date(),
        createdAt: new Date(),
    });

    const result = await usersCollection.insertOne(newUser);
    return {
        id: result.insertedId,
        email: newUser.email,
        role: newUser.role,
        name: newUser.name,
        avatarUrl,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Weekly Digest helpers
// ─────────────────────────────────────────────────────────────────────────

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
 * unsubscribe endpoint. Returns true if a user was updated, false otherwise.
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