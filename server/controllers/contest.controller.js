const mongoose = require("mongoose");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Submission = require("../models/submission.model");

async function createContest(req, res) {
    try {
        const { title, description, startTime, endTime, problems = [], status } = req.body || {};

        if (status !== undefined && status !== "draft") {
            return res.status(400).json({ message: "Create a draft first, then publish it" });
        }

        if (!Array.isArray(problems) || problems.length > 20 || problems.some((entry) => !entry || typeof entry !== "object")) {
            return res.status(400).json({ message: "Send an array of up to 20 problems" });
        }

        const contest = new Contest({
            title,
            description,
            startTime,
            endTime,
            problems: problems.map((entry) => ({ problem: entry.problem, points: entry.points })),
            status: "draft",
            createdBy: req.user._id,
        });

        await contest.validate();

        const problemIds = contest.problems.map((entry) => entry.problem);

        if (problemIds.length && await Problem.countDocuments({ _id: { $in: problemIds } }) !== problemIds.length) {
            return res.status(400).json({ message: "One or more problems do not exist" });
        }

        await contest.save();

        return res.status(201).json({ message: "Contest draft created", contest });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ message: "Check the title, dates, problem IDs and points. Each problem must appear once" });
        }
        return res.status(500).json({ message: "Could not create contest" });
    }
}

async function getContests(req, res) {
    try {
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 20);

        if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ message: "Use a positive page and a limit between 1 and 100" });
        }

        const filter = req.user.role === "admin" ? {} : { status: { $in: ["published", "cancelled"] } };
        const contests = await Contest.find(filter)
            .select("title description startTime endTime status")
            .sort({ startTime: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();
        const total = await Contest.countDocuments(filter);

        return res.status(200).json({ contests, page, limit, total, serverNow: new Date() });
    } catch {
        return res.status(500).json({ message: "Could not load contests" });
    }
}

async function getContest(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid contest ID" });
        }

        const contest = await Contest.findById(req.params.id).lean();
        const isAdmin = req.user.role === "admin";

        if (!contest || (!isAdmin && contest.status === "draft")) {
            return res.status(404).json({ message: "Contest not found" });
        }

        const serverNow = new Date();
        const joined = Boolean(await ContestParticipant.exists({ contest: contest._id, user: req.user._id }));
        const details = {
            _id: contest._id,
            title: contest.title,
            description: contest.description,
            startTime: contest.startTime,
            endTime: contest.endTime,
            status: contest.status,
            problemCount: contest.problems.length,
        };

        if (isAdmin || (joined && contest.status === "published" && serverNow >= contest.startTime)) {
            const problems = await Problem.find({ _id: { $in: contest.problems.map((entry) => entry.problem) } })
                .select("title slug difficulty")
                .lean();

            details.problems = contest.problems.map((entry) => ({
                problem: problems.find((problem) => String(problem._id) === String(entry.problem)) || null,
                points: entry.points,
            }));
        }

        return res.status(200).json({ contest: details, joined, serverNow });
    } catch {
        return res.status(500).json({ message: "Could not load contest" });
    }
}

