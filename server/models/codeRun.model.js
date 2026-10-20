const mongoose = require("mongoose");

const codeRunSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        language: {
            type: String,
            required: true,
        },
        code: {
            type: String,
            required: true,
            select: false,
        },
        input: {
            type: String,
            default: "",
            select: false,
        },
        status: {
            type: String,
            enum: ["queued", "running", "completed", "internal_error"],
            default: "queued",
            required: true,
        },
        result: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            select: false,
        },
        errorMessage: {
            type: String,
            default: "",
            select: false,
        },
        queueVersion: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isInteger,
        },
        processingToken: {
            type: String,
            default: null,
            select: false,
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
            expires: 0,
        },
    },
    { timestamps: true }
);

codeRunSchema.index({ user: 1, createdAt: -1 });
codeRunSchema.index({ status: 1, _id: 1 });

module.exports = mongoose.model("CodeRun", codeRunSchema);
