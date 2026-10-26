const { validateEnvironment } = require('./config/environment');
const { readiness, startHeartbeat } = require('./utils/health');
const http = require('node:http');
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const queue = require("./utils/executionQueue");
const { closeRedis } = require("./config/redis");
const { closeRealtime } = require("./utils/realtime");
const { createWorker, recoverPendingJobs } = require("./workers/execution.worker");

async function start() {
    validateEnvironment();
    await connectDB();
    await queue.initializeQueue();
    await recoverPendingJobs();
    const worker = createWorker();
    await worker.waitUntilReady();
    const stopHeartbeat = await startHeartbeat(worker);
    const health = http.createServer(async (req, res) => {
        const ready = !stopping && worker.isRunning() && await readiness(false);
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: ready ? 'ready' : 'unavailable' }));
    });
    health.listen(Number(process.env.WORKER_HEALTH_PORT || 6768));
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
        const deadline = setTimeout(() => process.exit(1), 30000);
        deadline.unref();
        health.close();
        await stopHeartbeat();
        clearInterval(timer);
        await worker.close();
        await queue.closeQueue();
        await closeRealtime();
        await closeRedis();
        await mongoose.disconnect();
        clearTimeout(deadline);
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log("CodeFAMT execution worker is running");
}

start().catch(() => {
    console.error("Could not start execution worker. Check MongoDB and Redis configuration");
    process.exit(1);
});
