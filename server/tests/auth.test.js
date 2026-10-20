const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const User = require("../models/user.model");
const Otp = require("../models/otp.model");
const realtime = require("../utils/realtime");
const sendOtp = require("../utils/sendOtp");
const { register, verifyOtp, resendOtp, login, logout } = require("../controllers/auth.controller");

const userId = "507f1f77bcf86cd799439011";
const otpId = "507f1f77bcf86cd799439012";
const otp = "123456";
const email = "student@famt.ac.in";

beforeEach(t => {
    const settings = {
        SMTP_HOST: "smtp.invalid",
        SMTP_PORT: "587",
        SMTP_USER: "mail-user",
        SMTP_PASS: "mail-password",
        SMTP_FROM: "codefamt@example.com",
        OTP_SECRET: "test-only-otp-secret",
        JWT_SECRET: "test-only-jwt-secret",
    };
    const previous = {};
    for (const [key, value] of Object.entries(settings)) {
        previous[key] = process.env[key];
        process.env[key] = value;
    }
    t.after(() => {
        for (const key of Object.keys(settings)) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    });
    t.mock.method(nodemailer, "createTransport", () => {
        assert.fail("Real mail transport must not be used in auth tests");
    });
    t.mock.method(realtime, "disconnectUser", async () => false);
});

function response() {
    return {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        json(body) { this.body = body; return this; },
    };
}

function query(value) {
    return {
        select() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function body(values = {}) {
    return { name: "Student", email, password: "valid-password", department: "it", year: "2nd", otp, ...values };
}

function user(values = {}) {
    return new User({
        _id: userId, name: "Student", email, passwordHash: "stored-password-hash",
        department: "it", year: "2nd", ...values,
    });
}

function record() {
    return {
        _id: otpId,
        user: userId,
        otpHash: crypto.createHmac("sha256", process.env.OTP_SECRET).update(`${userId}:${otp}`).digest("hex"),
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
    };
}

function prepareVerification(t) {
    const stored = record();
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(Otp, "findOneAndUpdate", (filter, update) => {
        assert.deepEqual(filter.attempts, { $lt: 5 });
        assert.ok(filter.expiresAt.$gt instanceof Date);
        assert.deepEqual(update, { $inc: { attempts: 1 } });
        return query(stored);
    });
    t.mock.method(bcrypt, "hash", async (password, rounds) => {
        assert.equal(password, "valid-password");
        assert.equal(rounds, 12);
        return "new-password-hash";
    });
    return stored;
}

test("registration rejects noncollege email, invalid fields and oversized passwords before lookup", async t => {
    t.mock.method(User, "findOne", () => assert.fail("User must not be queried"));
    for (const values of [null, {}, body({ email: "student@example.com" }),
        body({ email: "student@famt.ac.in.attacker.com" }), body({ email: {} }), body({ name: " " }),
        body({ password: "short" }), body({ password: "é".repeat(37) }), body({ year: [] })]) {
        const res = response();
        await register({ body: values }, res);
        assert.equal(res.statusCode, 400);
    }
});

test("registration saves a student account and sends an OTP without exposing credentials", async t => {
    t.mock.method(User, "findOne", filter => {
        assert.deepEqual(filter, { email });
        return query(null);
    });
    t.mock.method(bcrypt, "hash", async (password, rounds) => {
        assert.equal(password, "valid-password");
        assert.equal(rounds, 12);
        return "new-password-hash";
    });
    let saved;
    t.mock.method(User.prototype, "save", async function () {
        saved = this;
        return this;
    });
    t.mock.method(Otp, "findOneAndUpdate", async () => {});
    let destination;
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async message => { destination = message.to; } }));
    const res = response();
    await register({ body: body({ email: " STUDENT@FAMT.AC.IN ", role: "admin", isVerified: true }) }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.role, "student");
    assert.equal(saved.isVerified, false);
    assert.equal(saved.passwordHash, "new-password-hash");
    assert.equal(destination, email);
    assert.equal(JSON.stringify(res.body).includes("password"), false);
});

