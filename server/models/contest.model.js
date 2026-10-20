const mongoose = require("mongoose");

const contestSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: "",
        },
        startTime: {
            type: Date,
            required: true,
        },
        endTime: {
            type: Date,
            required: true,
            validate: {
                validator: function (endTime) {
                    return endTime > this.startTime;
                },
                message: "Contest must end after it starts",
            },
        },
        problems: {
            type: [
                {
                    _id: false,
                    problem: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: "Problem",
                        required: true,
                    },
                    points: {
                        type: Number,
                        default: 100,
                        required: true,
                        min: 1,
                        validate: Number.isSafeInteger,
                    },
                },
            ],
            default: [],
            validate: {
                validator: function (problems) {
                    const ids = problems.map((entry) => String(entry.problem));
                    const totalPoints = problems.reduce((total, entry) => total + entry.points, 0);
                    return problems.length <= 20 && new Set(ids).size === ids.length &&
                        Number.isSafeInteger(totalPoints);
                },
                message: "Use up to 20 unique problems with a safe integer total score",
            },
        },
        status: {
            type: String,
            enum: ["draft", "published", "cancelled"],
            default: "draft",
            required: true,
            validate: {
                validator: function (status) {
                    return status !== "published" || this.problems.length > 0;
                },
                message: "Add at least one problem before publishing a contest",
            },
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    { timestamps: true }
);

contestSchema.index({ status: 1, startTime: 1 });
contestSchema.index({ "problems.problem": 1, status: 1 });

module.exports = mongoose.model("Contest", contestSchema);
