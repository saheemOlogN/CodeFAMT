const mongoose = require("mongoose");
const AdminLock = require("../models/adminLock.model");
const realtime = require("../utils/realtime");

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
    }
    return next();
}

function adminWrite(controller) {
    return async function (req, res, next) {
        let response;
        try {
            await mongoose.connection.transaction(async session => {
                const lock = await AdminLock.updateOne({ _id: "admin" }, { $inc: { version: 1 } }, { session });
                if (lock.matchedCount !== 1) throw new Error("Admin lock is unavailable");
                response = {
                    statusCode: 200,
                    status(code) { this.statusCode = code; return this; },
                    json(body) { this.body = body; return this; },
                };
                await controller(req, response, next);
                if (response.statusCode >= 400) {
                    const error = new Error("Admin change rejected");
                    error.response = response;
                    throw error;
                }
            });
            if (req.baseUrl === "/api/contests") {
                await realtime.publishContest(req.params?.id || response.body?.contest?._id);
            }
            return res.status(response.statusCode).json(response.body);
        } catch (error) {
            if (error.response) return res.status(error.response.statusCode).json(error.response.body);
            return next(error);
        }
    };
}

module.exports = { requireAdmin, adminWrite };
