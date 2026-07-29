import { ObjectId } from 'mongodb';
import { connectToDb } from './connection.js';

/**
 * Promo codes + subscription records.
 *
 * Collections:
 *   promoCodes    — redeemable codes. During beta only 100%-off codes are
 *                   accepted (see premium.routes.js). Codes are ALWAYS stored
 *                   and compared in uppercase.
 *   subscriptions — an append-only history of premium activations. One record
 *                   per activation; `status` moves active → expired via the
 *                   weekly-reset cron (expireOldSubscriptions).
 *
 * Every function is defensive: missing/blank input never throws, it returns a
 * sensible empty/invalid result instead.
 */

// ─── Promo codes ──────────────────────────────────────────────────────────

/**
 * Insert a new promo code. The code is uppercased before storage.
 * discountPercent 100 = fully free. maxUses / expiresAt null = unlimited/never.
 *
 * Personal invite codes (the waitlist flow) pass `generatedFor` /
 * `generatedForEmail` so the code is linked to the user who requested it.
 * Returns the inserted document (with its _id).
 */
export async function createPromoCode(code, discountPercent, maxUses = null, expiresAt = null, { generatedFor = null, generatedForEmail = null } = {}) {
    const db = await connectToDb();
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) throw new Error('Promo code is required');

    const doc = {
        code: normalizedCode,
        discountPercent: Number(discountPercent) || 0,
        maxUses: maxUses == null ? null : Number(maxUses),
        usedCount: 0,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdAt: new Date(),
        ...(generatedFor ? {
            generatedFor: generatedFor instanceof ObjectId ? generatedFor : new ObjectId(generatedFor),
            generatedForEmail: generatedForEmail || null,
        } : {}),
    };

    const result = await db.collection('promoCodes').insertOne(doc);
    return { ...doc, _id: result.insertedId };
}

/**
 * Find an unused, unexpired personal invite code for a user (waitlist flow).
 * Returns the promo document or null.
 */
export async function findPendingCodeForUser(userId) {
    if (!userId) return null;
    const db = await connectToDb();
    const _id = userId instanceof ObjectId ? userId : new ObjectId(userId);
    return await db.collection('promoCodes').findOne({
        generatedFor: _id,
        usedCount: 0,
        expiresAt: { $gt: new Date() },
    });
}

/** True if a promo code string already exists (collision check). */
export async function promoCodeExists(code) {
    const db = await connectToDb();
    const found = await db.collection('promoCodes').findOne(
        { code: String(code || '').trim().toUpperCase() },
        { projection: { _id: 1 } },
    );
    return Boolean(found);
}

/**
 * Look up a promo code (case-insensitive via uppercase) and check that it is
 * usable right now. Returns { valid: true, promo } when redeemable, otherwise
 * { valid: false, reason: 'not_found' | 'expired' | 'exhausted' }.
 */
export async function validatePromoCode(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return { valid: false, reason: 'not_found' };

    const db = await connectToDb();
    const promo = await db.collection('promoCodes').findOne({ code: normalizedCode });
    if (!promo) return { valid: false, reason: 'not_found' };

    // Expiry: expiresAt null means never expires.
    if (promo.expiresAt && new Date(promo.expiresAt) <= new Date()) {
        return { valid: false, reason: 'expired' };
    }

    // Usage cap: maxUses null means unlimited.
    if (promo.maxUses != null && (promo.usedCount || 0) >= promo.maxUses) {
        return { valid: false, reason: 'exhausted' };
    }

    return { valid: true, promo };
}

/**
 * Increment usedCount by 1 on the given code. Returns the updated document
 * (or null if the code does not exist).
 */
export async function redeemPromoCode(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return null;

    const db = await connectToDb();
    const updated = await db.collection('promoCodes').findOneAndUpdate(
        { code: normalizedCode },
        { $inc: { usedCount: 1 } },
        { returnDocument: 'after' },
    );
    return updated || null;
}

// ─── Subscriptions ────────────────────────────────────────────────────────

/**
 * Create an active subscription record. amount is 0 — activation is by
 * invite/promo code only. expiresAt = now + durationDays.
 * Returns the inserted document (with its _id).
 */
export async function createSubscription(userId, plan, amount = 0, promoCode = null, durationDays = 90) {
    const db = await connectToDb();
    const days = Number(durationDays) || 0;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const doc = {
        userId: userId instanceof ObjectId ? userId : new ObjectId(userId),
        plan: plan || 'premium_3mo',
        amount: Number(amount) || 0,
        currency: 'EUR',
        promoCode: promoCode ? String(promoCode).trim().toUpperCase() : null,
        status: 'active',
        startedAt: now,
        expiresAt,
        paymentMethod: 'promo', // invite/promo codes are the only activation path
        createdAt: now,
    };

    const result = await db.collection('subscriptions').insertOne(doc);
    return { ...doc, _id: result.insertedId };
}

/**
 * All subscription records for a user, newest first. Returns [] on bad input.
 */
export async function getSubscriptionHistory(userId) {
    if (!userId) return [];
    const db = await connectToDb();
    const _id = userId instanceof ObjectId ? userId : new ObjectId(userId);
    return await db.collection('subscriptions')
        .find({ userId: _id })
        .sort({ createdAt: -1 })
        .toArray();
}

/**
 * Mark every still-'active' subscription whose expiresAt is in the past as
 * 'expired'. Called by the weekly-reset cron. Returns the count updated.
 */
export async function expireOldSubscriptions() {
    const db = await connectToDb();
    const result = await db.collection('subscriptions').updateMany(
        { status: 'active', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } },
    );
    return result.modifiedCount || 0;
}
