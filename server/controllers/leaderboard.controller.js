const { practiceFilter } = require('../utils/practiceAccess');
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Problem = require("../models/problem.model");
const SolvedProblem = require("../models/solvedProblem.model");

async function getLeaderboard(req, res) {
    try {
        const query = req.query || {};
        const { page = "1", limit = "20", department, year, problemId } = query;
        const fields = ["page", "limit", "department", "year", "problemId"];

        if (Object.keys(query).some(field => !fields.includes(field)) ||
            typeof page !== "string" || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) ||
            typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100 ||
            !Number.isSafeInteger((Number(page) - 1) * Number(limit))) {
            return res.status(400).json({ message: "Use a positive page and a limit between 1 and 100" });
        }

        if ((department !== undefined && !User.schema.path("department").enumValues.includes(department)) ||
            (year !== undefined && !User.schema.path("year").enumValues.includes(year)) ||
            (problemId !== undefined && (typeof problemId !== "string" || !mongoose.isObjectIdOrHexString(problemId)))) {
            return res.status(400).json({ message: "Choose a valid department, year and problem" });
        }

        const visible = await practiceFilter();
        const problem = problemId === undefined ? null : new mongoose.Types.ObjectId(problemId);
        if (problem && !(await Problem.exists({ _id: problem, ...visible }))) {
            return res.status(404).json({ message: "Problem not found" });
        }

        const skip = (Number(page) - 1) * Number(limit);
        const cohort = { role: "student", isVerified: true };
        if (department !== undefined) cohort.department = department;
        if (year !== undefined) cohort.year = year;

        const result = await User.aggregate([
            { $match: cohort },
            { $project: { name: 1, department: 1, year: 1 } },
            {
                $lookup: {
                    from: SolvedProblem.collection.name,
                    let: { student: "$_id" },
                    pipeline: [
                        { $match: { ...(problem ? { problem } : {}), $expr: { $eq: ["$user", "$$student"] } } },
                        // Count a problem once, using the first accepted solve even for legacy duplicate records.
                        { $group: { _id: "$problem", solvedAt: { $min: "$solvedAt" } } },
                        {
                            $lookup: {
                                from: Problem.collection.name,
                                localField: "_id",
                                foreignField: "_id",
                                pipeline: [
                                    { $match: visible },
                                    { $project: { difficulty: 1 } },
                                ],
                                as: "problem",
                            },
                        },
                        { $unwind: "$problem" },
                        {
                            $group: {
                                _id: null,
                                solvedCount: { $sum: 1 },
                                easyCount: { $sum: { $cond: [{ $eq: ["$problem.difficulty", "easy"] }, 1, 0] } },
                                mediumCount: { $sum: { $cond: [{ $eq: ["$problem.difficulty", "medium"] }, 1, 0] } },
                                hardCount: { $sum: { $cond: [{ $eq: ["$problem.difficulty", "hard"] }, 1, 0] } },
                                lastSolvedAt: { $max: "$solvedAt" },
                            },
                        },
                    ],
                    as: "solves",
                },
            },
            {
                $set: {
                    solvedCount: { $ifNull: [{ $arrayElemAt: ["$solves.solvedCount", 0] }, 0] },
                    easyCount: { $ifNull: [{ $arrayElemAt: ["$solves.easyCount", 0] }, 0] },
                    mediumCount: { $ifNull: [{ $arrayElemAt: ["$solves.mediumCount", 0] }, 0] },
                    hardCount: { $ifNull: [{ $arrayElemAt: ["$solves.hardCount", 0] }, 0] },
                    lastSolvedAt: { $ifNull: [{ $arrayElemAt: ["$solves.lastSolvedAt", 0] }, null] },
                },
            },
            { $unset: "solves" },
            ...(problem ? [
                { $match: { solvedCount: { $gt: 0 } } },
                { $sort: { lastSolvedAt: 1, _id: 1 } },
            ] : [
                // Rank before pagination so shared ranks remain correct across page boundaries.
                { $setWindowFields: { sortBy: { solvedCount: -1 }, output: { rank: { $rank: {} } } } },
                { $sort: { solvedCount: -1, lastSolvedAt: 1, _id: 1 } },
            ]),
            {
                $facet: {
                    rows: [{ $skip: skip }, { $limit: Number(limit) }],
                    count: [{ $count: "total" }],
                },
            },
        ]);

        const leaderboard = (result[0]?.rows || []).map((row, index) => ({
            rank: problem ? skip + index + 1 : row.rank,
            user: { id: row._id, name: row.name, department: row.department, year: row.year },
            solvedCount: row.solvedCount,
            easyCount: row.easyCount,
            mediumCount: row.mediumCount,
            hardCount: row.hardCount,
            lastSolvedAt: row.lastSolvedAt,
        }));

        return res.status(200).json({ leaderboard, page: Number(page), limit: Number(limit), total: result[0]?.count[0]?.total || 0 });
    } catch {
        return res.status(500).json({ message: "Could not load leaderboard" });
    }
}

module.exports = { getLeaderboard };
