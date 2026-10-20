const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const User = require("../models/user.model");
const PasswordReset = require("../models/passwordReset.model");
const realtime = require("../utils/realtime");
const { forgotPassword, resetPassword } = require("../controllers/passwordReset.controller");

const userId = "507f1f77bcf86cd799439011";
const resetId = "507f1f77bcf86cd799439012";
const email = "student@famt.ac.in";
const otp = "123456";

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

function environment(t) {
    t.mock.method(realtime, "disconnectUser", async () => false);
    const settings = {
        SMTP_HOST: "smtp.invalid",
        SMTP_PORT: "587",
        SMTP_USER: "mail-user",
        SMTP_PASS: "mail-password",
        SMTP_FROM: "codefamt@example.com",
        OTP_SECRET: "test-only-password-reset-secret",
    };
    const old = {};

    for (const [key, value] of Object.entries(settings)) {
        old[key] = process.env[key];
        process.env[key] = value;
    }

    t.after(() => {
        for (const key of Object.keys(settings)) {
            if (old[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = old[key];
            }
        }
    });
}

function user() {
    return { _id: userId, email, isVerified: true, passwordHash: "old-password-hash", tokenVersion: 3 };
}

function record() {
    return {
        _id: resetId,
        user: userId,
        otpHash: crypto.createHmac("sha256", process.env.OTP_SECRET)
            .update(`reset:${userId}:${otp}`).digest("hex"),
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
        attempts: 1,
    };
}

function resetBody(values = {}) {
    return { email, otp, newPassword: "new-valid-password", ...values };
}

test("password reset model has a separate collection, unique user and expiry index", async () => {
    const model = new PasswordReset({ user: userId, otpHash: "hash", expiresAt: new Date() });
    await model.validate();
    assert.equal(PasswordReset.modelName, "PasswordReset");
    assert.equal(PasswordReset.schema.path("otpHash").options.select, false);
    assert.equal(model.attempts, 0);
    assert.equal(PasswordReset.schema.indexes().some(([fields, options]) => fields.user === 1 && options.unique), true);
    assert.equal(PasswordReset.schema.indexes().some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0), true);
});

test("forgot password rejects invalid college email before database access", async t => {
    t.mock.method(User, "findOne", () => assert.fail("Database must not be queried"));
    for (const body of [null, {}, { email: { $ne: null } }, { email: "student@example.com" },
        { email: "student@famt.ac.in.attacker.com" }, { email: "student @famt.ac.in" }]) {
        const res = response();
        await forgotPassword({ body }, res);
        assert.equal(res.statusCode, 400);
    }
});

test("missing mail configuration returns the same unavailable response before account lookup", async t => {
    environment(t);
    delete process.env.SMTP_PASS;
    t.mock.method(User, "findOne", () => assert.fail("Database must not be queried"));
    const res = response();
    await forgotPassword({ body: { email } }, res);
    assert.equal(res.statusCode, 503);
});

test("forgot password stores a scoped HMAC and sends a six-digit code only to a verified account", async t => {
    environment(t);
    let saved;
    t.mock.method(User, "findOne", filter => {
        assert.deepEqual(filter, { email, isVerified: true });
        return query(user());
    });
    t.mock.method(crypto, "randomInt", (minimum, maximum) => {
        assert.equal(minimum, 100000);
        assert.equal(maximum, 1000000);
        return Number(otp);
    });
    t.mock.method(PasswordReset, "findOneAndUpdate", async (filter, update, options) => {
        saved = update.$set;
        assert.equal(filter.user, userId);
        assert.equal(saved.lastSentAt.getTime() - filter.lastSentAt.$lte.getTime(), 60000);
        assert.equal(saved.expiresAt.getTime() - saved.lastSentAt.getTime(), 300000);
        assert.equal(saved.attempts, 0);
        assert.deepEqual(options, { upsert: true, runValidators: true });
    });
    let delivered = 0;
    t.mock.method(nodemailer, "createTransport", settings => {
        assert.equal(settings.port, 587);
        assert.equal(settings.secure, false);
        assert.equal(settings.requireTLS, true);
        return { sendMail: async message => {
            delivered++;
            assert.equal(message.to, email);
            assert.equal(message.subject, "CODEFAMT password reset");
            assert.match(message.text, /123456/);
        } };
    });
    const res = response();
    await forgotPassword({ body: { email: " STUDENT@FAMT.AC.IN " } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(delivered, 1);
    assert.equal(saved.otpHash, record().otpHash);
    assert.equal(JSON.stringify(res.body).includes(otp), false);
    assert.notEqual(saved.otpHash, crypto.createHmac("sha256", process.env.OTP_SECRET).update(`${userId}:${otp}`).digest("hex"));
});

test("unknown account, cooldown and delivery failure return the same response", async t => {
    environment(t);
    let mode = "unknown";
    let sends = 0;
    t.mock.method(User, "findOne", () => query(mode === "unknown" ? null : user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", async () => {
        if (mode === "cooldown") {
            const error = new Error("private duplicate index");
            error.code = 11000;
            throw error;
        }
    });
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => {
        sends++;
        throw new Error("private mail provider details");
    } }));
    const logs = [];
    t.mock.method(console, "error", value => logs.push(value));
    const responses = [];
    for (mode of ["unknown", "cooldown", "delivery"]) {
        const res = response();
        await forgotPassword({ body: { email } }, res);
        assert.equal(res.statusCode, 200);
        responses.push(res.body);
    }
    assert.deepEqual(responses[0], responses[1]);
    assert.deepEqual(responses[1], responses[2]);
    assert.equal(sends, 1);
    assert.deepEqual(logs, ["Password reset email delivery failed"]);
});

