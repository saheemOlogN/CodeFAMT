const mongoose = require("mongoose");

const testCaseSchema = new mongoose.Schema(
    {
        problem: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Problem",
            required: true,
            index: true,
        },
        input: {
            type: String,
            default: "",
            select: false,
        },
        expectedOutput: {
            type: String,
            default: "",
            select: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("TestCase", testCaseSchema);
