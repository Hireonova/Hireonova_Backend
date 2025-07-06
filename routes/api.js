const express = require('express');
const router = express.Router();
const Resume = require('../db/models');

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const getMaxResumesByTier = (tier) => tier === 3 ? 50 : tier === 2 ? 10 : 3;

router.get('/hello', (req, res) => {
  try {
    res.send('<script>document.write("WORLD!");</script>');
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

router.post('/resume', async (req, res) => {
  const { email, ats_score, user_subscription, Active_webpage, resume } = req.body;
  if (!email || !resume) return res.status(400).json({ error: 'Email and resume are required' });

  try {
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
        resume1: resume,
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
    if (!nextSlot) return res.status(400).json({ error: `Max ${maxAllowed} resumes allowed.` });

    user[nextSlot] = resume;
    user.ats_score = ats_score;
    user.Active_webpage = Active_webpage;
    user.user_subscription = user_subscription;
    user.total_resumes_parsed += 1;
    user.total_webpages_created += 1;

    await user.save();
    return res.json({ message: `Resume saved to ${nextSlot}` });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/resume', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await Resume.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/html', async (req, res) => {
  const { email, resumeKey } = req.query;
  if (!email || !resumeKey) return res.status(400).json({ error: 'Email and resumeKey required' });

  try {
    const user = await Resume.findOne({ email });
    if (!user || !user[resumeKey]) return res.status(404).json({ error: 'Resume not found' });
    const html = user[resumeKey]?.HTML || 'No HTML found';
    res.json({ email, resumeKey, HTML: html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await Resume.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const resumeCount = Object.keys(user.toObject()).filter(k => k.startsWith('resume') && user[k]).length;

    res.json({
      ats_score: user.ats_score,
      active_webpages: user.Active_webpage,
      resume_count: resumeCount,
      subscription_tier: user.user_subscription,
      total_resumes_parsed: user.total_resumes_parsed,
      total_webpages_created: user.total_webpages_created,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;