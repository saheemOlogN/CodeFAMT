const mongoose = require("mongoose");
const User = require("../models/user.model");
const Submission = require("../models/submission.model");
const models = [
    User,
    require("../models/otp.model"),
    require("../models/problem.model"),
    require("../models/testCase.model"),
    require("../models/contest.model"),
    require("../models/contestParticipant.model"),
    Submission,
    require("../models/solvedProblem.model"),
];

async function connectDB() {
    await mongoose.connect(process.env.MONGODB_URI);
    await Promise.all(models.map((model) => model.init()));
    await User.updateMany({ tokenVersion: { $exists: false } }, { $set: { tokenVersion: 0 } });
    await Submission.updateMany(
        { status: "running" },
        { $set: { status: "internal_error", errorMessage: "Server restarted. Retry this submission", judgedAt: new Date() } }
    );
}

module.exports = connectDB;