async function updateContest(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid contest ID" });
        }

        const contest = await Contest.findById(req.params.id);

        if (!contest) {
            return res.status(404).json({ message: "Contest not found" });
        }

        const body = req.body || {};
        const originalStatus = contest.status;
        const originalUpdatedAt = contest.updatedAt;

        if (originalStatus !== "draft") {
            if (originalStatus !== "published" || body.status !== "cancelled" || Object.keys(body).some((key) => key !== "status") || new Date() >= contest.startTime) {
                return res.status(409).json({ message: "Published contests cannot be edited. Only cancellation before the start is allowed" });
            }

            contest.status = "cancelled";
        } else {
            if (body.problems !== undefined && (!Array.isArray(body.problems) || body.problems.length > 20 || body.problems.some((entry) => !entry || typeof entry !== "object"))) {
                return res.status(400).json({ message: "Send an array of up to 20 problems" });
            }

            for (const field of ["title", "description", "startTime", "endTime", "status"]) {
                if (body[field] !== undefined) {
                    contest[field] = body[field];
                }
            }

            if (body.problems !== undefined) {
                contest.problems = body.problems.map((entry) => ({ problem: entry.problem, points: entry.points }));
            }

            await contest.validate();

            const problemIds = contest.problems.map((entry) => entry.problem);
            const filter = { _id: { $in: problemIds } };

            if (contest.status === "published") {
                filter.visibility = "contest";
            }

            if (problemIds.length && await Problem.countDocuments(filter) !== problemIds.length) {
                return res.status(400).json({ message: "Problems must exist. Publishing requires every problem to have contest visibility" });
            }

            if (contest.status === "published") {
                const testedProblems = await TestCase.distinct("problem", { problem: { $in: problemIds } });

                if (testedProblems.length !== problemIds.length) {
                    return res.status(400).json({ message: "Add at least one test case to every contest problem before publishing" });
                }

                if (await Contest.exists({
                    _id: { $ne: contest._id },
                    status: "published",
                    "problems.problem": { $in: problemIds },
                })) {
                    return res.status(409).json({ message: "Use new problems that are not part of another published contest" });
                }

                if (contest.startTime <= new Date()) {
                    return res.status(400).json({ message: "Publish the contest before its start time" });
                }
            }
        }

        contest.$where = { status: originalStatus, updatedAt: originalUpdatedAt };
        await contest.save();

        return res.status(200).json({ message: "Contest updated", contest });
    } catch (error) {
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ message: "Check the title, dates, status, problem IDs and points. Publishing requires at least one problem" });
        }
        if (error.name === "DocumentNotFoundError" || error.name === "VersionError") {
            return res.status(409).json({ message: "Contest changed. Reload it before trying again" });
        }
        return res.status(500).json({ message: "Could not update contest" });
    }
}

async function deleteContest(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid contest ID" });
        }

        const contest = await Contest.findById(req.params.id);

        if (!contest) {
            return res.status(404).json({ message: "Contest not found" });
        }

        if (contest.status !== "draft") {
            return res.status(409).json({ message: "Only draft contests can be deleted" });
        }

        if (await ContestParticipant.exists({ contest: contest._id }) || await Submission.exists({ contest: contest._id })) {
            return res.status(409).json({ message: "Contests with participants or submissions cannot be deleted" });
        }

        const result = await Contest.deleteOne({ _id: contest._id, status: "draft", updatedAt: contest.updatedAt });

        if (!result.deletedCount) {
            return res.status(409).json({ message: "Contest changed. Reload it before trying again" });
        }

        return res.status(200).json({ message: "Contest deleted" });
    } catch {
        return res.status(500).json({ message: "Could not delete contest" });
    }
}

async function joinContest(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid contest ID" });
        }

        const contest = await Contest.findById(req.params.id);
        const serverNow = new Date();

        if (!contest || contest.status === "draft") {
            return res.status(404).json({ message: "Contest not found" });
        }

        if (contest.status !== "published" || serverNow >= contest.endTime) {
            return res.status(409).json({ message: "This contest is not open for joining" });
        }

        await ContestParticipant.updateOne(
            { contest: contest._id, user: req.user._id },
            { $setOnInsert: { contest: contest._id, user: req.user._id } },
            { upsert: true, runValidators: true }
        );

        return res.status(200).json({ message: "Joined contest", serverNow });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(200).json({ message: "Already joined contest", serverNow: new Date() });
        }
        return res.status(500).json({ message: "Could not join contest" });
    }
}

