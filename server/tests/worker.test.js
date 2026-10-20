const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { DelayedError, UnrecoverableError } = require("bullmq");
const Submission = require("../models/submission.model");
const CodeRun = require("../models/codeRun.model");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const SolvedProblem = require("../models/solvedProblem.model");
const execution = require("../utils/executeCode");
const limiter = require("../utils/providerLimit");
const realtime = require("../utils/realtime");
const queue = require("../utils/executionQueue");
const { processExecution, recoverPendingJobs } = require("../workers/execution.worker");

function query(value) {
    return { select() { return this; }, sort() { return this; }, limit() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

function setup(t, name = "submission") {
    const record = { _id: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId(),
        problem: new mongoose.Types.ObjectId(), status: "queued", queueVersion: 0,
        language: "python", code: "print(input())", input: "custom", totalTests: 2,
        toObject() { return { ...this }; } };
    const state = { record, calls: 0, solves: 0, events: [] };
    const Model = name === "submission" ? Submission : CodeRun;
    t.mock.method(Model, "findOneAndUpdate", (filter, update) => {
        const matches = filter.status?.$in ? filter.status.$in.includes(record.status) : filter.status === record.status;
        if (!matches || filter.queueVersion !== record.queueVersion ||
            (filter.processingToken && filter.processingToken !== record.processingToken)) return query(null);
        Object.assign(record, update.$set);
        return query(record);
    });
    t.mock.method(Model, "updateOne", async (filter, update) => {
        if (filter.processingToken !== record.processingToken || filter.status !== record.status) return { matchedCount: 0 };
        Object.assign(record, update.$set);
        return { matchedCount: 1 };
    });
    t.mock.method(Problem, "findById", async () => ({ timeLimitMs: 1000, memoryLimitMb: 128 }));
    t.mock.method(TestCase, "find", () => query([{ input: "one", expectedOutput: "one" }, { input: "two", expectedOutput: "two" }]));
    t.mock.method(limiter, "reserveProviderRun", async () => {});
    t.mock.method(execution, "executeCode", async ({ inputs }) => {
        state.calls++;
        return [{ stdout: inputs[0], stderr: null, exception: null, exitCode: 0, executionTime: 10, memoryUsed: 1024 }];
    });
    t.mock.method(realtime, "publishSubmission", async value => { if (value) state.events.push(value.status); });
    t.mock.method(realtime, "publishRun", async value => { if (value) state.events.push(value.status); });
    t.mock.method(mongoose.connection, "transaction", async callback => {
        const previous = { ...record };
        try { await callback({}); } catch (error) { Object.assign(record, previous); throw error; }
    });
    t.mock.method(SolvedProblem, "updateOne", async () => { state.solves++; });
    state.job = { name, data: { id: String(record._id), version: 0 }, attemptsMade: 0, opts: { attempts: 5 } };
    return state;
}

test("worker judges queued tests and saves the accepted verdict with the solve", async t => {
    const state = setup(t);
    await processExecution(state.job, "lock");
    assert.equal(state.record.status, "accepted");
    assert.equal(state.calls, 2);
    assert.equal(state.solves, 1);
    await processExecution(state.job, "lock");
    assert.equal(state.calls, 2);
});

test("provider failure resumes after the last saved test", async t => {
    const state = setup(t);
    let calls = 0;
    t.mock.method(execution, "executeCode", async ({ inputs }) => {
        calls++;
        if (calls === 2) throw new Error("Temporary failure");
        return [{ stdout: inputs[0], stderr: null, exception: null, exitCode: 0, executionTime: 10, memoryUsed: 1024 }];
    });
    await assert.rejects(processExecution(state.job, "lock"), /Temporary failure/);
    assert.equal(state.record.status, "queued");
    assert.equal(state.record.judgeProgress.nextTest, 1);
    state.job.attemptsMade = 1;
    await processExecution(state.job, "lock");
    assert.equal(calls, 3);
    assert.equal(state.record.status, "accepted");
    assert.equal(state.record.passedTests, 2);
});

test("provider budget delays a job without discarding progress", async t => {
    const state = setup(t);
    t.mock.method(limiter, "reserveProviderRun", async () => { throw Object.assign(new Error("Budget"), { delayMs: 1000 }); });
    state.job.moveToDelayed = async (time, token) => {
        assert.ok(time > Date.now());
        assert.equal(token, "lock");
    };
    await assert.rejects(processExecution(state.job, "lock"), DelayedError);
    assert.equal(state.record.status, "queued");
    assert.equal(state.calls, 0);
});

test("permanent provider errors stop retries and hide diagnostics", async t => {
    const state = setup(t, "run");
    t.mock.method(execution, "executeCode", async () => { throw Object.assign(new Error("private credentials"), { permanent: true }); });
    await assert.rejects(processExecution(state.job, "lock"), UnrecoverableError);
    assert.equal(state.record.status, "internal_error");
    assert.equal(state.record.errorMessage.includes("credentials"), false);
});

test("custom runs save results for the authenticated retrieval route", async t => {
    const state = setup(t, "run");
    await processExecution(state.job, "lock");
    assert.equal(state.record.status, "completed");
    assert.equal(state.record.result.stdout, "custom");
});

test("failed solve persistence rolls back acceptance and keeps test progress", async t => {
    const state = setup(t);
    t.mock.method(SolvedProblem, "updateOne", async () => { throw new Error("Database unavailable"); });
    await assert.rejects(processExecution(state.job, "lock"), /Database unavailable/);
    assert.equal(state.record.status, "queued");
    assert.equal(state.record.judgeProgress.nextTest, 2);
});

test("an old queue version cannot execute a manually retried submission", async t => {
    const state = setup(t);
    state.record.queueVersion = 1;
    await processExecution(state.job, "lock");
    assert.equal(state.calls, 0);
});

test("duplicate first solves retry only persistence, not execution", async t => {
    const state = setup(t);
    let attempts = 0;
    t.mock.method(SolvedProblem, "updateOne", async () => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error("Duplicate solve"), { code: 11000 });
    });
    await processExecution(state.job, "lock");
    assert.equal(state.record.status, "accepted");
    assert.equal(state.calls, 2);
    assert.equal(attempts, 2);
});

