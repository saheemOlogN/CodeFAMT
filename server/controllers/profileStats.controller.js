const { practiceFilter } = require('../utils/practiceAccess');
const Problem = require('../models/problem.model');
const SolvedProblem = require('../models/solvedProblem.model');
const Submission = require('../models/submission.model');

async function getProfileStats(req, res) {
    try {
        const visible = await practiceFilter();
        const [available, solved, languages] = await Promise.all([
            Problem.aggregate([{ $match: visible }, { $group: { _id: '$difficulty', count: { $sum: 1 } } }]),
            SolvedProblem.aggregate([
                { $match: { user: req.user._id } },
                { $lookup: { from: Problem.collection.name, localField: 'problem', foreignField: '_id', pipeline: [{ $match: visible }], as: 'problem' } },
                { $unwind: '$problem' },
                { $group: { _id: '$problem.difficulty', count: { $sum: 1 } } },
            ]),
            Submission.aggregate([
                { $match: { user: req.user._id } },
                { $group: { _id: '$language', count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
            ]),
        ]);
        const difficulties = ['easy', 'medium', 'hard'].map(difficulty => ({
            difficulty,
            total: available.find(row => row._id === difficulty)?.count || 0,
            solved: solved.find(row => row._id === difficulty)?.count || 0,
        }));
        return res.json({ difficulties, languages: languages.map(row => ({ language: row._id, count: row.count })) });
    } catch {
        return res.status(500).json({ message: 'Could not load profile statistics' });
    }
}

module.exports = { getProfileStats };
