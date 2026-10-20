const mongoose = require("mongoose");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const Submission = require("../models/submission.model");
const CodeRun = require("../models/codeRun.model");
const { languages } = require("../utils/executeCode");
const executionQueue = require("../utils/executionQueue");

const submissionFields = "user problem contest language status passedTests totalTests executionTimeMs memoryUsedMb judgedAt createdAt updatedAt";

function submissionResponse(submission) {
    return {
        _id: submission._id,
        user: submission.user,
        problem: submission.problem,
        contest: submission.contest,
        language: submission.language,
        status: submission.status,
        passedTests: submission.passedTests,
        totalTests: submission.totalTests,
        executionTimeMs: submission.executionTimeMs,
        memoryUsedMb: submission.memoryUsedMb,
        judgedAt: submission.judgedAt,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt,
    };
}

async function runCode(req, res) {
    try {
        const body = req.body || {};
        const { language, code, input = "" } = body;

        if (Array.isArray(body) || Object.keys(body).some((key) => !["language", "code", "input"].includes(key)) ||
            typeof language !== "string" || !Object.hasOwn(languages, language) ||
            typeof code !== "string" || !code.trim() || code.includes("\0") || Buffer.byteLength(code, "utf8") > 50000 ||
            typeof input !== "string" || input.includes("\0") || Buffer.byteLength(input, "utf8") > 100000) {
            return res.status(400).json({ message: "Send a supported language, code up to 50000 bytes and input up to 100000 bytes" });
        }

        if (!process.env.ONLINECOMPILER_API_KEY) {
            return res.status(503).json({ message: "Code execution is not configured yet" });
        }

        const run = await CodeRun.create({
            user: req.user._id,
            language,
            code,
            input,
            status: "queued",
        });

        try {
            await executionQueue.enqueueRun(run);
        } catch {
            console.error("Code run saved and waiting for queue recovery");
        }

        return res.status(202).json({ run: { _id: run._id, status: run.status, language: run.language, createdAt: run.createdAt } });
    } catch {
        return res.status(500).json({ message: "Could not save code run" });
    }
}

async function getRun(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid code run ID" });
        }

        const filter = { _id: req.params.id, expiresAt: { $gt: new Date() } };

        if (req.user.role !== "admin") filter.user = req.user._id;

        const run = await CodeRun.findOne(filter).select("user language status createdAt updatedAt +result +errorMessage");

        if (!run) {
            return res.status(404).json({ message: "Code run not found" });
        }

        return res.status(200).json({ run });
    } catch {
        return res.status(500).json({ message: "Could not load code run" });
    }
}

async function submitCode(req, res) {
    try {
        const body = req.body || {};
        const { problemId, contestId, language, code } = body;

        if (Array.isArray(body) || Object.keys(body).some((key) => !["problemId", "contestId", "language", "code"].includes(key)) ||
            !mongoose.isObjectIdOrHexString(problemId) ||
            (contestId !== undefined && !mongoose.isObjectIdOrHexString(contestId)) ||
            typeof language !== "string" || !Object.hasOwn(languages, language) ||
            typeof code !== "string" || !code.trim() || code.includes("\0") || Buffer.byteLength(code, "utf8") > 50000) {
            return res.status(400).json({ message: "Send a problem ID, optional contest ID, supported language and code up to 50000 bytes" });
        }

        if (!process.env.ONLINECOMPILER_API_KEY) {
            return res.status(503).json({ message: "Code execution is not configured yet" });
        }

        const receivedAt = req.receivedAt;

        if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
            return res.status(500).json({ message: "Submission receipt time is unavailable" });
        }

        const problem = await Problem.findById(problemId);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        let contest = null;

        if (contestId !== undefined) {
            contest = await Contest.findById(contestId);

            if (!contest || contest.status !== "published") {
                return res.status(404).json({ message: "Contest not found" });
            }

            if (receivedAt < contest.startTime || receivedAt >= contest.endTime) {
                return res.status(409).json({ message: "Contest submissions are only accepted during the contest" });
            }

            if (!contest.problems.some((entry) => String(entry.problem) === String(problem._id))) {
                return res.status(404).json({ message: "Problem not found in this contest" });
            }

            if (!await ContestParticipant.exists({ contest: contest._id, user: req.user._id, createdAt: { $lte: receivedAt } })) {
                return res.status(403).json({ message: "Join this contest before submitting" });
            }
        } else if (problem.visibility !== "public") {
            return res.status(404).json({ message: "Problem not found" });
        }

        const testCases = await TestCase.find({ problem: problem._id })
            .select("+input +expectedOutput")
            .sort({ _id: 1 })
            .limit(101)
            .lean();

        if (!testCases.length || testCases.length > 100 || testCases.some((testCase) =>
            typeof testCase.input !== "string" || testCase.input.includes("\0") || Buffer.byteLength(testCase.input, "utf8") > 100000 || typeof testCase.expectedOutput !== "string" || testCase.expectedOutput.includes("\0") || Buffer.byteLength(testCase.expectedOutput, "utf8") > 65536)) {
            return res.status(503).json({ message: "This problem is not ready for judging" });
        }

        const submission = await Submission.create({
            user: req.user._id,
            problem: problem._id,
            contest: contest?._id || null,
            language,
            code,
            status: "queued",
            queueVersion: 0,
            totalTests: testCases.length,
            createdAt: receivedAt,
        });
        try {
            await executionQueue.enqueueSubmission(submission);
        } catch {
            console.error("Submission saved and waiting for queue recovery");
        }

        return res.status(202).json({ submission: submissionResponse(submission) });
    } catch {
        return res.status(500).json({ message: "Could not submit code" });
    }
}

