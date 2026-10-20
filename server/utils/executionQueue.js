const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");

let queue;
let connection;

function getQueue() {
    if (!queue) {
        connection = createRedisConnection();
        queue = new Queue("executions", {
            connection,
            prefix: process.env.REDIS_PREFIX || "codefamt",
            defaultJobOptions: {
                attempts: 5,
                backoff: { type: "compiler", delay: 5000 },
                removeOnComplete: { age: 86400, count: 10000 },
                removeOnFail: { age: 604800, count: 10000 },
            },
        });
        queue.on("error", () => {});
    }
    return queue;
}

async function initializeQueue() {
    const concurrency = Number(process.env.JUDGE_CONCURRENCY || 2);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
        throw new Error("JUDGE_CONCURRENCY must be between 1 and 16");
    }
    await getQueue().waitUntilReady();
    await getQueue().setGlobalConcurrency(concurrency);
}

async function enqueueSubmission(submission) {
    return getQueue().add("submission", { id: String(submission._id), version: submission.queueVersion || 0 }, {
        jobId: `submission-${submission._id}-${submission.queueVersion || 0}`,
    });
}

async function enqueueRun(run) {
    return getQueue().add("run", { id: String(run._id), version: run.queueVersion || 0 }, {
        jobId: `run-${run._id}-${run.queueVersion || 0}`,
    });
}

async function closeQueue() {
    if (queue) await queue.close();
    if (connection) connection.disconnect();
    queue = null;
    connection = null;
}

module.exports = { getQueue, initializeQueue, enqueueSubmission, enqueueRun, closeQueue };
