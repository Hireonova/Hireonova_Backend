const express = require('express');
const serverless = require('serverless-http');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(require('cors')());

let isConnected = false;

const connectToMongo = async () => {
  if (!isConnected) {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    isConnected = true;
  }
};

const resumeSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  user_subscription: Number,
  ats_score: Number,
  Active_webpage: Number,
  total_resumes_parsed: { type: Number, default: 0 },
  total_webpages_created: { type: Number, default: 0 },
}, { strict: false });

const Resume = mongoose.models.Resume || mongoose.model('Resume', resumeSchema);

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const getMaxResumesByTier = (tier) => tier === 3 ? 50 : tier === 2 ? 10 : 3;

app.get('/api/hello', async (req, res) => {
  try {
    await connectToMongo();
    res.json({ msg: 'Hello from Express with MongoDB on Vercel!' });
  } catch (err) {
    console.error('Mongo error:', err.message);
    res.status(500).json({ error: 'MongoDB connection failed' });
  }
});

app.post('/api/resume', async (req, res) => {
  try {
    await connectToMongo();

    const { email, ats_score, user_subscription, Active_webpage, resume } = req.body;
    if (!email || !resume) return res.status(400).json({ error: 'Email and resume are required' });

    let user = await Resume.findOne({ email });
    const maxAllowed = getMaxResumesByTier(user_subscription);
    const resumeKeys = Array.from({ length: maxAllowed }, (_, i) => `resume${i + 1}`);

    if (!user) {
      user = new Resume({
        email,
        user_subscription,
        ats_score,
        Active_webpage,
        total_resumes_parsed: 1,
        total_webpages_created: 1,
        resume1: resume
      });
      await user.save();
      return res.json({ message: 'User created with resume1' });
    }

    for (let key of resumeKeys) {
      if (user[key] && deepEqual(user[key], resume)) {
        return res.status(409).json({ error: `This resume already exists as ${key}` });
      }
    }

    const nextSlot = resumeKeys.find((key) => !user[key]);
    if (!nextSlot) {
      return res.status(400).json({ error: `Maximum ${maxAllowed} resumes allowed for your plan.` });
    }

    user[nextSlot] = resume;
    user.ats_score = ats_score;
    user.Active_webpage = Active_webpage;
    user.user_subscription = user_subscription;
    user.total_resumes_parsed += 1;
    user.total_webpages_created += 1;

    await user.save();
    return res.json({ message: `New resume saved to ${nextSlot}` });

  } catch (err) {
    console.error('Server Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/resume', async (req, res) => {
  try {
    await connectToMongo();

    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await Resume.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/html', async (req, res) => {
  try {
    await connectToMongo();

    const { email, resumeKey } = req.query;
    if (!email || !resumeKey) {
      return res.status(400).json({ error: 'Email and resumeKey required' });
    }

    const user = await Resume.findOne({ email });
    if (!user || !user[resumeKey]) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    const html = user[resumeKey]?.HTML || 'No HTML found';
    return res.json({ email, resumeKey, HTML: html });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    await connectToMongo();

    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await Resume.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const resumeCount = Object.keys(user.toObject()).filter(k => k.startsWith('resume') && user[k]).length;

    return res.json({
      ats_score: user.ats_score,
      active_webpages: user.Active_webpage,
      resume_count: resumeCount,
      subscription_tier: user.user_subscription,
      total_resumes_parsed: user.total_resumes_parsed,
      total_webpages_created: user.total_webpages_created
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = serverless(app);
