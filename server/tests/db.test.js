const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/user.model");
const Submission = require("../models/submission.model");

test("startup prepares model indexes and makes interrupted submissions retryable", async (t) => {
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
        assert.equal(initialized.length, 8);
        assert.deepEqual(filter, { tokenVersion: { $exists: false } });
        assert.deepEqual(update, { $set: { tokenVersion: 0 } });
        return { modifiedCount: 0 };
    });
    t.mock.method(Submission, "updateMany", async (filter, update) => {
        assert.equal(initialized.length, 8);
        assert.deepEqual(filter, { status: "running" });
        assert.equal(update.$set.status, "internal_error");
        assert.ok(update.$set.judgedAt instanceof Date);
        return { modifiedCount: 1 };
    });
    await connectDB();
    assert.equal(Submission.updateMany.mock.callCount(), 1);
});
