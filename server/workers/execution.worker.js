const { randomUUID } = require("node:crypto");
const { Worker, DelayedError, UnrecoverableError } = require("bullmq");
const Submission = require("../models/submission.model");
const CodeRun = require("../models/codeRun.model");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const queue = require("../utils/executionQueue");
const execution = require("../utils/executeCode");
const providerLimit = require("../utils/providerLimit");
const realtime = require("../utils/realtime");
const gradeSubmission = require("../utils/gradeSubmission");
const { createRedisConnection } = require("../config/redis");

async function processExecution(job, token) {
    if (!["submission", "run"].includes(job.name)) throw new UnrecoverableError("Unknown execution type");
    const Model = job.name === "submission" ? Submission : CodeRun;
    const publish = job.name === "submission" ? realtime.publishSubmission : realtime.publishRun;
    const claim = randomUUID();
    const record = await Model.findOneAndUpdate(
        { _id: job.data.id, queueVersion: job.data.version, status: { $in: ["queued", "running"] } },
        { $set: { status: "running", processingToken: claim } },
        { returnDocument: "after" }
    ).select("+code +input +judgeProgress +processingToken");
    if (!record) return;
    const filter = { _id: record._id, queueVersion: job.data.version, processingToken: claim, status: "running" };
    await publish(record);
    try {
        if (job.name === "submission") {
            const problem = await Problem.findById(record.problem);
            const tests = await TestCase.find({ problem: record.problem }).select("+input +expectedOutput").sort({ _id: 1 }).limit(101);
            const progress = record.judgeProgress;
            if (!problem || !tests.length || tests.length > 100 || tests.length !== record.totalTests ||
                tests.some(item => typeof item.input !== "string" || item.input.includes("\0") ||
                    Buffer.byteLength(item.input, "utf8") > 100000 || typeof item.expectedOutput !== "string" ||
                    item.expectedOutput.includes("\0") || Buffer.byteLength(item.expectedOutput, "utf8") > 65536) ||
                (progress && (!Number.isInteger(progress.nextTest) || progress.nextTest < 0 ||
                    progress.nextTest > tests.length || progress.passedTests !== progress.nextTest ||
                    !Number.isFinite(progress.executionTimeMs) || progress.executionTimeMs < 0 ||
                    !Number.isFinite(progress.memoryUsedMb) || progress.memoryUsedMb < 0))) {
                throw new UnrecoverableError("Submission test data is invalid");
            }
            await gradeSubmission(record, problem, tests);
        } else {
            await providerLimit.reserveProviderRun();
            const results = await execution.executeCode({ language: record.language, code: record.code, inputs: [record.input] });
            const saved = await Model.findOneAndUpdate(filter, {
                $set: { status: "completed", result: results[0], processingToken: null },
            }, { returnDocument: "after" });
            await publish(saved);
        }
    } catch (error) {
        if (error.stale) return;
        const final = !error.delayMs && (error.permanent || error instanceof UnrecoverableError ||
            job.attemptsMade + 1 >= (job.opts.attempts || 1));
        const saved = await Model.findOneAndUpdate(filter, {
            $set: { status: final ? "internal_error" : "queued", processingToken: null,
                errorMessage: final ? "Code execution is unavailable. Try again later" : "" },
        }, { returnDocument: "after" });
        await publish(saved);
        if (error.delayMs) {
            await job.moveToDelayed(Date.now() + error.delayMs, token);
            throw new DelayedError();
        }
        if (error.permanent) throw new UnrecoverableError("Compiler configuration rejected");
        throw error;
    }
}

async function recoverPendingJobs() {
    for (const [name, Model, enqueue, publish] of [
        ["submission", Submission, queue.enqueueSubmission, realtime.publishSubmission],
        ["run", CodeRun, queue.enqueueRun, realtime.publishRun],
    ]) {
        let cursor;
        while (true) {
            const filter = { status: { $in: ["queued", "running"] } };
            if (cursor) filter._id = { $gt: cursor };
            const records = await Model.find(filter).sort({ _id: 1 }).limit(200);
            for (const record of records) {
                const job = await queue.getQueue().getJob(`${name}-${record._id}-${record.queueVersion || 0}`);
                if (!job) {
                    await enqueue(record);
                } else if (["failed", "completed"].includes(await job.getState())) {
                    const saved = await Model.findOneAndUpdate(
                        { _id: record._id, queueVersion: record.queueVersion, status: { $in: ["queued", "running"] } },
                        { $set: { status: "internal_error", processingToken: null, errorMessage: "Execution interrupted. Try again later" } },
                        { returnDocument: "after" }
                    );
                    await publish(saved);
                }
            }
            if (records.length < 200) break;
            cursor = records[records.length - 1]._id;
        }
    }
}

function createWorker() {
    const connection = createRedisConnection({ maxRetriesPerRequest: null });
    const worker = new Worker("executions", processExecution, {
        connection,
        prefix: process.env.REDIS_PREFIX || "codefamt",
        concurrency: Number(process.env.JUDGE_CONCURRENCY || 2),
        maxStalledCount: 2,
        settings: { backoffStrategy: (attempts, type, error) => error.retryAfterMs || Math.min(60000, 5000 * 2 ** (attempts - 1)) },
    });
    worker.on("error", () => console.error("Execution worker connection failed"));
    worker.on("closed", () => connection.disconnect());
    return worker;
}

module.exports = { processExecution, recoverPendingJobs, createWorker };