test("registration never overwrites an existing verified account", async t => {
    t.mock.method(User, "findOne", () => query(user({ isVerified: true })));
    t.mock.method(User.prototype, "save", () => assert.fail("User must not be saved"));
    t.mock.method(bcrypt, "hash", () => assert.fail("Password must not be hashed"));
    const res = response();
    await register({ body: body() }, res);
    assert.equal(res.statusCode, 409);
});

test("verification rejects malformed stored hashes without consuming an OTP", async t => {
    prepareVerification(t);
    t.mock.method(Otp, "findOneAndDelete", () => assert.fail("OTP must not be consumed"));
    for (const otpHash of ["", "bad-hash", undefined, "0".repeat(64)]) {
        t.mock.method(Otp, "findOneAndUpdate", () => query({ ...record(), otpHash }));
        const res = response();
        await verifyOtp({ body: body() }, res);
        assert.equal(res.statusCode, 400);
    }
});

test("verification validates department and year before consuming a valid OTP", async t => {
    prepareVerification(t);
    t.mock.method(Otp, "findOneAndDelete", () => assert.fail("OTP must not be consumed"));
    for (const values of [{ department: "unknown" }, { year: "5th" }, { name: "n".repeat(101) }]) {
        const res = response();
        await verifyOtp({ body: body(values) }, res);
        assert.equal(res.statusCode, 400);
    }
});

test("verification consumes its exact OTP and activates the account in one transaction", async t => {
    const stored = prepareVerification(t);
    const session = { id: "verification-session" };
    let consumed = false;
    t.mock.method(mongoose.connection, "transaction", async callback => callback(session));
    t.mock.method(Otp, "findOneAndDelete", async (filter, options) => {
        assert.equal(String(filter._id), otpId);
        assert.equal(filter.otpHash, stored.otpHash);
        assert.equal(filter.lastSentAt, stored.lastSentAt);
        assert.ok(filter.expiresAt.$gt instanceof Date);
        assert.deepEqual(options, { session });
        consumed = true;
        return stored;
    });
    t.mock.method(User, "findOneAndUpdate", async (filter, update, options) => {
        assert.equal(consumed, true);
        assert.equal(String(filter._id), userId);
        assert.equal(filter.isVerified, false);
        assert.deepEqual(update.$set, {
            name: "Student", department: "it", year: "2nd", passwordHash: "new-password-hash", isVerified: true,
        });
        assert.deepEqual(options, { returnDocument: "after", runValidators: true, session });
        return user({ isVerified: true });
    });
    const res = response();
    await verifyOtp({ body: body({ role: "admin" }) }, res);
    assert.equal(res.statusCode, 200);
});

