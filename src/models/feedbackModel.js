const feedbackSchemaDefinition = {
    name: { type: String, default: 'Anonymous' },
    email: { type: String, default: null },
    message: { type: String, required: true },
    wordCount: { type: Number, default: 0 },

    userId: { type: String, default: null },

    source: { type: String, default: 'footer' },
    userAgent: { type: String, default: null },
    ipHash: { type: String, default: null },

    status: { type: String, default: 'unread' },
    adminNote: { type: String, default: null },

    createdAt: { type: Date },
};

export function createFeedback(data) {
    return {
        name: (data.name || 'Anonymous').trim().substring(0, 100),
        email: data.email ? String(data.email).trim().substring(0, 200).toLowerCase() : null,
        message: String(data.message || '').trim().substring(0, 5000),
        wordCount: String(data.message || '').trim().split(/\s+/).filter(Boolean).length,
        userId: data.userId || null,
        source: data.source || 'footer',
        userAgent: data.userAgent || null,
        ipHash: data.ipHash || null,
        status: 'unread',
        adminNote: null,
        createdAt: new Date(),
    };
}

export { feedbackSchemaDefinition };