async function getContestProblem(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id) || !mongoose.isObjectIdOrHexString(req.params.problemId)) {
            return res.status(400).json({ message: "Invalid contest or problem ID" });
        }

        const contest = await Contest.findById(req.params.id);
        const isAdmin = req.user.role === "admin";
        const serverNow = new Date();

        if (!contest || (!isAdmin && contest.status !== "published")) {
            return res.status(404).json({ message: "Contest not found" });
        }

        if (!isAdmin) {
            if (serverNow < contest.startTime) {
                return res.status(403).json({ message: "Contest problems open when the contest starts" });
            }

            if (!await ContestParticipant.exists({ contest: contest._id, user: req.user._id })) {
                return res.status(403).json({ message: "Join this contest to view its problems" });
            }
        }

        const entry = contest.problems.find((item) => String(item.problem) === req.params.problemId.toLowerCase());

        if (!entry) {
            return res.status(404).json({ message: "Problem not found in this contest" });
        }

        const problem = await Problem.findById(entry.problem)
            .select("title slug statement difficulty tags inputFormat outputFormat constraints examples timeLimitMs memoryLimitMb")
            .lean();

        if (!problem) {
            return res.status(404).json({ message: "Problem not found" });
        }

        return res.status(200).json({
            problem,
            points: entry.points,
            startTime: contest.startTime,
            endTime: contest.endTime,
            serverNow,
        });
    } catch {
        return res.status(500).json({ message: "Could not load contest problem" });
    }
}

async function getLeaderboard(req, res) {
    try {
        if (!mongoose.isObjectIdOrHexString(req.params.id)) {
            return res.status(400).json({ message: "Invalid contest ID" });
        }

        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 20);

        if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ message: "Use a positive page and a limit between 1 and 100" });
        }

        const contest = await Contest.findById(req.params.id);
        const serverNow = new Date();
        const isAdmin = req.user.role === "admin";

        if (!contest || (!isAdmin && contest.status !== "published")) {
            return res.status(404).json({ message: "Contest not found" });
        }

        if (!isAdmin && serverNow < contest.startTime) {
            return res.status(403).json({ message: "Leaderboard opens when the contest starts" });
        }

        const points = contest.problems.map((entry) => ({
            case: { $eq: ["$_id", entry.problem] },
            then: entry.points,
        }));
        const result = await ContestParticipant.aggregate([
            { $match: { contest: contest._id } },
            {
                $lookup: {
                    from: "submissions",
                    let: { participant: "$user" },
                    pipeline: [
                        {
                            $match: {
                                contest: contest._id,
                                status: "accepted",
                                problem: { $in: contest.problems.map((entry) => entry.problem) },
                                createdAt: { $gte: contest.startTime, $lt: contest.endTime },
                                $expr: { $eq: ["$user", "$$participant"] },
                            },
                        },
                        { $group: { _id: "$problem", acceptedAt: { $min: "$createdAt" } } },
                        {
                            $group: {
                                _id: null,
                                score: { $sum: points.length ? { $switch: { branches: points, default: 0 } } : 0 },
                                solvedCount: { $sum: 1 },
                                lastScoredAt: { $max: "$acceptedAt" },
                            },
                        },
                    ],
                    as: "result",
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "_id",
                    pipeline: [{ $project: { name: 1, department: 1, year: 1 } }],
                    as: "student",
                },
            },
            { $unwind: "$student" },
            {
                $project: {
                    _id: 0,
                    user: "$student",
                    score: { $ifNull: [{ $arrayElemAt: ["$result.score", 0] }, 0] },
                    solvedCount: { $ifNull: [{ $arrayElemAt: ["$result.solvedCount", 0] }, 0] },
                    lastScoredAt: { $ifNull: [{ $arrayElemAt: ["$result.lastScoredAt", 0] }, null] },
                },
            },
            { $sort: { score: -1, lastScoredAt: 1, "user._id": 1 } },
            {
                $facet: {
                    rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
                    count: [{ $count: "total" }],
                },
            },
        ]);
        const rows = result[0]?.rows || [];
        const leaderboard = rows.map((row, index) => ({ rank: (page - 1) * limit + index + 1, ...row }));

        return res.status(200).json({
            leaderboard,
            total: result[0]?.count[0]?.total || 0,
            page,
            limit,
            startTime: contest.startTime,
            endTime: contest.endTime,
            serverNow,
        });
    } catch {
        return res.status(500).json({ message: "Could not load leaderboard" });
    }
}

module.exports = {
    createContest,
    getContests,
    getContest,
    updateContest,
    deleteContest,
    joinContest,
    getContestProblem,
    getLeaderboard,
};
