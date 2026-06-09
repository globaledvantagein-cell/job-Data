import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { connectToDb } from '../connection.js';
import { createUserModel } from '../../models/userModel.js';

/**
 * Used by /api/auth/talent-pool. Handles two cases:
 *   1. New email → create user with subscription preferences.
 *   2. Existing user (e.g. Google OAuth account) → update preferences
 *      and flip isSubscribed to true.
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

/**
 * Emergency password login (admins only).
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
 *   2. Existing user by email     → link Google to that account (preserves role).
 *   3. New user                   → create a Google-only user.
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
