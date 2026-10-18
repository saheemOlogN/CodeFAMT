const mongoose = require("mongoose");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const Submission = require("../models/submission.model");

const fields = ["title", "slug", "statement", "difficulty", "tags", "inputFormat", "outputFormat", "constraints", "examples", "timeLimitMs", "memoryLimitMb", "visibility"];
const publicFields = "title slug statement difficulty tags inputFormat outputFormat constraints examples timeLimitMs memoryLimitMb visibility createdAt updatedAt";

async function createProblem(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        const body = req.body || {};

        if (Array.isArray(body) || Object.keys(body).some((field) => !fields.includes(field))) {
            return res.status(400).json({ message: "Send only problem fields" });
        }

        if (body.visibility !== undefined && body.visibility !== "draft") {
            return res.status(400).json({ message: "Create the problem as a draft, then add test cases before publishing" });
        }

        const problem = new Problem({ createdBy: req.user._id, visibility: "draft" });

        for (const field of fields) {
            if (body[field] !== undefined) {
                problem[field] = body[field];
            }
        }

        await problem.save();
        return res.status(201).json({ message: "Problem created", problem });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "A problem with this slug already exists" });
        }
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ message: "Check the problem fields" });
        }
        return res.status(500).json({ message: "Could not create problem" });
    }
}

async function getProblems(req, res) {
    try {
        const { page = "1", limit = "20", difficulty, tag, visibility } = req.query;

        if (Object.keys(req.query).some((key) => !["page", "limit", "difficulty", "tag", "visibility"].includes(key)) ||
            typeof page !== "string" || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) ||
            typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100 ||
            (difficulty !== undefined && !["easy", "medium", "hard"].includes(difficulty)) ||
            (tag !== undefined && (typeof tag !== "string" || !tag.trim() || tag.length > 100)) ||
            (visibility !== undefined && !["draft", "contest", "public"].includes(visibility))) {
            return res.status(400).json({ message: "Invalid problem filters or pagination" });
        }

        const filter = {};

        if (req.user.role !== "admin") {
            filter.visibility = "public";
        } else if (visibility !== undefined) {
            filter.visibility = visibility;
        }

        if (difficulty !== undefined) filter.difficulty = difficulty;
        if (tag !== undefined) filter.tags = tag.trim().toLowerCase();

        const skip = (Number(page) - 1) * Number(limit);

        if (!Number.isSafeInteger(skip)) {
            return res.status(400).json({ message: "Invalid page" });
        }

        const problems = await Problem.find(filter)
            .select("title slug difficulty tags visibility createdAt updatedAt")
            .sort({ createdAt: -1, _id: -1 })
            .skip(skip)
            .limit(Number(limit));
        const total = await Problem.countDocuments(filter);

        return res.status(200).json({ problems, page: Number(page), limit: Number(limit), total });
    } catch {
        return res.status(500).json({ message: "Could not get problems" });
    }
}

async function getProblem(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid problem ID" });
        }

        const filter = { _id: req.params.id };

        if (req.user.role !== "admin") filter.visibility = "public";

        const problem = await Problem.findOne(filter).select(publicFields);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        return res.status(200).json({ problem });
    } catch {
        return res.status(500).json({ message: "Could not get problem" });
    }
}

async function updateProblem(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid problem ID" });
        }

        const body = req.body || {};

        if (Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some((field) => !fields.includes(field))) {
            return res.status(400).json({ message: "Send the problem fields to update" });
        }

        const problem = await Problem.findById(req.params.id);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        if (await Contest.exists({ "problems.problem": problem._id, status: { $ne: "draft" } }) ||
            await Submission.exists({ problem: problem._id })) {
            return res.status(409).json({ message: "Problems used in published contests or submissions cannot be changed" });
        }

        for (const field of fields) {
            if (body[field] !== undefined) {
                problem[field] = body[field];
            }
        }

        if (problem.visibility !== "draft") {
            const tests = await TestCase.find({ problem: problem._id }).select("+input +expectedOutput");

            if (!tests.length || tests.some((test) => typeof test.input !== "string" || typeof test.expectedOutput !== "string")) {
                return res.status(400).json({ message: "Add valid test cases before publishing the problem" });
            }
        }

        await problem.save();
        return res.status(200).json({ message: "Problem updated", problem });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "A problem with this slug already exists" });
        }
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ message: "Check the problem fields" });
        }
        return res.status(500).json({ message: "Could not update problem" });
    }
}

async function deleteProblem(req, res) {
    try {
        if (req.user.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid problem ID" });
        }

        const problem = await Problem.findById(req.params.id);

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        if (problem.visibility !== "draft" || await Contest.exists({ "problems.problem": problem._id }) ||
            await Submission.exists({ problem: problem._id })) {
            return res.status(409).json({ message: "Only unused draft problems can be deleted" });
        }

        if (await TestCase.exists({ problem: problem._id })) {
            return res.status(409).json({ message: "Delete this problem's test cases first" });
        }

        await problem.deleteOne();
        return res.status(200).json({ message: "Problem deleted" });
    } catch {
        return res.status(500).json({ message: "Could not delete problem" });
    }
}

module.exports = { createProblem, getProblems, getProblem, updateProblem, deleteProblem };
