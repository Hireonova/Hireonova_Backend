const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  user_subscription: Number,
  ats_score: Number,
  Active_webpage: Number,
  total_resumes_parsed: { type: Number, default: 0 },
  total_webpages_created: { type: Number, default: 0 },
}, { strict: false });

module.exports = mongoose.models.Resume || mongoose.model('Resume', resumeSchema);