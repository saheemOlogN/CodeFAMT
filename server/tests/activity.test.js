const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const Submission = require("../models/submission.model");
const { getActivity } = require("../controllers/activity.controller");
const userId = new mongoose.Types.ObjectId();
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
test("activity is scoped to the authenticated user and groups by India dates", async t => {
    let pipeline;
    t.mock.method(Submission, "aggregate", async value => { pipeline = value; return [{ date: "2024-02-29", count: 3 }]; });
    const res = response();
    await getActivity({ user: { _id: userId }, query: { year: "2024" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(pipeline[0].$match.user, userId);
    assert.equal(pipeline[0].$match.createdAt.$gte.toISOString(), "2023-12-31T18:30:00.000Z");
    assert.equal(pipeline[0].$match.createdAt.$lt.toISOString(), "2024-12-31T18:30:00.000Z");
    assert.equal(pipeline[1].$group._id.$dateToString.timezone, "Asia/Kolkata");
    assert.deepEqual(res.body.days, [{ date: "2024-02-29", count: 3 }]);
    assert.equal(res.body.year, 2024);
});
test("activity rejects another user's identifier and invalid years", async t => {
    t.mock.method(Submission, "aggregate", () => assert.fail("must not query"));
    for (const query of [{ userId: String(userId) }, { year: "1999" }, { year: "9999" }, { year: "2024x" }, { year: ["2024"] }, { year: { $gt: 0 } }]) {
        const res = response();
        await getActivity({ user: { _id: userId }, query }, res);
        assert.equal(res.statusCode, 400);
    }
});
test("activity returns empty days and safe database errors", async t => {
    let failing = false;
    t.mock.method(Submission, "aggregate", async () => { if (failing) throw Error("private database URI"); return []; });
    const res = response();
    await getActivity({ user: { _id: userId }, query: {} }, res);
    assert.deepEqual(res.body.days, []);
    failing = true;
    await getActivity({ user: { _id: userId }, query: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message.includes("private"), false);
});
test("real activity aggregation respects midnight in India and excludes other users", { skip: process.env.RUN_ACTIVITY_INTEGRATION !== "1", timeout: 60000 }, async () => {
    const database = `cf_test_activity_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: database, serverSelectionTimeoutMS: 15000 });
        const base = { user: userId, problem: new mongoose.Types.ObjectId(), language: "cpp", code: "test", status: "wrong_answer" };
        await Submission.collection.insertMany([
            { ...base, createdAt: new Date("2023-12-31T18:29:59Z") },
            { ...base, createdAt: new Date("2023-12-31T18:30:00Z") },
            { ...base, createdAt: new Date("2024-02-28T18:30:00Z") },
            { ...base, createdAt: new Date("2024-02-29T12:00:00Z") },
            { ...base, createdAt: new Date("2024-12-31T18:30:00Z") },
            { ...base, user: new mongoose.Types.ObjectId(), createdAt: new Date("2024-02-29T12:00:00Z") },
        ]);
        const res = response();
        await getActivity({ user: { _id: userId }, query: { year: "2024" } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.days, [{ date: "2024-01-01", count: 1 }, { date: "2024-02-29", count: 2 }]);
    } finally {
        try {
            if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
        } finally {
            await mongoose.disconnect();
        }
    }
});
