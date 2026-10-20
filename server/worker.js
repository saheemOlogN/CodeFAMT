const mongoose = require("mongoose");
const connectDB = require("./config/db");
const queue = require("./utils/executionQueue");
const { closeRedis } = require("./config/redis");
const { closeRealtime } = require("./utils/realtime");
const { createWorker, recoverPendingJobs } = require("./workers/execution.worker");

async function start() {
    await connectDB();
    await queue.initializeQueue();
    await recoverPendingJobs();
    const worker = createWorker();
    let recovering = false;
    const timer = setInterval(async () => {
        if (recovering) return;
        recovering = true;
        try {
            await recoverPendingJobs();
        } catch {
            console.error("Pending execution recovery failed");
        } finally {
            recovering = false;
        }
    }, 15000);
    let stopping = false;
    async function stop() {
        if (stopping) return;
        stopping = true;
        clearInterval(timer);
        await worker.close();
        await queue.closeQueue();
        await closeRealtime();
        closeRedis();
        await mongoose.disconnect();
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log("CODEFAMT execution worker is running");
}

start().catch(() => {
    console.error("Could not start execution worker. Check MongoDB and Redis configuration");
    process.exit(1);
});
