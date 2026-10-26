const Contest = require("../models/contest.model");
require("node:test").beforeEach(t => { if (!process.env.RUN_LEADERBOARD_INTEGRATION) t.mock.method(Contest, "distinct", async () => []); });
const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Problem = require("../models/problem.model");
const SolvedProblem = require("../models/solvedProblem.model");
const { getLeaderboard } = require("../controllers/leaderboard.controller");

const userId = "507f1f77bcf86cd799439011";
const problemId = "507f1f77bcf86cd799439012";
const solvedAt = new Date("2026-10-18T10:00:00Z");

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

async function request(query = {}) {
    const res = response();
    await getLeaderboard({ query }, res);
    return res;
}

test("leaderboard rejects invalid filters and pagination before database access", async t => {
    t.mock.method(User, "aggregate", () => assert.fail("Database must not be called"));
    t.mock.method(Problem, "exists", () => assert.fail("Database must not be called"));
    for (const filters of [
        { page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "01" }, { page: ["1"] },
        { page: "9007199254740992" }, { page: "9007199254740991", limit: "100" },
        { limit: "0" }, { limit: "101" }, { limit: { $gt: 0 } },
        { department: "unknown" }, { department: ["it"] }, { department: { $ne: "it" } },
        { year: "5th" }, { year: ["2nd"] }, { year: { $ne: "1st" } },
        { problemId: "bad-id" }, { problemId: [problemId] }, { problemId: { $ne: null } },
        { user: userId }, { role: "admin" }, { email: "student@famt.ac.in" },
    ]) {
        assert.equal((await request(filters)).statusCode, 400, JSON.stringify(filters));
    }
});

test("leaderboard preserves database ranks across pages and exposes only public profile fields", async t => {
    t.mock.method(User, "aggregate", async pipeline => {
        assert.deepEqual(pipeline[0], { $match: { role: "student", isVerified: true, department: "it", year: "2nd" } });
        const ranking = pipeline.findIndex(stage => stage.$setWindowFields);
        const pagination = pipeline.findIndex(stage => stage.$facet);
        assert.ok(ranking >= 0 && ranking < pagination);
        assert.deepEqual(pipeline[pagination].$facet.rows, [{ $skip: 20 }, { $limit: 20 }]);
        return [{ rows: [{ _id: userId, name: "Student", department: "it", year: "2nd", rank: 17,
            solvedCount: 3, easyCount: 1, mediumCount: 2, hardCount: 0, lastSolvedAt: solvedAt,
            email: "student@famt.ac.in", passwordHash: "private-hash", tokenVersion: 9 }], count: [{ total: 25 }] }];
    });
    const res = await request({ department: "it", year: "2nd", page: "2" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        leaderboard: [{ rank: 17, user: { id: userId, name: "Student", department: "it", year: "2nd" },
            solvedCount: 3, easyCount: 1, mediumCount: 2, hardCount: 0, lastSolvedAt: solvedAt }],
        page: 2, limit: 20, total: 25,
    });
});

test("a problem leaderboard requires a public problem and gives chronological ranks across pages", async t => {
    t.mock.method(Problem, "exists", async filter => {
        assert.equal(String(filter._id), problemId);
        assert.equal(filter.$or[0].visibility, "public");
        return { _id: problemId };
    });
    t.mock.method(User, "aggregate", async pipeline => {
        assert.ok(pipeline.some(stage => stage.$match?.solvedCount?.$gt === 0));
        assert.deepEqual(pipeline.find(stage => stage.$sort).$sort, { lastSolvedAt: 1, _id: 1 });
        return [{ rows: [{ _id: userId, name: "Student", department: "it", year: "2nd",
            solvedCount: 1, easyCount: 1, mediumCount: 0, hardCount: 0, lastSolvedAt: solvedAt }], count: [{ total: 5 }] }];
    });
    const res = await request({ problemId, page: "2", limit: "2" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.leaderboard[0].rank, 3);
    assert.equal(res.body.total, 5);
});

test("hidden or missing problems cannot be used to query their solvers", async t => {
    t.mock.method(Problem, "exists", async () => null);
    t.mock.method(User, "aggregate", () => assert.fail("Solvers must not be queried"));
    const res = await request({ problemId });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: "Problem not found" });
});

test("an empty leaderboard has stable pagination and zero total", async t => {
    t.mock.method(User, "aggregate", async () => [{ rows: [], count: [] }]);
    const res = await request();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { leaderboard: [], page: 1, limit: 20, total: 0 });
});

test("leaderboard database failures return a safe error", async t => {
    t.mock.method(User, "aggregate", async () => { throw new Error("private connection details"); });
    const res = await request();
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { message: "Could not load leaderboard" });
});

