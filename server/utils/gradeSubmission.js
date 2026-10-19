const mongoose = require("mongoose");
const Submission = require("../models/submission.model");
const SolvedProblem = require("../models/solvedProblem.model");
const { executeCode } = require("./executeCode");
const judgeResults = require("./judgeResults");

async function gradeSubmission(submission, problem, testCases) {
    try {
        const results = await executeCode({
            language: submission.language,
            code: submission.code,
            inputs: testCases.map((testCase) => testCase.input),
        });
        const verdict = judgeResults(results, testCases, problem);

        if (verdict.status === "internal_error") {
            throw new Error("Execution results could not be judged");
        }

        const judgedAt = new Date();
        let saved;

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await mongoose.connection.transaction(async (session) => {
                    saved = await Submission.findOneAndUpdate(
                        { _id: submission._id, status: "running" },
                        { $set: { ...verdict, judgedAt } },
                        { new: true, runValidators: true, session }
                    ).select("user problem contest language status passedTests totalTests executionTimeMs memoryUsedMb judgedAt createdAt updatedAt +errorMessage");

                    if (!saved) {
                        const error = new Error("Submission changed. Reload its result");
                        error.status = 409;
                        throw error;
                    }

                    if (verdict.status === "accepted") {
                        await SolvedProblem.updateOne(
                            { user: submission.user, problem: submission.problem },
                            {
                                $setOnInsert: {
                                    user: submission.user,
                                    problem: submission.problem,
                                    submission: submission._id,
                                    solvedAt: judgedAt,
                                },
                            },
                            { upsert: true, runValidators: true, session }
                        );
                    }
                });
                break;
            } catch (error) {
                if (error.code === 11000 && attempt === 0) {
                    continue;
                }
                throw error;
            }
        }

        return saved;
    } catch (error) {
        if (error.status === 409) {
            throw error;
        }

        try {
            await Submission.updateOne(
                { _id: submission._id, status: "running" },
                {
                    $set: {
                        status: "internal_error",
                        passedTests: 0,
                        errorMessage: "Judging is unavailable. Retry this submission later",
                        judgedAt: new Date(),
                    },
                }
            );
        } catch {}

        const failure = new Error("Judging is unavailable. Retry this submission later");
        failure.status = 503;
        failure.submissionId = submission._id;
        throw failure;
    }
}

module.exports = gradeSubmission;
