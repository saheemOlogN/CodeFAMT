const Contest = require("../models/contest.model");
require("node:test").beforeEach(t => { if (!process.env.RUN_LEADERBOARD_INTEGRATION) t.mock.method(Contest, "distinct", async () => []); });
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Problem = require('../models/problem.model');
const SolvedProblem = require('../models/solvedProblem.model');
const Submission = require('../models/submission.model');
const { getProfileStats } = require('../controllers/profileStats.controller');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('profile statistics use only the current user and public problem counts', async t => {
    const user = new mongoose.Types.ObjectId();
    t.mock.method(Problem, 'aggregate', async pipeline => {
        assert.deepEqual(pipeline[0].$match, { $or: [{ visibility: 'public' }, { visibility: 'contest', _id: { $in: [] } }] });
        return [{ _id: 'easy', count: 10 }];
    });
    t.mock.method(SolvedProblem, 'aggregate', async pipeline => {
        assert.equal(pipeline[0].$match.user, user);
        assert.deepEqual(pipeline[1].$lookup.pipeline[0].$match.$or[0], { visibility: 'public' });
        return [{ _id: 'easy', count: 2 }];
    });
    t.mock.method(Submission, 'aggregate', async pipeline => {
        assert.equal(pipeline[0].$match.user, user);
        return [{ _id: 'cpp', count: 5 }];
    });
    const res = response();
    await getProfileStats({ user: { _id: user } }, res);
    assert.deepEqual(res.body, { difficulties: [
        { difficulty: 'easy', total: 10, solved: 2 },
        { difficulty: 'medium', total: 0, solved: 0 },
        { difficulty: 'hard', total: 0, solved: 0 },
    ], languages: [{ language: 'cpp', count: 5 }] });
});

test('profile statistics return a safe error on database failure', async t => {
    t.mock.method(Problem, 'aggregate', async () => { throw Error('private connection details'); });
    t.mock.method(SolvedProblem, 'aggregate', async () => []);
    t.mock.method(Submission, 'aggregate', async () => []);
    const res = response();
    await getProfileStats({ user: { _id: new mongoose.Types.ObjectId() } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Could not load profile statistics');
});
