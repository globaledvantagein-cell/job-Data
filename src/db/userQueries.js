import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { connectToDb } from './connection.js';
import { createUserModel } from '../models/userModel.js';

export async function getSubscribedUsers() {
    const db = await connectToDb();
    return await db.collection('users').find({
        isSubscribed: true,
        isWaitlist: { $ne: true },
    }).toArray();
}

export async function findMatchingJobs(user) {
    const db = await connectToDb();
    const jobsCollection = db.collection('jobs');

    const query = {
        Status: 'active',
        GermanRequired: false,
        Department: { $in: user.desiredDomains },
        JobID: { $nin: user.sentJobIds },
    };

    if (user.desiredRoles && user.desiredRoles.length > 0) {
        query.$text = { $search: user.desiredRoles.join(' ') };
    }

    return await jobsCollection.find(query).sort({ scrapedAt: -1 }).limit(3).toArray();
}

export async function updateUserAfterEmail(userId, newSentJobIds) {
    const db = await connectToDb();
    await db.collection('users').updateOne(
        { _id: userId },
        {
            $set: { lastEmailSent: new Date() },
            $push: { sentJobIds: { $each: newSentJobIds } },
        }
    );
}

// Talent Pool / Weekly Alerts subscription. Separate from auth.
export async function addSubscriber(data) {
    const db = await connectToDb();
    const newUser = createUserModel({
        email: data.email,
        desiredDomains: data.categories,
        emailFrequency: data.frequency,
        name: data.email.split('@')[0],
        createdAt: new Date(),
    });
    await db.collection('users').updateOne(
        { email: newUser.email },
        {
            $set: {
                desiredDomains: newUser.desiredDomains,
                emailFrequency: newUser.emailFrequency,
                isSubscribed: true,
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
                subscriptionTier: 'free',
                sentJobIds: [],
            },
        },
        { upsert: true },
    );
    return { success: true, email: newUser.email };
}

// Legacy registration — kept for the talent-pool flow + emergency admin path.
export async function registerUser({ email, password, name, role = 'user', location, domain, desiredCategories, isWaitlist }) {
    const db = await connectToDb();
    const usersCollection = db.collection('users');

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
        throw new Error('User already exists');
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
        domain,
        desiredCategories: Array.isArray(desiredCategories) ? desiredCategories : [],
        isWaitlist,
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

// Emergency password login (admins only). UI no longer exposes this, but
// the route stays so you can recover access if Google OAuth breaks.
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