test("real MongoDB ranks unique public solves, shared ties, cohorts and first problem acceptance", {
    skip: process.env.RUN_LEADERBOARD_INTEGRATION !== "1",
    timeout: 60000,
}, async () => {
    assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI before running the integration test");
    const database = `cf_lb_test_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    try {
        // An isolated database with indexes disabled permits legacy duplicate fixtures.
        await mongoose.connect(process.env.MONGODB_URI, { dbName: database, autoIndex: false, serverSelectionTimeoutMS: 10000 });
        const ids = Object.fromEntries(["anna", "bea", "chen", "dev", "admin", "unverified", "orphan",
            "easy", "medium", "hard", "draft", "contest", "deleted"].map(key => [key, new mongoose.Types.ObjectId()]));
        await User.collection.insertMany([
            { _id: ids.anna, name: "Anna", department: "it", year: "2nd", role: "student", isVerified: true },
            { _id: ids.bea, name: "Bea", department: "aiml", year: "3rd", role: "student", isVerified: true },
            { _id: ids.chen, name: "Chen", department: "it", year: "2nd", role: "student", isVerified: true },
            { _id: ids.dev, name: "Dev", department: "it", year: "1st", role: "student", isVerified: true },
            { _id: ids.admin, name: "Admin", department: "it", year: "2nd", role: "admin", isVerified: true },
            { _id: ids.unverified, name: "Unverified", department: "it", year: "2nd", role: "student", isVerified: false },
        ]);
        await Problem.collection.insertMany([
            { _id: ids.easy, visibility: "public", difficulty: "easy" },
            { _id: ids.medium, visibility: "public", difficulty: "medium" },
            { _id: ids.hard, visibility: "public", difficulty: "hard" },
            { _id: ids.draft, visibility: "draft", difficulty: "easy" },
            { _id: ids.contest, visibility: "contest", difficulty: "hard" },
        ]);
        const time = minute => new Date(Date.UTC(2026, 9, 18, 10, minute));
        await SolvedProblem.collection.insertMany([
            ["anna", "easy", 1], ["anna", "easy", 10], ["anna", "medium", 4],
            ["bea", "easy", 2], ["bea", "hard", 3], ["chen", "medium", 5],
            ["dev", "draft", 1], ["dev", "contest", 1], ["dev", "deleted", 1],
            ["admin", "easy", 1], ["unverified", "easy", 1], ["orphan", "easy", 1],
        ].map(([user, problem, minute]) => ({ user: ids[user], problem: ids[problem], solvedAt: time(minute) })));

        const overall = await request();
        assert.equal(overall.statusCode, 200);
        assert.equal(overall.body.total, 4);
        assert.deepEqual(overall.body.leaderboard.map(row => [row.user.name, row.rank, row.solvedCount]),
            [["Bea", 1, 2], ["Anna", 1, 2], ["Chen", 3, 1], ["Dev", 4, 0]]);
        assert.deepEqual(overall.body.leaderboard.map(row => [row.easyCount, row.mediumCount, row.hardCount]),
            [[1, 0, 1], [1, 1, 0], [0, 1, 0], [0, 0, 0]]);
        assert.equal(overall.body.leaderboard[1].lastSolvedAt.getTime(), time(4).getTime());
        assert.equal(overall.body.leaderboard[3].lastSolvedAt, null);

        const secondPage = await request({ page: "2", limit: "1" });
        assert.equal(secondPage.body.leaderboard[0].user.name, "Anna");
        assert.equal(secondPage.body.leaderboard[0].rank, 1);
        assert.equal(secondPage.body.total, 4);
        const beyondEnd = await request({ page: "10", limit: "1" });
        assert.deepEqual(beyondEnd.body.leaderboard, []);
        assert.equal(beyondEnd.body.total, 4);

        const department = await request({ department: "it" });
        assert.deepEqual(department.body.leaderboard.map(row => [row.user.name, row.rank]),
            [["Anna", 1], ["Chen", 2], ["Dev", 3]]);
        const year = await request({ department: "it", year: "2nd" });
        assert.deepEqual(year.body.leaderboard.map(row => row.user.name), ["Anna", "Chen"]);
        const empty = await request({ department: "mechanical" });
        assert.deepEqual(empty.body.leaderboard, []);
        assert.equal(empty.body.total, 0);

        const byProblem = await request({ problemId: String(ids.easy) });
        assert.deepEqual(byProblem.body.leaderboard.map(row => [row.user.name, row.rank]), [["Anna", 1], ["Bea", 2]]);
        assert.equal(byProblem.body.leaderboard[0].lastSolvedAt.getTime(), time(1).getTime());
        const problemPage = await request({ problemId: String(ids.easy), page: "2", limit: "1" });
        assert.equal(problemPage.body.leaderboard[0].rank, 2);
        assert.equal(problemPage.body.total, 2);
        const combined = await request({ problemId: String(ids.easy), department: "aiml", year: "3rd" });
        assert.deepEqual(combined.body.leaderboard.map(row => [row.user.name, row.rank]), [["Bea", 1]]);
        for (const key of ["draft", "contest", "deleted"]) {
            assert.equal((await request({ problemId: String(ids[key]) })).statusCode, 404);
        }

        await Problem.updateOne({ _id: ids.medium }, { $set: { visibility: "draft" } });
        const unpublished = await request({ department: "it", year: "2nd" });
        assert.deepEqual(unpublished.body.leaderboard.map(row => [row.user.name, row.solvedCount]), [["Anna", 1], ["Chen", 0]]);
    } finally {
        try {
            if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
        } finally {
            await mongoose.disconnect();
        }
    }
});
