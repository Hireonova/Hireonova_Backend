const express = require('express');
const router = express.Router();
const Resume = require('../db/models');

const deepEqual = (a, b) => {
    const cleanA = a ? JSON.parse(JSON.stringify(a)) : a;
    const cleanB = b ? JSON.parse(JSON.stringify(b)) : b;
    if (cleanA && typeof cleanA === 'object') delete cleanA._id;
    if (cleanB && typeof cleanB === 'object') delete cleanB._id;
    return JSON.stringify(cleanA) === JSON.stringify(cleanB);
};

const getMaxResumesByTier = (tier) => {
    if (tier === 3) return 10;  // Fixed: Tier 3 allows 10 resumes
    if (tier === 2) return 5;   // Fixed: Tier 2 allows 5 resumes
    return 3;                   // Tier 1 (free) allows 3 resumes
};

const countActiveResumes = (user) => {
    if (!user) return 0;
    return Object.keys(user.toObject()).filter(k => k.startsWith('resume') && !k.endsWith('_html') && user[k]).length;
};

router.post('/resume', async (req, res) => {
    const { email, resume, html_content } = req.body;
    if (!email || !resume) {
        return res.status(400).json({ error: 'Email and resume object are required.' });
    }

    try {
        let user = await Resume.findOne({ email });

        if (!user) {
            const newUser = new Resume({
                email,
                user_subscription: 1,
                total_resumes_parsed: 1,
                Active_webpage: 1,
                resume1: resume,
                resume1_html: html_content || '',
                ats_score: resume.ats_score || 0
            });
            await newUser.save();
            return res.status(201).json({ message: 'New user created and resume saved in resume1.', user: newUser });
        }

        const maxAllowed = getMaxResumesByTier(user.user_subscription);
        const currentResumeCount = countActiveResumes(user);
        
        // Check if user has reached the maximum limit
        if (currentResumeCount >= maxAllowed) {
            const message = user.user_subscription === 1
                ? `Maximum limit reached in free tier. You can only store ${maxAllowed} resumes. Please upgrade to add more.`
                : `You have reached the maximum limit of ${maxAllowed} resumes for your current tier.`;
            return res.status(403).json({ error: message });
        }

        const resumeKeys = Array.from({ length: maxAllowed }, (_, i) => `resume${i + 1}`);

        // Check for duplicate resumes
        for (const key of resumeKeys) {
            if (user[key] && deepEqual(user[key], resume)) {
                return res.status(409).json({ error: `This exact resume already exists in ${key}.` });
            }
        }

        const nextSlotKey = resumeKeys.find(key => !user[key]);

        if (!nextSlotKey) {
            const message = user.user_subscription === 1
                ? `Maximum limit reached in free tier. You can only store ${maxAllowed} resumes. Please upgrade to add more.`
                : `You have reached the maximum limit of ${maxAllowed} resumes for your current tier.`;
            return res.status(403).json({ error: message });
        }

        const htmlSlotKey = `${nextSlotKey}_html`;
        user[nextSlotKey] = resume;
        user[htmlSlotKey] = html_content || '';
        user.total_resumes_parsed += 1;
        user.Active_webpage = countActiveResumes(user);

        await user.save();
        res.status(200).json({ message: `Resume successfully saved to ${nextSlotKey}.`, user });

    } catch (err) {
        res.status(500).json({ error: 'Server error.', details: err.message });
    }
});

router.put('/resume/update', async (req, res) => {
    const { email, resume_number, resume, html_content } = req.body;
    if (!email || !resume_number || !resume) {
        return res.status(400).json({ error: 'Email, resume_number, and resume object are required.' });
    }

    const resumeKey = `resume${resume_number}`;
    const htmlKey = `${resumeKey}_html`;

    try {
        const user = await Resume.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (!user[resumeKey]) return res.status(404).json({ error: `Resume ${resume_number} not found.` });

        user[resumeKey] = resume;
        if (html_content !== undefined) {
            user[htmlKey] = html_content;
        }

        user.markModified(resumeKey);
        await user.save();
        res.status(200).json({ message: `${resumeKey} updated successfully.`, user });

    } catch (err) {
        res.status(500).json({ error: 'Server error.', details: err.message });
    }
});

router.put('/resume/ats', async (req, res) => {
    const { email, ats_score } = req.body;
    if (!email || ats_score === undefined) {
        return res.status(400).json({ error: 'Email and ats_score are required.' });
    }

    try {
        const user = await Resume.findOneAndUpdate(
            { email },
            { ats_score },
            { new: true }
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.status(200).json({ message: `ATS score updated successfully.`, user });
    } catch (err) {
        res.status(500).json({ error: 'Server error.', details: err.message });
    }
});

router.get('/resume', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    try {
        const user = await Resume.findOne({ email }).lean();
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const maxAllowed = getMaxResumesByTier(user.user_subscription);
        const resumeKeys = Array.from({ length: maxAllowed }, (_, i) => `resume${i + 1}`);

        const resumes = resumeKeys
            .filter(key => user[key])
            .map(key => ({
                slot: key,
                data: user[key],
                html: user[`${key}_html`] || ''
            }));

        res.status(200).json({ 
            email: user.email, 
            resumes,
            subscription_tier: user.user_subscription,
            max_resumes_allowed: maxAllowed,
            current_resume_count: resumes.length
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error.', details: err.message });
    }
});

router.get('/dashboard', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    try {
        const user = await Resume.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const resumeCount = countActiveResumes(user);
        const maxAllowed = getMaxResumesByTier(user.user_subscription);

        // Sync Active_webpage and total_resumes_parsed with actual count
        if (user.Active_webpage !== resumeCount) {
            user.Active_webpage = resumeCount;
            user.total_resumes_parsed = resumeCount;
            await user.save();
        }

        res.status(200).json({
            ats_score: user.ats_score,
            active_webpages: user.Active_webpage,
            resume_count: resumeCount,
            subscription_tier: user.user_subscription,
            total_resumes_parsed: user.total_resumes_parsed,
            max_resumes_allowed: maxAllowed
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error.', details: err.message });
    }
});

router.put('/admin/subscription', async (req, res) => {
    const { email, new_subscription_tier } = req.body;
    if (!email || new_subscription_tier === undefined) {
        return res.status(400).json({ error: 'Email and new_subscription_tier are required.' });
    }
    if (![1, 2, 3].includes(new_subscription_tier)) {
        return res.status(400).json({ error: 'Invalid subscription tier. Must be 1, 2, or 3.' });
    }

    try {
        const user = await Resume.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const currentResumeCount = countActiveResumes(user);
        const newMaxAllowed = getMaxResumesByTier(new_subscription_tier);

        // Check if downgrading would exceed new limit
        if (currentResumeCount > newMaxAllowed) {
            return res.status(400).json({ 
                error: `Cannot downgrade to tier ${new_subscription_tier}. User has ${currentResumeCount} resumes but tier ${new_subscription_tier} only allows ${newMaxAllowed} resumes.` 
            });
        }

        user.user_subscription = new_subscription_tier;
        await user.save();
        
        res.status(200).json({ 
            message: `User subscription updated to Tier ${new_subscription_tier}.`, 
            user,
            max_resumes_allowed: newMaxAllowed
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error.', details: err.message });
    }
});

module.exports = router;