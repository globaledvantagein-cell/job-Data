/**
 * Schema for a 'User'.
 *
 * Two user types share this collection:
 *   1. Google OAuth users (authenticated, can browse/apply).
 *      Have googleId, no password. May also subscribe to weekly alerts.
 *   2. Talent-pool subscribers (email alerts only, no auth).
 *      Have isWaitlist: true, no password, no googleId.
 *
 * Existing password-based admin accounts in the DB still work via the
 * /api/auth/login emergency backdoor.
 */
import bcrypt from 'bcryptjs';

const userSchemaDefinition = {
    email: { type: String, required: true, trim: true },
    password: { type: String, required: false }, // null for Google + waitlist users
    name: { type: String, default: "User", trim: true },
    role: { type: String, default: "user" },

    // Google OAuth
    googleId: { type: String, default: null },
    avatarUrl: { type: String, default: null },

    // Legal — when did the user agree to Terms? Server-side audit trail.
    acceptedTermsAt: { type: Date, default: null },

    // Talent Pool / Weekly Alerts (subscription, separate from auth flow)
    location: { type: String, default: "" },
    isWaitlist: { type: Boolean, default: false },

    // Subscription preferences — source of truth for the weekly digest filter.
    // Values match the 6 category IDs from core/categorize.js:
    //   software, data, product_tech, other_tech, product_nontech, other_nontech
    desiredCategories: { type: Array, default: [] },

    emailFrequency: { type: String, default: "Weekly" },
    subscriptionTier: { type: String, default: "free" },
    isSubscribed: { type: Boolean, default: false },

    // System
    lastEmailSent: { type: Date, default: null },
    createdAt: { type: Date },
    updatedAt: { type: Date },
};

class User {
    constructor(data) {
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = new Date();

        for (const key in userSchemaDefinition) {
            if (key === 'createdAt' || key === 'updatedAt') continue;

            const schemaField = userSchemaDefinition[key];
            let value = data[key];

            if (schemaField.required && (!value)) {
                if (key === 'password' && (data.isWaitlist === true || data.googleId)) {
                    value = null;
                }
            }

            if (value === undefined || value === null) {
                this[key] = schemaField.default !== undefined ? schemaField.default : null;
            } else {
                if (schemaField.type === String) {
                    this[key] = schemaField.trim ? String(value).trim() : String(value);
                } else if (schemaField.type === Number) {
                    const numValue = Number(value);
                    this[key] = isNaN(numValue) ? schemaField.default : numValue;
                } else if (schemaField.type === Boolean) {
                    this[key] = Boolean(value);
                } else if (schemaField.type === Date) {
                    this[key] = new Date(value);
                } else {
                    this[key] = value;
                }
            }
        }
    }
}

export function createUserModel(formData) {
    return new User(formData);
}