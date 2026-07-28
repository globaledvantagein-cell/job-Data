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
 * Returns the inserted document (with its _id).
 */
export async function createPromoCode(code, discountPercent, maxUses = null, expiresAt = null) {
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
    };

    const result = await db.collection('promoCodes').insertOne(doc);
    return { ...doc, _id: result.insertedId };
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

// ─── Payment intents (fake-door metric) ───────────────────────────────────

/**
 * Record that a logged-in user tried to pay by CARD (no promo code) on the
 * checkout page. This is the core signal of the fake-door premium test:
 * these users demonstrated real willingness to pay. NEVER stores card data —
 * only the fact that a complete-looking card form was submitted.
 *
 * One document per user (upserted); attempts increments on repeat tries so
 * distinct-user counts stay trivial: db.paymentIntents.countDocuments().
 */
export async function recordPaymentIntent(userId, { email = null } = {}) {
    if (!userId) return null;
    const db = await connectToDb();
    const _id = userId instanceof ObjectId ? userId : new ObjectId(userId);
    const now = new Date();
    const updated = await db.collection('paymentIntents').findOneAndUpdate(
        { userId: _id },
        {
            $inc: { attempts: 1 },
            $set: { lastAttemptAt: now, email },
            $setOnInsert: { userId: _id, firstAttemptAt: now, createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
    );
    return updated;
}

// ─── Subscriptions ────────────────────────────────────────────────────────

/**
 * Create an active subscription record. amount is 0 for promo activations
 * (paid Stripe flow is future work). expiresAt = now + durationDays.
 * Returns the inserted document (with its _id).
 */
export async function createSubscription(userId, plan, amount = 0, promoCode = null, durationDays = 180) {
    const db = await connectToDb();
    const days = Number(durationDays) || 0;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const doc = {
        userId: userId instanceof ObjectId ? userId : new ObjectId(userId),
        plan: plan || 'premium_6mo',
        amount: Number(amount) || 0,
        currency: 'EUR',
        promoCode: promoCode ? String(promoCode).trim().toUpperCase() : null,
        status: 'active',
        startedAt: now,
        expiresAt,
        paymentMethod: promoCode ? 'promo' : 'stripe',
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
