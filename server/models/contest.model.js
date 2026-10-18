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
                        validate: Number.isInteger,
                    },
                },
            ],
            default: [],
            validate: {
                validator: function (problems) {
                    const ids = problems.map((entry) => String(entry.problem));
                    return new Set(ids).size === ids.length;
                },
                message: "A problem can only appear once in a contest",
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

module.exports = mongoose.model("Contest", contestSchema);
