const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTestImport } = require('../utils/testImport');
const { validRoadmap } = require('../controllers/roadmap.controller');
const { practiceFilter, canPractice } = require('../utils/practiceAccess');
const Contest = require('../models/contest.model');
const submissions = require('../controllers/submission.controller');

test('JSON imports validate every row before accepting the batch', () => {
    assert.equal(validateTestImport({ testCases: [{ input: '', expectedOutput: '' }] }), null);
    for (const body of [null, [], { testCases: [] }, { testCases: Array(101).fill({ input: '', expectedOutput: '' }) },
        { testCases: [{ input: [1, 2], expectedOutput: '3' }] }, { testCases: [{ input: 'x\0', expectedOutput: '3' }] },
        { testCases: [{ input: '', expectedOutput: 'é'.repeat(32769) }] }, { testCases: [{ input: '', expectedOutput: '', problem: 'forged' }] }]) {
        assert.ok(validateTestImport(body));
    }
});

test('roadmaps reject script links, credentials, unknown fields and oversized lists', () => {
    const good = { title: 'DSA', description: '', sheetUrl: 'https://example.com/sheet', steps: [{ title: 'Arrays', description: '', resourceUrl: '' }] };
    assert.ok(validRoadmap(good));
    for (const change of [{ sheetUrl: 'javascript:alert(1)' }, { sheetUrl: 'https://user:password@example.com' }, { steps: Array(101).fill(good.steps[0]) }, { title: '' }, { owner: 'forged' }]) assert.ok(!validRoadmap({ ...good, ...change }));
});

test('practice access requires a published contest at or beyond its end time', async t => {
    const now = new Date('2026-10-25T12:00:00Z');
    t.mock.method(Contest, 'distinct', async (field, filter) => {
        assert.equal(field, 'problems.problem');
        assert.deepEqual(filter, { status: 'published', endTime: { $lte: now } });
        return ['released'];
    });
    const filter = await practiceFilter(now);
    assert.deepEqual(filter.$or[1], { visibility: 'contest', _id: { $in: ['released'] } });
    let ended = false;
    t.mock.method(Contest, 'exists', async query => { assert.equal(query.status, 'published'); assert.equal(query.endTime.$lte, now); return ended ? { _id: 'contest' } : null; });
    const problem = { _id: 'released', visibility: 'contest' };
    assert.equal(await canPractice(problem, now), false);
    ended = true;
    assert.equal(await canPractice(problem, now), true);
    assert.equal(await canPractice({ ...problem, visibility: 'draft' }, now), false);
});

test('new runs and submissions reject CP even if explicitly requested', async () => {
    for (const action of [submissions.runCode, submissions.submitCode]) {
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await action({ body: { mode: 'cp', problemId: '507f1f77bcf86cd799439011', language: 'cpp', code: 'int main(){}' } }, res);
        assert.equal(res.code, 400);
    }
});

const User = require('../models/user.model');
const Roadmap = require('../models/roadmap.model');
const { saveProgress, getRoadmap, identifiedSteps } = require('../controllers/roadmap.controller');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('roadmap progress is per-account, idempotent and reversible', async t => {
    t.mock.method(Roadmap, 'findById', () => ({ lean: async () => ({ steps: [{ id: 'arrays', title: 'Arrays' }] }) }));
    const calls = [];
    t.mock.method(User, 'updateOne', async (filter, update) => { calls.push({ filter, update }); });
    for (const completed of [true, false]) {
        const res = response();
        await saveProgress({ user: { _id: 'current-user' }, body: { stepId: 'arrays', completed } }, res);
        assert.equal(res.code, 200);
    }
    assert.deepEqual(calls, [
        { filter: { _id: 'current-user' }, update: { $addToSet: { roadmapCompleted: 'arrays' } } },
        { filter: { _id: 'current-user' }, update: { $pull: { roadmapCompleted: 'arrays' } } },
    ]);
    for (const body of [{ stepId: 'arrays', completed: true, user: 'someone-else' }, { stepId: 'arrays', completed: 'true' }]) {
        const res = response(); await saveProgress({ user: { _id: 'me' }, body }, res); assert.equal(res.code, 400);
    }
    const missing = response(); await saveProgress({ user: { _id: 'me' }, body: { stepId: 'removed', completed: true } }, missing);
    assert.equal(missing.code, 404); assert.equal(calls.length, 2);
});

test('roadmap hides deleted-topic completions and retains identity after reorder', async t => {
    const steps = identifiedSteps([{ title: 'Arrays' }, { title: 'Graphs' }]);
    assert.equal(identifiedSteps([...steps].reverse())[1].id, steps[0].id);
    t.mock.method(Roadmap, 'findById', () => ({ lean: async () => ({ steps }) }));
    t.mock.method(User, 'findById', id => { assert.equal(id, 'me'); return { select: () => ({ lean: async () => ({ roadmapCompleted: [steps[0].id, 'deleted'] }) }) }; });
    const res = response(); await getRoadmap({ user: { _id: 'me' } }, res);
    assert.deepEqual(res.body.completed, [steps[0].id]);
});

test('roadmap rejects duplicate completion identifiers', () => {
    const step = { id: 'same', title: 'Arrays', description: '', resourceUrl: '' };
    assert.equal(validRoadmap({ title: 'DSA', description: '', sheetUrl: '', steps: [step, step] }), false);
});
