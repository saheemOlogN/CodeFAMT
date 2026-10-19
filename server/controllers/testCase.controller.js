const mongoose = require("mongoose");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const Submission = require("../models/submission.model");

async function createTestCase(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        if (!mongoose.isObjectIdOrHexString(req.params.problemId)) {
            return res.status(400).json({ message: "Invalid problem ID" });
        }

        const { input, expectedOutput } = req.body || {};

        if (typeof input !== "string" || typeof expectedOutput !== "string" ||
            Buffer.byteLength(input) > 100000 || Buffer.byteLength(expectedOutput) > 100000 ||
            Object.keys(req.body).some((field) => !["input", "expectedOutput"].includes(field))) {
            return res.status(400).json({ message: "Input and expectedOutput must be strings of at most 100000 UTF-8 bytes each" });
        }

        const problem = await Problem.findById(req.params.problemId);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        if (problem.visibility !== "draft") {
            return res.status(409).json({ message: "Test cases of published problems cannot be changed" });
        }

        if (await Contest.exists({ "problems.problem": problem._id, status: { $ne: "draft" } }) ||
            await Submission.exists({ problem: problem._id })) {
            return res.status(409).json({ message: "Test cases used in published contests or submissions cannot be changed" });
        }

        if (await TestCase.countDocuments({ problem: problem._id }) >= 100) {
            return res.status(400).json({ message: "A problem can have at most 100 hidden test cases" });
        }

        const testCase = await TestCase.create({ problem: problem._id, input, expectedOutput });

        return res.status(201).json({ message: "Test case created", testCase });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ message: "Check the test case fields" });
        }
        return res.status(500).json({ message: "Could not create test case" });
    }
}

async function getTestCases(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        if (!mongoose.isObjectIdOrHexString(req.params.problemId)) {
            return res.status(400).json({ message: "Invalid problem ID" });
        }

        const { page = "1", limit = "20" } = req.query;

        if (Object.keys(req.query).some((key) => !["page", "limit"].includes(key)) ||
            typeof page !== "string" || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) ||
            typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100 ||
            !Number.isSafeInteger((Number(page) - 1) * Number(limit))) {
            return res.status(400).json({ message: "Invalid pagination" });
        }

        if (!(await Problem.exists({ _id: req.params.problemId }))) {
            return res.status(404).json({ message: "Problem not found" });
        }

        const filter = { problem: req.params.problemId };
        const testCases = await TestCase.find(filter)
            .select("+input +expectedOutput")
            .sort({ createdAt: 1, _id: 1 })
            .skip((Number(page) - 1) * Number(limit))
            .limit(Number(limit));
        const total = await TestCase.countDocuments(filter);

        return res.status(200).json({ testCases, page: Number(page), limit: Number(limit), total });
    } catch {
        return res.status(500).json({ message: "Could not get test cases" });
    }
}

async function updateTestCase(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        if (!mongoose.isObjectIdOrHexString(req.params.problemId) || !mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid problem or test case ID" });
        }

        const body = req.body || {};

        if (Array.isArray(body) || !Object.keys(body).length ||
            Object.keys(body).some((field) => !["input", "expectedOutput"].includes(field) ||
                typeof body[field] !== "string" || Buffer.byteLength(body[field]) > 100000)) {
            return res.status(400).json({ message: "Send input or expectedOutput as strings of at most 100000 UTF-8 bytes each" });
        }

        const problem = await Problem.findById(req.params.problemId);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        if (problem.visibility !== "draft") {
            return res.status(409).json({ message: "Test cases of published problems cannot be changed" });
        }

        const testCase = await TestCase.findOne({ _id: req.params.id, problem: req.params.problemId }).select("+input +expectedOutput");

        if (!testCase) {
            return res.status(404).json({ message: "Test case not found" });
        }

        if (await Contest.exists({ "problems.problem": req.params.problemId, status: { $ne: "draft" } }) ||
            await Submission.exists({ problem: req.params.problemId })) {
            return res.status(409).json({ message: "Test cases used in published contests or submissions cannot be changed" });
        }

        if (body.input !== undefined) testCase.input = body.input;
        if (body.expectedOutput !== undefined) testCase.expectedOutput = body.expectedOutput;

        await testCase.save();
        return res.status(200).json({ message: "Test case updated", testCase });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ message: "Check the test case fields" });
        }
        return res.status(500).json({ message: "Could not update test case" });
    }
}

async function deleteTestCase(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        if (!mongoose.isObjectIdOrHexString(req.params.problemId) || !mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid problem or test case ID" });
        }

        const problem = await Problem.findById(req.params.problemId);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        if (problem.visibility !== "draft") {
            return res.status(409).json({ message: "Test cases of published problems cannot be changed" });
        }

        const testCase = await TestCase.findOne({ _id: req.params.id, problem: problem._id });

        if (!testCase) {
            return res.status(404).json({ message: "Test case not found" });
        }

        if (await Contest.exists({ "problems.problem": problem._id }) || await Submission.exists({ problem: problem._id })) {
            return res.status(409).json({ message: "Test cases used in contests or submissions cannot be deleted" });
        }

        await testCase.deleteOne();
        return res.status(200).json({ message: "Test case deleted" });
    } catch {
        return res.status(500).json({ message: "Could not delete test case" });
    }
}

module.exports = { createTestCase, getTestCases, updateTestCase, deleteTestCase };
