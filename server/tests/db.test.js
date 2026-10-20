const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/user.model");
const Submission = require("../models/submission.model");

test("startup prepares indexes and queue versions without resetting active jobs", async (t) => {
    let connected = false;
    const initialized = [];
    t.mock.method(mongoose, "connect", async () => { connected = true; });
    for (const model of Object.values(mongoose.models)) {
        t.mock.method(model, "init", async () => {
            assert.equal(connected, true);
            initialized.push(model.modelName);
        });
    }
    t.mock.method(User, "updateMany", async (filter, update) => {
        assert.equal(initialized.length, 11);
        assert.deepEqual(filter, { tokenVersion: { $exists: false } });
        assert.deepEqual(update, { $set: { tokenVersion: 0 } });
        return { modifiedCount: 0 };
    });
    t.mock.method(Submission, "updateMany", async (filter, update) => {
        assert.equal(initialized.length, 11);
        assert.deepEqual(filter, { queueVersion: { $exists: false } });
        assert.deepEqual(update, { $set: { queueVersion: 0 } });
        return { modifiedCount: 1 };
    });
    t.mock.method(require("../models/adminLock.model"), "updateOne", async () => ({ matchedCount: 1 }));
    await connectDB();
    assert.equal(Submission.updateMany.mock.callCount(), 1);
});
