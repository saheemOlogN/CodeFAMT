const mongoose = require("mongoose");
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
];

async function connectDB() {
    await mongoose.connect(process.env.MONGODB_URI);
    await Promise.all(models.map((model) => model.init()));
    await User.updateMany({ tokenVersion: { $exists: false } }, { $set: { tokenVersion: 0 } });
    await Submission.updateMany({ queueVersion: { $exists: false } }, { $set: { queueVersion: 0 } });
    await AdminLock.updateOne({ _id: "admin" }, { $setOnInsert: { version: 0 } }, { upsert: true });
}

module.exports = connectDB;
