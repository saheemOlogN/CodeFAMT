const { Emitter } = require("@socket.io/redis-emitter");
const mongoose = require("mongoose");

let socketServer;
let redis;
let connecting;

function setRealtimeServer(server) {
    socketServer = server;
}

async function sendRealtime(action) {
    let connection;
    try {
        if (socketServer) {
            action(socketServer);
            return true;
        }

        if (!redis) {
            redis = require("../config/redis").createRedisConnection();
            connecting = redis.status === "wait" ? redis.connect() : redis.ping();
        }

        connection = redis;
        await connecting;
        const pending = [];
        const emitter = new Emitter({
            publish(...args) {
                const result = connection.publish(...args);
                pending.push(result);
                return result;
            },
        }, { key: `${process.env.REDIS_PREFIX || "codefamt"}:socket.io` });
        action(emitter);
        await Promise.all(pending);
        return true;
    } catch {
        if (connection && redis === connection) {
            connection.disconnect();
            redis = null;
            connecting = null;
        }
        return false;
    }
}

async function publishSubmission(submission) {
    if (!submission || !mongoose.isObjectIdOrHexString(submission._id) || !mongoose.isObjectIdOrHexString(submission.user)) {
        return false;
    }

    const result = {};
    for (const field of ["_id", "problem", "contest", "language", "status", "passedTests", "totalTests", "executionTimeMs", "memoryUsedMb", "judgedAt", "createdAt", "updatedAt"]) {
        if (submission[field] !== undefined) result[field] = submission[field];
    }

    return sendRealtime(emitter => {
        emitter.to(`user:${submission.user}`).emit("submission:updated", { submission: result });
        if (submission.contest && submission.status === "accepted") {
            emitter.to(`contest:${submission.contest}`).emit("leaderboard:updated", { contestId: String(submission.contest) });
        }
    });
}

async function publishContest(contestId) {
    if (!mongoose.isObjectIdOrHexString(contestId)) return false;
    return sendRealtime(emitter => emitter.to(`contest:${contestId}`).emit("contest:updated", { contestId: String(contestId) }));
}

async function publishRun(run) {
    if (!run || !mongoose.isObjectIdOrHexString(run._id) || !mongoose.isObjectIdOrHexString(run.user)) return false;
    const result = {};
    for (const field of ["_id", "status", "language", "createdAt", "updatedAt"]) {
        if (run[field] !== undefined) result[field] = run[field];
    }
    return sendRealtime(emitter => emitter.to(`user:${run.user}`).emit("run:updated", { run: result }));
}

async function disconnectUser(userId) {
    if (!mongoose.isObjectIdOrHexString(userId)) return false;
    return sendRealtime(emitter => emitter.in(`user:${userId}`).disconnectSockets(true));
}

async function closeRealtime() {
    redis?.disconnect();
    redis = null;
    connecting = null;
    socketServer = null;
}

module.exports = { setRealtimeServer, publishSubmission, publishRun, publishContest, disconnectUser, closeRealtime };
