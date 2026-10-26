const mongoose = require("mongoose");
const { setTimeout: delay } = require("node:timers/promises");
const User = require("../models/user.model");
const Submission = require("../models/submission.model");
const AdminLock = require("../models/adminLock.model");
mongoose.set("transactionAsyncLocalStorage", true);
const models = [
    User,
    require("../models/otp.model"),
    require("../models/problem.model"),
    require("../models/testCase.model"),
    require("../models/contest.model"),
    require("../models/contestParticipant.model"),
    Submission,
    require("../models/solvedProblem.model"),
    require("../models/codeRun.model"),
    require("../models/passwordReset.model"),
    AdminLock,
    require("../models/roadmap.model"),
];

async function connectDB({ wait = delay, log = console.log } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
            break;
        } catch (error) {
            const temporary = error.code !== 18 && (
                ["MongooseServerSelectionError", "MongoServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError"].includes(error.name) ||
                ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENODATA"].includes(error.code)
            );
            if (!temporary || attempt >= 3) throw error;
            log(`[startup] MongoDB connection interrupted; retrying (${attempt + 1}/3)...`);
            await wait(attempt * 2000);
        }
    }
    if (process.env.NODE_ENV === 'production') {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('MongoDB must support transactions (replica set or sharded cluster)');
    }
    log("[startup] MongoDB connected; preparing indexes and required records...");
    await Promise.all(models.map((model) => model.init()));
    await Promise.all([
        User.updateMany({ tokenVersion: { $exists: false } }, { $set: { tokenVersion: 0 } }),
        Submission.updateMany({ queueVersion: { $exists: false } }, { $set: { queueVersion: 0 } }),
        AdminLock.updateOne({ _id: "admin" }, { $setOnInsert: { version: 0 } }, { upsert: true }),
    ]);
}

module.exports = connectDB;
