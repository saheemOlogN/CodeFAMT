const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");

async function requireAuth(req, res, next) {
    const authorization = req.headers.authorization;

    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Log in to continue" });
    }

    if (!process.env.JWT_SECRET) {
        return res.status(503).json({ message: "Login is not configured yet" });
    }

    let payload;
    try {
        payload = jwt.verify(authorization.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
        return res.status(401).json({ message: "Invalid or expired login token" });
    }

    if (!mongoose.isObjectIdOrHexString(payload.sub) || !Number.isSafeInteger(payload.version) ||
        payload.version < 0 || !Number.isInteger(payload.exp)) {
        return res.status(401).json({ message: "Invalid login token" });
    }

    try {
        const user = await User.findById(payload.sub).select("+tokenVersion");
        if (!user || !user.isVerified || user.tokenVersion !== payload.version) {
            return res.status(401).json({ message: "Please log in again" });
        }
        req.user = user;
        return next();
    } catch {
        return res.status(500).json({ message: "Could not check your login" });
    }
}

module.exports = requireAuth;