test("an ambiguous commit response cannot overwrite an accepted verdict", async t => {
    const state = setup(t);
    t.mock.method(mongoose.connection, "transaction", async callback => {
        await callback({});
        throw new Error("Commit response lost");
    });
    await assert.rejects(processExecution(state.job, "lock"), /Commit response lost/);
    assert.equal(state.record.status, "accepted");
    await processExecution(state.job, "lock");
    assert.equal(state.calls, 2);
});

test("a worker that loses its claim cannot save progress or a verdict", async t => {
    const state = setup(t);
    t.mock.method(execution, "executeCode", async () => {
        state.record.processingToken = "new-worker";
        return [{ stdout: "one", stderr: null, exception: null, exitCode: 0, executionTime: 10, memoryUsed: 1024 }];
    });
    await processExecution(state.job, "lock");
    assert.equal(state.record.processingToken, "new-worker");
    assert.equal(state.record.status, "running");
    assert.equal(state.solves, 0);
});

test("an exhausted retry becomes a retriable internal error", async t => {
    const state = setup(t);
    state.job.attemptsMade = 4;
    t.mock.method(execution, "executeCode", async () => { throw new Error("Unavailable"); });
    await assert.rejects(processExecution(state.job, "lock"));
    assert.equal(state.record.status, "internal_error");
});

test("recovery recreates missing queue jobs using the saved version", async t => {
    const state = setup(t);
    t.mock.method(Submission, "find", () => query([state.record]));
    t.mock.method(CodeRun, "find", () => query([]));
    t.mock.method(queue, "getQueue", () => ({ getJob: async () => undefined }));
    let recovered;
    t.mock.method(queue, "enqueueSubmission", async record => { recovered = record; });
    await recoverPendingJobs();
    assert.equal(recovered._id, state.record._id);
    assert.equal(recovered.queueVersion, 0);
});
