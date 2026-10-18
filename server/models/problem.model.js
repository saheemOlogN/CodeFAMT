const mongoose = require("mongoose");

const problemSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        },
        statement: {
            type: String,
            required: true,
        },
        difficulty: {
            type: String,
            enum: ["easy", "medium", "hard"],
            required: true,
        },
        tags: [{ type: String, trim: true, lowercase: true }],
        inputFormat: {
            type: String,
            required: true,
        },
        outputFormat: {
            type: String,
            required: true,
        },
        constraints: {
            type: String,
            required: true,
        },
        examples: [
            {
                _id: false,
                input: { type: String, default: "" },
                output: { type: String, default: "" },
                explanation: { type: String, default: "" },
            },
        ],
        timeLimitMs: {
            type: Number,
            required: true,
            min: 1,
            validate: Number.isInteger,
        },
        memoryLimitMb: {
            type: Number,
            required: true,
            min: 1,
            validate: Number.isInteger,
        },
        visibility: {
            type: String,
            enum: ["draft", "contest", "public"],
            default: "draft",
            required: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);

problemSchema.index({ visibility: 1, difficulty: 1 });

module.exports = mongoose.model("Problem", problemSchema);
