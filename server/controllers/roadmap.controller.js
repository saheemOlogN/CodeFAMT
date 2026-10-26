const { createHash, randomUUID } = require('node:crypto');
const User = require('../models/user.model');
const Roadmap = require('../models/roadmap.model');
function safeUrl(value) {
    if (value === '') return true;
    if (typeof value !== 'string' || value.length > 2000) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
function validRoadmap(body) {
    const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim());
    return body && !Array.isArray(body) && Object.keys(body).every(key => ['title', 'description', 'sheetUrl', 'steps'].includes(key)) &&
        text(body.title, 120, true) && text(body.description, 2000) && safeUrl(body.sheetUrl) && Array.isArray(body.steps) && body.steps.length <= 100 &&
        body.steps.every(step => step && !Array.isArray(step) && Object.keys(step).every(key => ['id', 'title', 'description', 'resourceUrl'].includes(key)) && (step.id === undefined || (typeof step.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(step.id))) && text(step.title, 120, true) && text(step.description, 2000) && safeUrl(step.resourceUrl)) && new Set(body.steps.filter(step => step.id).map(step => step.id)).size === body.steps.filter(step => step.id).length;
}
function identifiedSteps(steps) {
    return steps.map((step, index) => ({ ...step, id: step.id || createHash('sha256').update(`${index}:${step.title}`).digest('hex').slice(0, 24) }));
}
async function getRoadmap(req, res) {
    try {
        const roadmap = await Roadmap.findById('main').lean() || { title: 'Learning roadmap', description: '', sheetUrl: '', steps: [] };
        roadmap.steps = identifiedSteps(roadmap.steps);
        const user = await User.findById(req.user._id).select('+roadmapCompleted').lean();
        const ids = new Set(roadmap.steps.map(step => step.id));
        return res.json({ roadmap, completed: (user?.roadmapCompleted || []).filter(id => ids.has(id)) });
    } catch { return res.status(500).json({ message: 'Could not load roadmap' }); }
}
async function saveProgress(req, res) {
    const body = req.body;
    if (!body || Object.keys(body).some(key => !['stepId', 'completed'].includes(key)) || typeof body.stepId !== 'string' || typeof body.completed !== 'boolean') return res.status(400).json({ message: 'Choose a topic and its completion status.' });
    try {
        const roadmap = await Roadmap.findById('main').lean();
        if (!roadmap || !identifiedSteps(roadmap.steps).some(step => step.id === body.stepId)) return res.status(404).json({ message: 'This topic was removed. Refresh the roadmap.' });
        await User.updateOne({ _id: req.user._id }, { [body.completed ? '$addToSet' : '$pull']: { roadmapCompleted: body.stepId } });
        return res.json({ stepId: body.stepId, completed: body.completed });
    } catch { return res.status(500).json({ message: 'Could not save your progress. Try again.' }); }
}
async function saveRoadmap(req, res) {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    if (!validRoadmap(req.body)) return res.status(400).json({ message: 'Provide a title, up to 100 topic steps, and valid HTTPS resource links.' });
    try {
        const { title, description, sheetUrl, steps } = req.body;
        const roadmap = await Roadmap.findOneAndUpdate({ _id: 'main' }, { $set: { title, description, sheetUrl, steps: steps.map(step => ({ ...step, id: step.id || randomUUID() })) } }, { upsert: true, returnDocument: 'after', runValidators: true });
        return res.json({ roadmap });
    } catch { return res.status(500).json({ message: 'Could not save roadmap' }); }
}
module.exports = { getRoadmap, saveRoadmap, saveProgress, validRoadmap, identifiedSteps };
