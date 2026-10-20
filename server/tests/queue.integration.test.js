const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const CodeRun = require("../models/codeRun.model");
const Submission = require("../models/submission.model");
const queue = require("../utils/executionQueue");
const execution = require("../utils/executeCode");
const realtime = require("../utils/realtime");
const { closeRedis } = require("../config/redis");
const { createWorker, recoverPendingJobs } = require("../workers/execution.worker");

test("real MongoDB and Redis recover queued runs and share concurrency across two workers", {
    skip: process.env.RUN_QUEUE_INTEGRATION !== "1",
    timeout: 60000,
}, async t => {
    assert.ok(process.env.REDIS_URL, "Set REDIS_URL before running this integration test");
    assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI before running this integration test");
    const namespace = `codefamt_test_${randomUUID().replaceAll("-", "")}`;
    process.env.REDIS_PREFIX = namespace;
    process.env.JUDGE_CONCURRENCY = "2";
    process.env.COMPILER_RUNS_PER_MINUTE = "100";
    const workers = [];
    let active = 0;
    let maximum = 0;
    let executions = 0;
    t.mock.method(execution, "executeCode", async ({ inputs }) => {
        active++;
        maximum = Math.max(maximum, active);
        executions++;
        await new Promise(resolve => setTimeout(resolve, 50));
        active--;
        return [{ stdout: inputs[0], stderr: null, exception: null, exitCode: 0, executionTime: 1, memoryUsed: 100 }];
    });
    t.mock.method(realtime, "publishRun", async () => {});
    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: namespace, serverSelectionTimeoutMS: 10000 });
        await Promise.all([CodeRun.init(), Submission.init()]);
        await queue.initializeQueue();
        const runs = await CodeRun.create(Array.from({ length: 20 }, (_, index) => ({
            user: new mongoose.Types.ObjectId(), language: "python", code: "print(input())", input: String(index),
        })));
        await recoverPendingJobs();
        workers.push(createWorker(), createWorker());
        const deadline = Date.now() + 20000;
        while (await CodeRun.countDocuments({ status: "completed" }) < runs.length && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(await CodeRun.countDocuments({ status: "completed" }), 20);
        assert.equal(executions, 20);
        assert.equal(maximum, 2);
        const completed = await CodeRun.find().select("+result");
        assert.equal(new Set(completed.map(run => run.result.stdout)).size, 20);
    } finally {
        await Promise.all(workers.map(worker => worker.close()));
        if (mongoose.connection.name === namespace) await mongoose.connection.dropDatabase();
        if (queue.getQueue().opts.prefix === namespace) await queue.getQueue().obliterate({ force: true });
        await queue.closeQueue();
        closeRedis();
        await mongoose.disconnect();
    }
});
