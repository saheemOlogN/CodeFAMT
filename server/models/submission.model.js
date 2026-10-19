const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        problem: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Problem",
            required: true,
        },
        contest: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Contest",
            default: null,
        },
        language: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        code: {
            type: String,
            required: true,
            select: false,
        },
        status: {
            type: String,
            enum: [
                "queued",
                "running",
                "accepted",
                "wrong_answer",
                "time_limit_exceeded",
                "memory_limit_exceeded",
                "runtime_error",
                "compilation_error",
                "internal_error",
            ],
            default: "queued",
            required: true,
        },
        passedTests: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isInteger,
        },
        totalTests: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isInteger,
        },
        executionTimeMs: {
            type: Number,
            default: null,
            min: 0,
        },
        memoryUsedMb: {
            type: Number,
            default: null,
            min: 0,
        },
        errorMessage: {
            type: String,
            default: "",
            select: false,
        },
        judgedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

submissionSchema.index({ user: 1, createdAt: -1 });
submissionSchema.index({ contest: 1, status: 1, createdAt: 1 });
submissionSchema.index({ contest: 1, user: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model("Submission", submissionSchema);