test("failed account activation rolls back OTP consumption", async t => {
    const stored = prepareVerification(t);
    let available = true;
    t.mock.method(mongoose.connection, "transaction", async callback => {
        try {
            return await callback({});
        } catch (error) {
            available = true;
            throw error;
        }
    });
    t.mock.method(Otp, "findOneAndDelete", async () => { available = false; return stored; });
    t.mock.method(User, "findOneAndUpdate", async () => { throw new Error("private database details"); });
    const res = response();
    await verifyOtp({ body: body() }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(available, true);
    assert.equal(JSON.stringify(res.body).includes("private"), false);
});

test("an OTP replaced during hashing cannot verify the account", async t => {
    prepareVerification(t);
    t.mock.method(mongoose.connection, "transaction", async callback => callback({}));
    t.mock.method(Otp, "findOneAndDelete", async () => null);
    t.mock.method(User, "findOneAndUpdate", () => assert.fail("User must not be updated"));
    const res = response();
    await verifyOtp({ body: body() }, res);
    assert.equal(res.statusCode, 400);
});

test("one verification OTP can activate an account only once under concurrent requests", async t => {
    const stored = prepareVerification(t);
    let available = true;
    let activations = 0;
    t.mock.method(mongoose.connection, "transaction", async callback => callback({}));
    t.mock.method(Otp, "findOneAndDelete", async () => {
        if (!available) return null;
        available = false;
        return stored;
    });
    t.mock.method(User, "findOneAndUpdate", async () => {
        activations++;
        return user({ isVerified: true });
    });
    const responses = Array.from({ length: 5 }, response);
    await Promise.all(responses.map(res => verifyOtp({ body: body() }, res)));
    assert.equal(activations, 1);
    assert.equal(responses.filter(res => res.statusCode === 200).length, 1);
    assert.equal(responses.filter(res => res.statusCode === 400).length, 4);
});

test("concurrent OTP requests reserve one delivery and keep only a scoped hash", async t => {
    const storedUser = user();
    let reserved = false;
    let deliveries = 0;
    t.mock.method(crypto, "randomInt", () => Number(otp));
    t.mock.method(Otp, "findOneAndUpdate", async (filter, update, options) => {
        assert.equal(String(filter.user), userId);
        assert.equal(update.$set.otpHash, record().otpHash);
        assert.equal(update.$set.lastSentAt - filter.lastSentAt.$lte, 60000);
        assert.equal(update.$set.expiresAt - update.$set.lastSentAt, 300000);
        assert.deepEqual(options, { upsert: true, runValidators: true });
        if (reserved) {
            const error = new Error("duplicate OTP");
            error.code = 11000;
            throw error;
        }
        reserved = true;
    });
    t.mock.method(nodemailer, "createTransport", settings => {
        assert.equal(settings.requireTLS, true);
        assert.equal(settings.connectionTimeout, 10000);
        assert.equal(settings.socketTimeout, 30000);
        return { sendMail: async message => {
            assert.equal(message.to, email);
            assert.match(message.text, /123456/);
            deliveries++;
        } };
    });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => sendOtp(storedUser)));
    assert.equal(deliveries, 1);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected" && result.reason.status === 429).length, 4);
});

test("SMTP failures expose only a safe temporary error", async t => {
    t.mock.method(Otp, "findOneAndUpdate", async () => {});
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => {
        throw new Error("private SMTP credentials");
    } }));
    await assert.rejects(sendOtp(user()), { status: 503, message: "Could not send OTP. Try again after 60 seconds" });
});

test("resending an OTP for an unknown user returns a generic success without mail", async t => {
    t.mock.method(User, "findOne", () => query(null));
    const res = response();
    await resendOtp({ body: { email } }, res);
    assert.equal(res.statusCode, 200);
});

test("login checks password and verification before issuing a one-hour token", async t => {
    let verified = false;
    let correctPassword = false;
    const storedUser = user({ tokenVersion: 3 });
    t.mock.method(User, "findOne", () => {
        storedUser.isVerified = verified;
        return query(storedUser);
    });
    t.mock.method(bcrypt, "compare", async () => correctPassword);
    const wrong = response();
    await login({ body: body() }, wrong);
    assert.equal(wrong.statusCode, 401);
    correctPassword = true;
    const unverified = response();
    await login({ body: body() }, unverified);
    assert.equal(unverified.statusCode, 403);
    verified = true;
    const res = response();
    await login({ body: body() }, res);
    assert.equal(res.statusCode, 200);
    const token = jwt.verify(res.body.token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    assert.equal(token.sub, userId);
    assert.equal(token.version, 3);
    assert.equal(token.exp - token.iat, 3600);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.tokenVersion, undefined);
});

test("logout revokes all previous tokens before disconnecting sockets", async t => {
    let revoked = false;
    t.mock.method(User, "updateOne", async (filter, update) => {
        assert.equal(String(filter._id), userId);
        assert.deepEqual(update, { $inc: { tokenVersion: 1 } });
        revoked = true;
        return { matchedCount: 1 };
    });
    t.mock.method(realtime, "disconnectUser", async id => {
        assert.equal(revoked, true);
        assert.equal(String(id), userId);
    });
    const res = response();
    await logout({ user: user() }, res);
    assert.equal(res.statusCode, 200);
});