test("concurrent reset-code requests reserve only one email delivery", async t => {
    environment(t);
    t.mock.method(User, "findOne", () => query(user()));
    let reserved = false;
    let sends = 0;
    t.mock.method(PasswordReset, "findOneAndUpdate", async () => {
        if (reserved) {
            const error = new Error("duplicate");
            error.code = 11000;
            throw error;
        }
        reserved = true;
    });
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => { sends++; } }));
    const responses = Array.from({ length: 6 }, response);
    await Promise.all(responses.map(res => forgotPassword({ body: { email } }, res)));
    assert.equal(sends, 1);
    assert.equal(responses.every(res => res.statusCode === 200), true);
});

test("reset rejects invalid email, OTP and password inputs before lookup", async t => {
    t.mock.method(User, "findOne", () => assert.fail("Database must not be queried"));
    for (const body of [null, {}, resetBody({ email: {} }), resetBody({ email: "student@example.com" }),
        resetBody({ otp: 123456 }), resetBody({ otp: "12345" }), resetBody({ otp: "1234567" }),
        resetBody({ newPassword: {} }), resetBody({ newPassword: "       " }),
        resetBody({ newPassword: "        " }), resetBody({ newPassword: "short" }),
        resetBody({ newPassword: "a".repeat(73) }), resetBody({ newPassword: "é".repeat(37) })]) {
        const res = response();
        await resetPassword({ body }, res);
        assert.equal(res.statusCode, 400);
    }
});

test("reset requires its HMAC secret before account lookup", async t => {
    environment(t);
    delete process.env.OTP_SECRET;
    t.mock.method(User, "findOne", () => assert.fail("Database must not be queried"));
    const res = response();
    await resetPassword({ body: resetBody() }, res);
    assert.equal(res.statusCode, 503);
});

test("unknown account and unavailable reset code have the same failure", async t => {
    environment(t);
    let existing = false;
    t.mock.method(User, "findOne", filter => {
        assert.deepEqual(filter, { email, isVerified: true });
        return query(existing ? user() : null);
    });
    t.mock.method(PasswordReset, "findOneAndUpdate", (filter, update, options) => {
        assert.equal(filter.user, userId);
        assert.ok(filter.expiresAt.$gt instanceof Date);
        assert.deepEqual(filter.attempts, { $lt: 5 });
        assert.deepEqual(update, { $inc: { attempts: 1 } });
        assert.deepEqual(options, { returnDocument: "after" });
        return query(null);
    });
    const missing = response();
    await resetPassword({ body: resetBody() }, missing);
    existing = true;
    const expired = response();
    await resetPassword({ body: resetBody() }, expired);
    assert.equal(missing.statusCode, 400);
    assert.equal(expired.statusCode, 400);
    assert.deepEqual(missing.body, expired.body);
});

test("incorrect and malformed stored OTP hashes never reach password hashing", async t => {
    environment(t);
    let storedHash = "";
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", () => query({ ...record(), otpHash: storedHash }));
    t.mock.method(bcrypt, "hash", () => assert.fail("Password must not be hashed"));
    for (storedHash of ["", "invalid", "0".repeat(64), undefined]) {
        const res = response();
        await resetPassword({ body: resetBody() }, res);
        assert.equal(res.statusCode, 400);
    }
});

test("parallel guesses cannot exceed five reserved attempts", async t => {
    environment(t);
    let attempts = 0;
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", filter => {
        assert.deepEqual(filter.attempts, { $lt: 5 });
        if (attempts >= 5) {
            return query(null);
        }
        attempts++;
        return query(record());
    });
    t.mock.method(bcrypt, "hash", () => assert.fail("Password must not be hashed"));
    const responses = Array.from({ length: 10 }, response);
    await Promise.all(responses.map(res => resetPassword({ body: resetBody({ otp: "999999" }) }, res)));
    assert.equal(attempts, 5);
    assert.equal(responses.every(res => res.statusCode === 400), true);
});

