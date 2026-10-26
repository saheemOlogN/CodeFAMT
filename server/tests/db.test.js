const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/user.model");
const Submission = require("../models/submission.model");

test("startup prepares indexes and queue versions without resetting active jobs", async (t) => {
    let connected = false;
    const initialized = [];
    t.mock.method(mongoose, "connect", async (_uri, options) => {
        assert.equal(options.serverSelectionTimeoutMS, 30000);
        connected = true;
    });
    for (const model of Object.values(mongoose.models)) {
        t.mock.method(model, "init", async () => {
            assert.equal(connected, true);
            initialized.push(model.modelName);
        });
    }
    t.mock.method(User, "updateMany", async (filter, update) => {
        assert.equal(initialized.length, 12);
        assert.deepEqual(filter, { tokenVersion: { $exists: false } });
        assert.deepEqual(update, { $set: { tokenVersion: 0 } });
        return { modifiedCount: 0 };
    });
    t.mock.method(Submission, "updateMany", async (filter, update) => {
        assert.equal(initialized.length, 12);
        assert.deepEqual(filter, { queueVersion: { $exists: false } });
        assert.deepEqual(update, { $set: { queueVersion: 0 } });
        return { modifiedCount: 1 };
    });
    t.mock.method(require("../models/adminLock.model"), "updateOne", async () => ({ matchedCount: 1 }));
    await connectDB();
    assert.equal(Submission.updateMany.mock.callCount(), 1);
});

test("temporary MongoDB connection failure retries before initializing models", async t => {
    let calls = 0;
    const waits = [];
    t.mock.method(mongoose, "connect", async () => {
        if (++calls < 3) throw Object.assign(new Error("private connection details"), { name: "MongooseServerSelectionError" });
    });
    for (const model of Object.values(mongoose.models)) t.mock.method(model, "init", async () => assert.equal(calls, 3));
    t.mock.method(User, "updateMany", async () => ({}));
    t.mock.method(Submission, "updateMany", async () => ({}));
    t.mock.method(require("../models/adminLock.model"), "updateOne", async () => ({}));
    const logs = [];
    await connectDB({ wait: async ms => waits.push(ms), log: message => logs.push(message) });
    assert.equal(calls, 3);
    assert.deepEqual(waits, [2000, 4000]);
    assert.doesNotMatch(logs.join(" "), /private/);
});

test("MongoDB authentication failures are not retried", async t => {
    t.mock.method(mongoose, "connect", async () => { throw Object.assign(new Error("Authentication failed"), { code: 18 }); });
    await assert.rejects(connectDB({ wait: async () => assert.fail("Must not retry credentials") }), { code: 18 });
    assert.equal(mongoose.connect.mock.callCount(), 1);
});

test("persistent connection errors stop after three attempts", async t => {
    t.mock.method(mongoose, "connect", async () => { throw Object.assign(new Error("Network failure"), { code: "ECONNRESET" }); });
    await assert.rejects(connectDB({ wait: async () => {}, log() {} }), { code: "ECONNRESET" });
    assert.equal(mongoose.connect.mock.callCount(), 3);
});
