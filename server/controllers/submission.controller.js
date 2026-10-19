const mongoose = require("mongoose");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const Submission = require("../models/submission.model");
const { executeCode, languages } = require("../utils/executeCode");
const gradeSubmission = require("../utils/gradeSubmission");

const submissionFields = "user problem contest language status passedTests totalTests executionTimeMs memoryUsedMb judgedAt createdAt updatedAt";
let activeExecutions = 0;

async function runCode(req, res) {
    let acquired = false;

    try {
        const body = req.body || {};
        const { language, code, input = "" } = body;

        if (Array.isArray(body) || Object.keys(body).some((key) => !["language", "code", "input"].includes(key)) ||
            typeof language !== "string" || !Object.hasOwn(languages, language) ||
            typeof code !== "string" || !code.trim() || Buffer.byteLength(code, "utf8") > 50000 ||
            typeof input !== "string" || Buffer.byteLength(input, "utf8") > 100000) {
            return res.status(400).json({ message: "Send a supported language, code up to 50000 bytes and input up to 100000 bytes" });
        }

        if (!process.env.ONECOMPILER_API_KEY) {
            return res.status(503).json({ message: "Code execution is not configured yet" });
        }

        if (activeExecutions >= 4) {
            return res.status(429).json({ message: "Code execution is busy. Try again shortly" });
        }

        activeExecutions++;
        acquired = true;
        const results = await executeCode({ language, code, inputs: [input] });

        return res.status(200).json({ result: results[0] });
    } catch {
        return res.status(503).json({ message: "Code execution is unavailable. Try again later" });
    } finally {
        if (acquired) activeExecutions--;
    }
}

async function submitCode(req, res) {
    let acquired = false;

    try {
        const body = req.body || {};
        const { problemId, contestId, language, code } = body;

        if (Array.isArray(body) || Object.keys(body).some((key) => !["problemId", "contestId", "language", "code"].includes(key)) ||
            !mongoose.isObjectIdOrHexString(problemId) ||
            (contestId !== undefined && !mongoose.isObjectIdOrHexString(contestId)) ||
            typeof language !== "string" || !Object.hasOwn(languages, language) ||
            typeof code !== "string" || !code.trim() || Buffer.byteLength(code, "utf8") > 50000) {
            return res.status(400).json({ message: "Send a problem ID, optional contest ID, supported language and code up to 50000 bytes" });
        }

        if (!process.env.ONECOMPILER_API_KEY) {
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
            typeof testCase.input !== "string" || Buffer.byteLength(testCase.input, "utf8") > 100000 || typeof testCase.expectedOutput !== "string")) {
            return res.status(503).json({ message: "This problem is not ready for judging" });
        }

        if (activeExecutions >= 4) {
            return res.status(429).json({ message: "Code execution is busy. Try again shortly" });
        }

        activeExecutions++;
        acquired = true;
        const submission = await Submission.create({
            user: req.user._id,
            problem: problem._id,
            contest: contest?._id || null,
            language,
            code,
            status: "running",
            totalTests: testCases.length,
            createdAt: receivedAt,
        });
        const result = await gradeSubmission(submission, problem, testCases);

        return res.status(201).json({ submission: result });
    } catch (error) {
        if (error.status === 503) {
            return res.status(503).json({ message: "Judging is unavailable. Retry this submission later", submissionId: error.submissionId });
        }
        if (error.status === 409) {
            return res.status(409).json({ message: "Submission changed. Reload its result" });
        }
        return res.status(500).json({ message: "Could not submit code" });
    } finally {
        if (acquired) activeExecutions--;
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
    let acquired = false;

    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id) || Object.keys(req.body || {}).length) {
            return res.status(400).json({ message: "Use a valid submission ID and an empty request body" });
        }

        if (!process.env.ONECOMPILER_API_KEY) {
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
            typeof testCase.input !== "string" || Buffer.byteLength(testCase.input, "utf8") > 100000 || typeof testCase.expectedOutput !== "string")) {
            return res.status(503).json({ message: "This problem is not ready for judging" });
        }

        if (activeExecutions >= 4) {
            return res.status(429).json({ message: "Code execution is busy. Try again shortly" });
        }

        activeExecutions++;
        acquired = true;
        const claimed = await Submission.findOneAndUpdate(
            { _id: submission._id, status: "internal_error" },
            {
                $set: {
                    status: "running",
                    passedTests: 0,
                    totalTests: testCases.length,
                    executionTimeMs: null,
                    memoryUsedMb: null,
                    errorMessage: "",
                    judgedAt: null,
                },
            },
            { new: true, runValidators: true }
        ).select("+code");

        if (!claimed) {
            return res.status(409).json({ message: "Submission is already being retried or has been judged" });
        }

        const result = await gradeSubmission(claimed, problem, testCases);

        return res.status(200).json({ submission: result });
    } catch (error) {
        if (error.status === 503) {
            return res.status(503).json({ message: "Judging is unavailable. Retry this submission later", submissionId: error.submissionId });
        }
        if (error.status === 409) {
            return res.status(409).json({ message: "Submission changed. Reload its result" });
        }
        return res.status(500).json({ message: "Could not retry submission" });
    } finally {
        if (acquired) activeExecutions--;
    }
}

module.exports = { runCode, submitCode, getSubmissions, getSubmission, retrySubmission };
