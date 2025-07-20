const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  first_name: { type: String },
  last_name: { type: String },
  linkedin_url: { type: String },
  github_url: { type: String },
  user_subscription: Number,               // 1 = Free, 2 = Tier 2, 3 = Tier 3
  ats_score: Number,
  Active_webpage: Number,
  total_resumes_parsed: { type: Number, default: 0 },
  total_webpages_created: { type: Number, default: 0 },

  // ✅ NEW FIELD: Store liked job IDs (as strings)
  liked_job_ids: {
    type: [String],
    default: [],
  }

}, { strict: false });

module.exports = mongoose.models.Resume || mongoose.model('Resume', resumeSchema);
