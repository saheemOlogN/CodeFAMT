const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { getRedis } = require("../config/redis");

function sharedStore(name) {
    if (!process.env.REDIS_URL) return undefined;
    return new RedisStore({
        sendCommand: (...args) => getRedis().call(...args),
        prefix: `${process.env.REDIS_PREFIX || "codefamt"}:limit:${name}:`,
    });
}

const authLimiter = rateLimit({
    store: sharedStore("auth"),
    windowMs: 15 * 60000,
    limit: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many login requests. Please try again later" },
});

const accountLimiter = rateLimit({
    store: sharedStore("account"),
    windowMs: 15 * 60000,
    limit: 20,
    keyGenerator: (req) => {
        const email = req.body && req.body.email;
        return typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "missing-email";
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many attempts for this email. Please try again later" },
});

const executionLimiter = rateLimit({
    store: sharedStore("execution"),
    windowMs: 60000,
    limit: 5,
    keyGenerator: (req) => req.user._id.toString(),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "You can run or submit code five times per minute" },
});

const passwordLimiter = rateLimit({
    store: sharedStore("password"),
    windowMs: 15 * 60000,
    limit: 10,
    keyGenerator: (req) => req.user._id.toString(),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many password change attempts. Please try again later" },
});

module.exports = { authLimiter, accountLimiter, executionLimiter, passwordLimiter };
