/**
 * Schema for a 'User'.
 *
 * Note: password is optional now. Google-only users don't have passwords.
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

    // Talent Pool / Weekly Alerts (separate flow from auth)
    location: { type: String, default: "" },
    domain: { type: String, default: "" },   // Tech / Non-Tech
    isWaitlist: { type: Boolean, default: false },

    // Preferences
    desiredRoles: { type: Array, default: [] },
    desiredDomains: { type: Array, default: [] },
    desiredCategories: { type: Array, default: [] }, // e.g. ['software','data','product_tech']
    emailFrequency: { type: String, default: "Weekly" },
    subscriptionTier: { type: String, default: "free" },
    isSubscribed: { type: Boolean, default: true },

    // System
    lastEmailSent: { type: Date, default: null },
    sentJobIds: { type: Array, default: [] },
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