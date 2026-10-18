const mongoose = require("mongoose");

const contestParticipantSchema = new mongoose.Schema(
    {
        contest: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Contest",
            required: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);

contestParticipantSchema.index({ contest: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("ContestParticipant", contestParticipantSchema);
