const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const SolvedProblem = require("../models/solvedProblem.model");

async function getProfile(req, res) {
    try {
        const user = req.user;
        const solvedCount = await SolvedProblem.countDocuments({ user: user._id });

        return res.status(200).json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                department: user.department,
                year: user.year,
                role: user.role,
                createdAt: user.createdAt,
                solvedCount,
            },
        });
    } catch {
        return res.status(500).json({ message: "Could not get profile" });
    }
}

async function updateProfile(req, res) {
    try {
        const body = req.body;
        const fields = ["name", "department", "year"];

        if (!body || typeof body !== "object" || Array.isArray(body) ||
            !fields.some(field => Object.hasOwn(body, field)) ||
            fields.some(field => Object.hasOwn(body, field) &&
                (typeof body[field] !== "string" || !body[field].trim()))) {
            return res.status(400).json({ message: "Send a valid name, department or year" });
        }

        const user = await User.findById(req.user._id).select("+tokenVersion");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        for (const field of fields) {
            if (Object.hasOwn(body, field)) user[field] = body[field];
        }

        await user.save();

        return res.status(200).json({
            message: "Profile updated",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                department: user.department,
                year: user.year,
                role: user.role,
                createdAt: user.createdAt,
            },
        });
    } catch (error) {
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: "Check your name, department and year" });
        }
        return res.status(500).json({ message: "Could not update profile" });
    }
}

async function getSolvedProblems(req, res) {
    try {
        const query = req.query || {};
        const { page = "1", limit = "20" } = query;

        if (Object.keys(query).some(field => !["page", "limit"].includes(field)) ||
            typeof page !== "string" || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) ||
            typeof limit !== "string" || !/^[1-9]\d*$/.test(limit) || Number(limit) > 100) {
            return res.status(400).json({ message: "Invalid pagination" });
        }

        const skip = (Number(page) - 1) * Number(limit);

        if (!Number.isSafeInteger(skip)) {
            return res.status(400).json({ message: "Invalid page" });
        }

        const filter = { user: req.user._id };
        const solved = await SolvedProblem.find(filter)
            .select("problem submission solvedAt")
            .populate("problem", "title slug difficulty")
            .sort({ solvedAt: -1, _id: -1 })
            .skip(skip)
            .limit(Number(limit));
        const total = await SolvedProblem.countDocuments(filter);

        const solvedProblems = solved.map(record => ({
            id: record._id,
            problem: record.problem ? {
                id: record.problem._id,
                title: record.problem.title,
                slug: record.problem.slug,
                difficulty: record.problem.difficulty,
            } : null,
            submission: record.submission,
            solvedAt: record.solvedAt,
        }));

        return res.status(200).json({ solvedProblems, page: Number(page), limit: Number(limit), total });
    } catch {
        return res.status(500).json({ message: "Could not get solved problems" });
    }
}

async function changePassword(req, res) {
    try {
        const body = req.body;

        if (!body || typeof body !== "object" || Array.isArray(body) ||
            [body.currentPassword, body.newPassword].some(password =>
                typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72)) {
            return res.status(400).json({ message: "Passwords must be at least 8 characters and at most 72 bytes" });
        }

        const user = await User.findOne({
            _id: req.user._id,
            tokenVersion: req.user.tokenVersion,
        }).select("+passwordHash +tokenVersion");

        if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
            return res.status(401).json({ message: "Current password is incorrect or your session has expired" });
        }

        const passwordHash = await bcrypt.hash(body.newPassword, 12);
        const result = await User.updateOne(
            { _id: user._id, passwordHash: user.passwordHash, tokenVersion: user.tokenVersion },
            { $set: { passwordHash }, $inc: { tokenVersion: 1 } },
            { runValidators: true }
        );

        if (result.matchedCount !== 1) {
            return res.status(409).json({ message: "Your account changed. Log in and try again" });
        }

        return res.status(200).json({ message: "Password changed. Log in again" });
    } catch {
        return res.status(500).json({ message: "Could not change password" });
    }
}

module.exports = { getProfile, updateProfile, getSolvedProblems, changePassword };
