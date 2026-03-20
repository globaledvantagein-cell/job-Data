import mongoose from 'mongoose';

const analyticsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // Format: "YYYY-MM-DD"
  
  // Metrics
  connectedSources: { type: Number, default: 0 },
  jobsScraped: { type: Number, default: 0 },      // Raw jobs found
  jobsSentToAI: { type: Number, default: 0 },     // Passed keywords
  jobsPendingReview: { type: Number, default: 0 }, // AI Score 70-85
  jobsPublished: { type: Number, default: 0 },    // AI Score >85 or Manual Approve
  
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