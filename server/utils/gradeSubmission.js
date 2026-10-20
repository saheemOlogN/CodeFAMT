const mongoose = require("mongoose");
const Submission = require("../models/submission.model");
const SolvedProblem = require("../models/solvedProblem.model");
const execution = require("./executeCode");
const providerLimit = require("./providerLimit");
const realtime = require("./realtime");
const judgeResults = require("./judgeResults");

async function gradeSubmission(submission, problem, testCases) {
    const filter = {
        _id: submission._id,
        status: "running",
        queueVersion: submission.queueVersion,
        processingToken: submission.processingToken,
    };
    const progress = {
        nextTest: submission.judgeProgress?.nextTest || 0,
        passedTests: submission.judgeProgress?.passedTests || 0,
        executionTimeMs: submission.judgeProgress?.executionTimeMs || 0,
        memoryUsedMb: submission.judgeProgress?.memoryUsedMb || 0,
    };
    let verdict = { status: "accepted", errorMessage: "" };

    for (let index = progress.nextTest; index < testCases.length; index++) {
        await providerLimit.reserveProviderRun();
        const results = await execution.executeCode({
            language: submission.language,
            code: submission.code,
            inputs: [testCases[index].input],
        });
        verdict = judgeResults(results, [testCases[index]], problem);
        if (verdict.status === "internal_error") throw new Error("Invalid compiler result");
        progress.executionTimeMs = Math.max(progress.executionTimeMs, verdict.executionTimeMs || 0);
        progress.memoryUsedMb = Math.max(progress.memoryUsedMb, verdict.memoryUsedMb || 0);
        if (verdict.status !== "accepted") break;

        progress.nextTest = index + 1;
        progress.passedTests++;
        const updated = await Submission.updateOne(filter, {
            $set: {
                judgeProgress: progress,
                passedTests: progress.passedTests,
                executionTimeMs: progress.executionTimeMs,
                memoryUsedMb: progress.memoryUsedMb,
            },
        });
        if (updated.matchedCount !== 1) {
            const error = new Error("Submission claim changed");
            error.stale = true;
            throw error;
        }
        await realtime.publishSubmission({ ...submission.toObject(), passedTests: progress.passedTests });
    }

    const result = {
        status: verdict.status,
        errorMessage: verdict.errorMessage,
        passedTests: progress.passedTests,
        totalTests: testCases.length,
        executionTimeMs: progress.executionTimeMs,
        memoryUsedMb: progress.memoryUsedMb,
        judgedAt: new Date(),
        processingToken: null,
    };
    let saved;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await mongoose.connection.transaction(async session => {
                saved = await Submission.findOneAndUpdate(filter, { $set: result }, { returnDocument: "after", runValidators: true, session });
                if (!saved) {
                    const error = new Error("Submission claim changed");
                    error.stale = true;
                    throw error;
                }
                if (result.status === "accepted") {
                    await SolvedProblem.updateOne(
                        { user: submission.user, problem: submission.problem },
                        { $setOnInsert: { user: submission.user, problem: submission.problem,
                            submission: submission._id, solvedAt: result.judgedAt } },
                        { upsert: true, runValidators: true, session }
                    );
                }
            });
            break;
        } catch (error) {
            if (error.code === 11000 && attempt === 0) continue;
            throw error;
        }
    }
    await realtime.publishSubmission(saved);
    return saved;
}

module.exports = gradeSubmission;
