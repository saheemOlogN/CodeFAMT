const mongoose = require("mongoose");

const passwordResetSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        otpHash: {
            type: String,
            required: true,
            select: false,
        },
        expiresAt: {
            type: Date,
            required: true,
            expires: 0,
        },
        attempts: {
            type: Number,
            default: 0,
            min: 0,
            validate: Number.isInteger,
        },
        lastSentAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("PasswordReset", passwordResetSchema);
