require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const serverless = require('serverless-http');

const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- MongoDB Connection ---
// This is a more robust approach for serverless environments.
// Mongoose handles connection pooling internally. We don't need a manual `isConnected` flag.
let conn = null;

const connectToMongo = async () => {
  // If a connection is already cached, reuse it.
  if (conn) {
    console.log("✅ Using cached MongoDB connection.");
    return conn;
  }

  // If no connection is cached, create a new one.
  try {
    console.log(" Mongoose is not connected. Attempting to establish a new connection...");
    conn = await mongoose.connect(process.env.MONGO_URI, {
      // These options are recommended for serverless to prevent timeout issues
      serverSelectionTimeoutMS: 5000,
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ New MongoDB connection established.");
    return conn;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    // Ensure the function crashes if the database connection fails.
    throw new Error("Failed to connect to MongoDB.");
  }
};

// --- Mongoose Schema and Model ---
// Best practice to define this once.
const resumeSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  user_subscription: Number,
  ats_score: Number,
  Active_webpage: Number,
  total_resumes_parsed: { type: Number, default: 0 },
  total_webpages_created: { type: Number, default: 0 },
}, { strict: false });

// This prevents Mongoose from redefining the model on every function invocation in a warm start.
const Resume = mongoose.models.Resume || mongoose.model('Resume', resumeSchema);

// --- Utility Functions ---
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const getMaxResumesByTier = (tier) => {
  if (tier === 2) return 10;
  if (tier === 3) return 50;
  return 3;
};

// --- API Routes ---

// Default Route
app.get('/', (req, res) => {
  res.send('Hello World');
});

// Debug Route
app.get('/api/debug', async (req, res) => {
  try {
    await connectToMongo();
    res.json({ status: 'success', msg: 'MongoDB connected successfully' });
  } catch (err) {
    res.status(500).json({ status: 'error', msg: err.message, details: err });
  }
});

// Upload Resume
app.post('/api/resume', async (req, res) => {
  try {
    await connectToMongo();
    const { email, ats_score, user_subscription, Active_webpage, resume } = req.body;
    if (!email || !resume) {
      return res.status(400).json({ error: 'Email and resume data are required' });
    }

    let user = await Resume.findOne({ email });
    const maxAllowed = getMaxResumesByTier(user_subscription);

    if (!user) {
      const newUser = new Resume({
        email,
        user_subscription,
        ats_score,
        Active_webpage,
        total_resumes_parsed: 1,
        total_webpages_created: 1,
        resume1: resume
      });
      await newUser.save();
      return res.status(201).json({ message: 'User created and resume saved as resume1' });
    }

    const resumeKeys = Array.from({ length: maxAllowed }, (_, i) => `resume${i + 1}`);
    for (const key of resumeKeys) {
      if (user.get(key) && deepEqual(user.get(key), resume)) {
        return res.status(409).json({ error: `This resume already exists as ${key}` });
      }
    }

    const nextSlot = resumeKeys.find((key) => !user.get(key));
    if (!nextSlot) {
      return res.status(400).json({ error: `Maximum ${maxAllowed} resumes allowed for your plan.` });
    }
    
    // Use Mongoose's .set() for dynamically adding fields
    user.set(nextSlot, resume);
    user.ats_score = ats_score;
    user.Active_webpage = Active_webpage;
    user.user_subscription = user_subscription;
    user.total_resumes_parsed = (user.total_resumes_parsed || 0) + 1;
    user.total_webpages_created = (user.total_webpages_created || 0) + 1;

    await user.save();
    return res.json({ message: `New resume saved to ${nextSlot}` });

  } catch (err) {
    console.error('Error in POST /api/resume:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Get a User's Resumes
app.get('/api/resume', async (req, res) => {
  try {
    await connectToMongo();
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await Resume.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json(user);
  } catch (err) {
    console.error('Error in GET /api/resume:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Get HTML for a specific resume
app.get('/api/html', async (req, res) => {
  try {
    await connectToMongo();
    const { email, resumeKey } = req.query;
    if (!email || !resumeKey) {
      return res.status(400).json({ error: 'Email and resumeKey are required' });
    }

    const user = await Resume.findOne({ email });
    if (!user || !user.get(resumeKey)) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    
    const html = user.get(resumeKey)?.HTML || 'No HTML found for this resume.';
    return res.json({ email, resumeKey, HTML: html });
  } catch (err) {
    console.error('Error in GET /api/html:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Get Dashboard Summary
app.get('/api/dashboard', async (req, res) => {
  try {
    await connectToMongo();
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await Resume.findOne({ email }).lean(); // Use .lean() for read-only operations
    if (!user) return res.status(404).json({ error: 'User not found' });

    const resumeCount = Object.keys(user).filter(k => k.startsWith('resume')).length;

    return res.json({
      ats_score: user.ats_score,
      active_webpages: user.Active_webpage,
      resume_count: resumeCount,
      subscription_tier: user.user_subscription,
      total_resumes_parsed: user.total_resumes_parsed,
      total_webpages_created: user.total_webpages_created
    });
  } catch (err) {
    console.error('Error in GET /api/dashboard:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// --- Serverless Handler and Local Development ---

// Export for serverless platforms
module.exports.handler = serverless(app);

// Local development server
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, async () => {
    try {
      await connectToMongo();
      console.log(`🚀 Server running locally at http://localhost:${PORT}`);
    } catch (err) {
      console.error("🚫 Failed to start local server:", err);
      process.exit(1);
    }
  });
}