test("valid reset consumes its exact OTP and changes password with session revocation in one transaction", async t => {
    environment(t);
    const stored = record();
    const session = { id: "reset-session" };
    let consumed = false;
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", () => query(stored));
    t.mock.method(mongoose.connection, "transaction", async callback => callback(session));
    t.mock.method(PasswordReset, "findOneAndDelete", async (filter, options) => {
        assert.equal(filter._id, resetId);
        assert.equal(filter.otpHash, stored.otpHash);
        assert.equal(filter.lastSentAt, stored.lastSentAt);
        assert.ok(filter.expiresAt.$gt instanceof Date);
        assert.deepEqual(options, { session });
        consumed = true;
        return stored;
    });
    t.mock.method(User, "updateOne", async (filter, update, options) => {
        assert.equal(consumed, true);
        assert.deepEqual(filter, { _id: userId, isVerified: true, passwordHash: "old-password-hash", tokenVersion: 3 });
        assert.equal(await bcrypt.compare("new-valid-password", update.$set.passwordHash), true);
        assert.equal(bcrypt.getRounds(update.$set.passwordHash), 12);
        assert.deepEqual(Object.keys(update.$set), ["passwordHash"]);
        assert.deepEqual(update.$inc, { tokenVersion: 1 });
        assert.deepEqual(options, { session, runValidators: true });
        return { matchedCount: 1 };
    });
    const res = response();
    await resetPassword({ body: resetBody({ role: "admin", tokenVersion: 999 }) }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { message: "Password reset. Log in again" });
    assert.deepEqual(realtime.disconnectUser.mock.calls[0].arguments, [userId]);
});

test("OTP replacement or expiry during hashing prevents the password update", async t => {
    environment(t);
    const old = record();
    const replacement = { ...old, lastSentAt: new Date(old.lastSentAt.getTime() + 60000) };
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", () => query(old));
    t.mock.method(bcrypt, "hash", async () => "new-hash");
    t.mock.method(mongoose.connection, "transaction", async callback => callback({}));
    t.mock.method(PasswordReset, "findOneAndDelete", async filter => {
        assert.equal(filter.lastSentAt, old.lastSentAt);
        assert.notEqual(filter.lastSentAt, replacement.lastSentAt);
        return null;
    });
    t.mock.method(User, "updateOne", () => assert.fail("Password must not be updated"));
    const res = response();
    await resetPassword({ body: resetBody() }, res);
    assert.equal(res.statusCode, 400);
});

test("parallel submissions of one reset code can change the password only once", async t => {
    environment(t);
    const stored = record();
    let available = true;
    let updates = 0;
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", () => query({ ...stored }));
    t.mock.method(bcrypt, "hash", async () => "new-hash");
    t.mock.method(mongoose.connection, "transaction", async callback => callback({}));
    t.mock.method(PasswordReset, "findOneAndDelete", async () => {
        if (!available) {
            return null;
        }
        available = false;
        return stored;
    });
    t.mock.method(User, "updateOne", async () => { updates++; return { matchedCount: 1 }; });
    const responses = Array.from({ length: 5 }, response);
    await Promise.all(responses.map(res => resetPassword({ body: resetBody() }, res)));
    assert.equal(updates, 1);
    assert.equal(responses.filter(res => res.statusCode === 200).length, 1);
    assert.equal(responses.filter(res => res.statusCode === 400).length, 4);
});

test("a concurrent password or token change aborts and rolls back OTP consumption", async t => {
    environment(t);
    const stored = record();
    let available = true;
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", () => query(stored));
    t.mock.method(bcrypt, "hash", async () => "new-hash");
    t.mock.method(mongoose.connection, "transaction", async callback => {
        try {
            return await callback({});
        } catch (error) {
            available = true;
            throw error;
        }
    });
    t.mock.method(PasswordReset, "findOneAndDelete", async () => { available = false; return stored; });
    t.mock.method(User, "updateOne", async filter => {
        assert.equal(filter.tokenVersion, 3);
        assert.equal(filter.passwordHash, "old-password-hash");
        return { matchedCount: 0 };
    });
    const res = response();
    await resetPassword({ body: resetBody() }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(available, true);
});

test("transaction failure rolls back OTP deletion and hides database details", async t => {
    environment(t);
    const stored = record();
    let available = true;
    t.mock.method(User, "findOne", () => query(user()));
    t.mock.method(PasswordReset, "findOneAndUpdate", () => query(stored));
    t.mock.method(bcrypt, "hash", async () => "new-hash");
    t.mock.method(mongoose.connection, "transaction", async callback => {
        try {
            return await callback({});
        } catch (error) {
            available = true;
            throw error;
        }
    });
    t.mock.method(PasswordReset, "findOneAndDelete", async () => { available = false; return stored; });
    t.mock.method(User, "updateOne", async () => { throw new Error("private database connection string"); });
    const res = response();
    await resetPassword({ body: resetBody() }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(available, true);
    assert.equal(JSON.stringify(res.body).includes("private"), false);
});

test("forgot password hides unexpected database errors", async t => {
    environment(t);
    t.mock.method(User, "findOne", () => { throw new Error("private database details"); });
    const res = response();
    await forgotPassword({ body: { email } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.stringify(res.body).includes("private"), false);
});
