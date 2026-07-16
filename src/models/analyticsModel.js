import mongoose from 'mongoose';

const analyticsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // Format: "YYYY-MM-DD"
  
  // Metrics
  connectedSources: { type: Number, default: 0 },
  jobsScraped: { type: Number, default: 0 },      // Raw jobs found
  jobsSentToAI: { type: Number, default: 0 },     // Passed keywords
  jobsPendingReview: { type: Number, default: 0 }, // AI Score 70-85
  jobsPublished: { type: Number, default: 0 },    // AI Score >85 or Manual Approve

  // ── Engagement metrics ──
  // NOTE: these field names use snake_case per the tracking spec, unlike the
  // camelCase counters above. They MUST be declared here — Mongoose runs in
  // strict mode and silently drops $inc on any path not in the schema, so an
  // undeclared counter would no-op forever.
  pageViews_jobs: { type: Number, default: 0 },        // GET /api/jobs list
  pageViews_jobDetail: { type: Number, default: 0 },   // GET /api/jobs/:id/full
  pageViews_smartMatch: { type: Number, default: 0 },  // Smart Match GET + POST
  pageViews_todayMatches: { type: Number, default: 0 },// GET /skill-matches
  signups: { type: Number, default: 0 },               // new users (any method)
  signups_google: { type: Number, default: 0 },        // new users via Google
  smartMatch_runs: { type: Number, default: 0 },       // Smart Match pipeline runs
  todayMatch_runs: { type: Number, default: 0 },       // fresh skill-match computes
  applyClicks_total: { type: Number, default: 0 },     // apply-click events
  visitor_conversions: { type: Number, default: 0 },   // anon visitor → logged in

  lastUpdated: { type: Date, default: Date.now }
});

// ✅ Static method to easily increment any field from anywhere in the app
analyticsSchema.statics.increment = async function(field, count = 1) {
  const today = new Date().toISOString().split('T')[0];
  try {
    return await this.findOneAndUpdate(
      { date: today },
      { 
        $inc: { [field]: count }, 
        $set: { lastUpdated: new Date() } 
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    console.error(`Failed to update analytics for ${field}:`, err);
  }
};

// ✅ Static method to set a fixed value (like total connected sources)
analyticsSchema.statics.setValue = async function(field, value) {
  const today = new Date().toISOString().split('T')[0];
  return this.findOneAndUpdate(
    { date: today },
    { $set: { [field]: value, lastUpdated: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
};

export const Analytics = mongoose.model('Analytics', analyticsSchema);