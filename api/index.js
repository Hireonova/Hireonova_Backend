require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const serverless = require('serverless-http');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection control for serverless compatibility
let isConnected = false;
const connectToMongo = async () => {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  isConnected = true;
  console.log('✅ MongoDB connected (serverless/local)');
};

// Default route for root access
app.get('/', (req, res) => {
  res.send('Hello World');
});

// Schema definition with dynamic fields
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

const getMaxResumesByTier = (tier) => {
  if (tier === 2) return 10;
  if (tier === 3) return 50;
  return 3;
};

// Health check endpoint
app.get('/api/hello', async (req, res) => {
  try {
    await connectToMongo();
    res.json({ msg: 'Hello from Express with MongoDB!' });
  } catch (err) {
    console.error('Mongo error:', err.message);
    res.status(500).json({ error: 'MongoDB connection failed' });
  }
});

// Upload resume endpoint
app.post('/api/resume', async (req, res) => {
  await connectToMongo();
  const { email, ats_score, user_subscription, Active_webpage, resume } = req.body;

  if (!email || !resume) {
    return res.status(400).json({ error: 'Email and resume are required' });
  }

  try {
    let user = await Resume.findOne({ email });
    const maxAllowed = getMaxResumesByTier(user_subscription);

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

    const resumeKeys = Array.from({ length: maxAllowed }, (_, i) => `resume${i + 1}`);

    for (const key of resumeKeys) {
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
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Retrieve all resume data for a user
app.get('/api/resume', async (req, res) => {
  await connectToMongo();
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = await Resume.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Retrieve HTML from a specific resume key
app.get('/api/html', async (req, res) => {
  await connectToMongo();
  const { email, resumeKey } = req.query;

  if (!email || !resumeKey) {
    return res.status(400).json({ error: 'Email and resumeKey required' });
  }

  try {
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

// Dashboard summary route
app.get('/api/dashboard', async (req, res) => {
  await connectToMongo();
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
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

// Export handler for serverless platforms
module.exports.handler = serverless(app);

// Local development server (only runs when executed directly)
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, async () => {
    await connectToMongo();
    console.log(`🚀 Server running locally at http://localhost:${PORT}`);
  });
}