async function getSubmissions(req, res) {
    try {
        const { page = "1", limit = "20", problemId, contestId } = req.query;

        if (Object.keys(req.query).some((key) => !["page", "limit", "problemId", "contestId"].includes(key)) ||
            typeof page !== "string" || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) ||
            typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100 ||
            (problemId !== undefined && !mongoose.isObjectIdOrHexString(problemId)) ||
            (contestId !== undefined && !mongoose.isObjectIdOrHexString(contestId))) {
            return res.status(400).json({ message: "Invalid submission filters or pagination" });
        }

        const skip = (Number(page) - 1) * Number(limit);

        if (!Number.isSafeInteger(skip)) {
            return res.status(400).json({ message: "Invalid page" });
        }

        const filter = { user: req.user._id };

        if (problemId !== undefined) filter.problem = problemId;
        if (contestId !== undefined) filter.contest = contestId;

        const submissions = await Submission.find(filter)
            .select(submissionFields)
            .sort({ createdAt: -1, _id: -1 })
            .skip(skip)
            .limit(Number(limit));
        const total = await Submission.countDocuments(filter);

        return res.status(200).json({ submissions, total, page: Number(page), limit: Number(limit) });
    } catch {
        return res.status(500).json({ message: "Could not load submissions" });
    }
}

async function getSubmission(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid submission ID" });
        }

        const filter = { _id: req.params.id };

        if (req.user.role !== "admin") filter.user = req.user._id;

        const submission = await Submission.findOne(filter).select(`${submissionFields} +code +errorMessage`);

        if (!submission) {
            return res.status(404).json({ message: "Submission not found" });
        }

        return res.status(200).json({ submission });
    } catch {
        return res.status(500).json({ message: "Could not load submission" });
    }
}

async function retrySubmission(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id) || Array.isArray(req.body) || Object.keys(req.body || {}).length) {
            return res.status(400).json({ message: "Use a valid submission ID and an empty request body" });
        }

        if (!process.env.ONLINECOMPILER_API_KEY) {
            return res.status(503).json({ message: "Code execution is not configured yet" });
        }

        const filter = { _id: req.params.id };

        if (req.user.role !== "admin") filter.user = req.user._id;

        const submission = await Submission.findOne(filter).select("+code");

        if (!submission) {
            return res.status(404).json({ message: "Submission not found" });
        }

        if (submission.status !== "internal_error") {
            return res.status(409).json({ message: "Only submissions with an internal error can be retried" });
        }

        const problem = await Problem.findById(submission.problem);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        if (submission.contest) {
            const contest = await Contest.findById(submission.contest);

            if (!contest || contest.status !== "published" || submission.createdAt < contest.startTime || submission.createdAt >= contest.endTime ||
                !contest.problems.some((entry) => String(entry.problem) === String(submission.problem))) {
                return res.status(409).json({ message: "The original submission is not eligible for this contest" });
            }

            if (!await ContestParticipant.exists({ contest: submission.contest, user: submission.user, createdAt: { $lte: submission.createdAt } })) {
                return res.status(403).json({ message: "The original submission has no eligible contest registration" });
            }
        } else if (problem.visibility !== "public") {
            return res.status(404).json({ message: "Problem not found" });
        }

        const testCases = await TestCase.find({ problem: problem._id })
            .select("+input +expectedOutput")
            .sort({ _id: 1 })
            .limit(101)
            .lean();

        if (!testCases.length || testCases.length > 100 || testCases.some((testCase) =>
            typeof testCase.input !== "string" || testCase.input.includes("\0") || Buffer.byteLength(testCase.input, "utf8") > 100000 || typeof testCase.expectedOutput !== "string" || testCase.expectedOutput.includes("\0") || Buffer.byteLength(testCase.expectedOutput, "utf8") > 65536)) {
            return res.status(503).json({ message: "This problem is not ready for judging" });
        }

        const claimed = await Submission.findOneAndUpdate(
            { _id: submission._id, status: "internal_error", queueVersion: submission.queueVersion },
            {
                $set: {
                    status: "queued",
                    totalTests: testCases.length,
                    errorMessage: "",
                    processingToken: null,
                    judgedAt: null,
                },
                $inc: { queueVersion: 1 },
            },
            { returnDocument: "after", runValidators: true }
        ).select("+code");

        if (!claimed) {
            return res.status(409).json({ message: "Submission is already being retried or has been judged" });
        }

        try {
            await executionQueue.enqueueSubmission(claimed);
        } catch {
            console.error("Submission saved and waiting for queue recovery");
        }

        return res.status(202).json({ submission: submissionResponse(claimed) });
    } catch {
        return res.status(500).json({ message: "Could not retry submission" });
    }
}

module.exports = { runCode, getRun, submitCode, getSubmissions, getSubmission, retrySubmission };
