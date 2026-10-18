const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const mongoose = require("mongoose");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Submission = require("../models/submission.model");
const controller = require("../controllers/contest.controller");

const userId = new mongoose.Types.ObjectId();
const contestId = new mongoose.Types.ObjectId();
const problemId = new mongoose.Types.ObjectId();
const replacements = [];

function mock(target, key, value) {
    replacements.push([target, key, target[key]]);
    target[key] = value;
}

afterEach(() => {
    for (const [target, key, value] of replacements.reverse()) {
        target[key] = value;
    }
    replacements.length = 0;
});

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        lean() { return Promise.resolve(value); },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function request(body = {}) {
    return {
        params: { id: String(contestId), problemId: String(problemId) },
        query: {},
        body,
        user: { _id: userId, role: "student" },
    };
}

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

function contest(overrides = {}) {
    return new Contest({
        _id: contestId,
        title: "Weekly contest",
        startTime: new Date(Date.now() + 60000),
        endTime: new Date(Date.now() + 3600000),
        problems: [{ problem: problemId, points: 100 }],
        createdBy: userId,
        updatedAt: new Date(),
        ...overrides,
    });
}

test("creation forces draft status and authenticated owner", async () => {
    let saved;
    mock(Problem, "countDocuments", async () => 1);
    mock(Contest.prototype, "save", async function () { saved = this; return this; });
    const req = request({
        ...contest().toObject(),
        createdBy: new mongoose.Types.ObjectId(),
        problems: [{ problem: problemId, points: 100, score: 999999 }],
    });
    const res = response();

    await controller.createContest(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(saved.status, "draft");
    assert.equal(String(saved.createdBy), String(userId));
    assert.equal(saved.problems[0].score, undefined);
});

test("creation rejects duplicate problems and direct publication", async () => {
    const req = request(contest().toObject());
    req.body.problems.push({ problem: problemId, points: 200 });
    const duplicates = response();
    await controller.createContest(req, duplicates);
    assert.equal(duplicates.statusCode, 400);

    req.body.status = "published";
    const publication = response();
    await controller.createContest(req, publication);
    assert.equal(publication.statusCode, 400);
});

test("contest problem count is limited to 20", async () => {
    const req = request(contest().toObject());
    req.body.problems = Array.from({ length: 21 }, () => ({ problem: new mongoose.Types.ObjectId(), points: 100 }));
    const res = response();
    await controller.createContest(req, res);
    assert.equal(res.statusCode, 400);
});

test("upcoming contest details hide every problem identifier", async () => {
    const record = contest({ status: "published" }).toObject();
    mock(Contest, "findById", () => query(record));
    mock(ContestParticipant, "exists", async () => ({ _id: userId }));
    const res = response();

    await controller.getContest(request(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.contest.problemCount, 1);
    assert.equal(res.body.contest.problems, undefined);
    assert.equal(JSON.stringify(res.body).includes(String(problemId)), false);
});

test("cancelled contests and nonparticipants do not reveal problems", async () => {
    const record = contest({ status: "cancelled", startTime: new Date(Date.now() - 60000) }).toObject();
    mock(Contest, "findById", () => query(record));
    mock(ContestParticipant, "exists", async () => null);
    const cancelled = response();
    await controller.getContest(request(), cancelled);
    assert.equal(cancelled.body.contest.problems, undefined);

    record.status = "published";
    const outsider = response();
    await controller.getContest(request(), outsider);
    assert.equal(outsider.body.contest.problems, undefined);
});

test("draft update validates date order", async () => {
    const record = contest();
    mock(Contest, "findById", () => query(record));
    const res = response();
    await controller.updateContest(request({ endTime: new Date(Date.now() - 60000) }), res);
    assert.equal(res.statusCode, 400);
});

test("publishing rejects empty contests and problems without tests", async () => {
    let record = contest({ problems: [] });
    mock(Contest, "findById", () => query(record));
    const empty = response();
    await controller.updateContest(request({ status: "published" }), empty);
    assert.equal(empty.statusCode, 400);

    record = contest();
    mock(Problem, "countDocuments", async (filter) => {
        assert.equal(filter.visibility, "contest");
        return 1;
    });
    mock(TestCase, "distinct", async () => []);
    const missingTests = response();
    await controller.updateContest(request({ status: "published" }), missingTests);
    assert.equal(missingTests.statusCode, 400);
});

test("publication saves only if the draft has not changed", async () => {
    const record = contest();
    let saved = false;
    mock(Contest, "findById", () => query(record));
    mock(Problem, "countDocuments", async () => 1);
    mock(TestCase, "distinct", async () => [problemId]);
    record.save = async () => { saved = true; };
    const res = response();

    await controller.updateContest(request({ status: "published" }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(record.$where.status, "draft");
    assert.equal(record.$where.updatedAt, record.updatedAt);
});

test("published and cancelled contests reject configuration changes", async () => {
    let record = contest({ status: "published" });
    mock(Contest, "findById", () => query(record));
    const published = response();
    await controller.updateContest(request({ title: "Changed" }), published);
    assert.equal(published.statusCode, 409);

    record = contest({ status: "cancelled" });
    const cancelled = response();
    await controller.updateContest(request({ status: "draft" }), cancelled);
    assert.equal(cancelled.statusCode, 409);
});

test("published contests can only be cancelled before their start", async () => {
    const record = contest({ status: "published" });
    mock(Contest, "findById", () => query(record));
    record.save = async () => record;
    const upcoming = response();
    await controller.updateContest(request({ status: "cancelled" }), upcoming);
    assert.equal(upcoming.statusCode, 200);

    record.status = "published";
    record.startTime = new Date(Date.now() - 60000);
    const ongoing = response();
    await controller.updateContest(request({ status: "cancelled" }), ongoing);
    assert.equal(ongoing.statusCode, 409);
});

test("a draft with submissions cannot be deleted", async () => {
    mock(Contest, "findById", () => query(contest()));
    mock(ContestParticipant, "exists", async () => null);
    mock(Submission, "exists", async () => ({ _id: new mongoose.Types.ObjectId() }));
    const res = response();
    await controller.deleteContest(request(), res);
    assert.equal(res.statusCode, 409);
});

test("joining during a contest uses an idempotent upsert", async () => {
    mock(Contest, "findById", () => query(contest({ status: "published", startTime: new Date(Date.now() - 60000) })));
    let writes = 0;
    mock(ContestParticipant, "updateOne", async (filter, update, options) => {
        assert.equal(String(filter.user), String(userId));
        assert.equal(options.upsert, true);
        assert.deepEqual(update.$setOnInsert, filter);
        writes++;
    });
    const first = response();
    const second = response();
    await controller.joinContest(request(), first);
    await controller.joinContest(request(), second);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(writes, 2);
});

test("joining ends at the server deadline", async () => {
    mock(Contest, "findById", () => query(contest({ status: "published", endTime: new Date(Date.now() - 1) })));
    const res = response();
    await controller.joinContest(request(), res);
    assert.equal(res.statusCode, 409);
});

test("problem access requires the contest to start and the user to join", async () => {
    const record = contest({ status: "published" });
    mock(Contest, "findById", () => query(record));
    mock(ContestParticipant, "exists", async () => null);
    const upcoming = response();
    await controller.getContestProblem(request(), upcoming);
    assert.equal(upcoming.statusCode, 403);

    record.startTime = new Date(Date.now() - 60000);
    const outsider = response();
    await controller.getContestProblem(request(), outsider);
    assert.equal(outsider.statusCode, 403);
});

test("contest problem projection includes statements but never hidden tests", async () => {
    mock(Contest, "findById", () => query(contest({ status: "published", startTime: new Date(Date.now() - 60000) })));
    mock(ContestParticipant, "exists", async () => ({ _id: userId }));
    mock(Problem, "findById", () => ({
        select(fields) {
            assert.ok(fields.includes("statement"));
            assert.ok(!fields.includes("expectedOutput"));
            assert.ok(!fields.includes("createdBy"));
            return query({ _id: problemId, title: "Two sum" });
        },
    }));
    const res = response();
    await controller.getContestProblem(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.points, 100);
});

test("leaderboard filters receipt times and scores each problem once", async () => {
    const record = contest({ status: "published", startTime: new Date(Date.now() - 60000) });
    mock(Contest, "findById", () => query(record));
    mock(ContestParticipant, "aggregate", async (pipeline) => {
        assert.deepEqual(pipeline[0], { $match: { contest: contestId } });
        const scoring = pipeline[1].$lookup.pipeline;
        assert.equal(scoring[0].$match.status, "accepted");
        assert.deepEqual(scoring[0].$match.createdAt, { $gte: record.startTime, $lt: record.endTime });
        assert.deepEqual(scoring[1].$group, { _id: "$problem", acceptedAt: { $min: "$createdAt" } });
        assert.equal(scoring[2].$group.score.$sum.$switch.branches[0].then, 100);
        assert.deepEqual(pipeline[2].$lookup.pipeline[0].$project, { name: 1, department: 1, year: 1 });
        assert.deepEqual(pipeline[5].$sort, { score: -1, lastScoredAt: 1, "user._id": 1 });
        assert.deepEqual(pipeline[6].$facet.rows, [{ $skip: 20 }, { $limit: 20 }]);
        return [{ rows: [{ user: { _id: userId, name: "Student" }, score: 0, solvedCount: 0, lastScoredAt: null }], count: [{ total: 21 }] }];
    });
    const req = request();
    req.query.page = "2";
    const res = response();
    await controller.getLeaderboard(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.leaderboard[0].rank, 21);
    assert.equal(res.body.leaderboard[0].score, 0);
    assert.equal(res.body.total, 21);
});

test("pagination rejects unbounded requests", async () => {
    const req = request();
    req.query.limit = "10000";
    const res = response();
    await controller.getLeaderboard(req, res);
    assert.equal(res.statusCode, 400);
});
