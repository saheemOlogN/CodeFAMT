const assert = require("node:assert/strict");
const { test, beforeEach, afterEach } = require("node:test");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const requireAuth = require("../middleware/auth.middleware");

const userId = "507f1f77bcf86cd799439011";
const secret = "middleware-test-secret";
const originalSecret = process.env.JWT_SECRET;

beforeEach(() => {
    process.env.JWT_SECRET = secret;
});

afterEach(() => {
    if (originalSecret === undefined) {
        delete process.env.JWT_SECRET;
    } else {
        process.env.JWT_SECRET = originalSecret;
    }
});

function token(payload = { version: 3 }, options = {}, key = secret) {
    return jwt.sign(payload, key, { algorithm: "HS256", subject: userId, expiresIn: "1h", ...options });
}

function request(authorization) {
    return { headers: { authorization } };
}

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test("missing and malformed authorization headers cannot reach the database", async t => {
    t.mock.method(User, "findById", () => assert.fail("Database must not be called"));
    for (const authorization of [undefined, null, 1, [], "", "Basic credentials", "Bearer", "bearer token", "Bearer "]) {
        const req = request(authorization);
        const res = response();
        await requireAuth(req, res, () => assert.fail("Authentication must fail"));
        assert.equal(res.statusCode, 401);
        assert.equal(req.user, undefined);
    }
});

test("missing JWT configuration returns 503 without querying users", async t => {
    delete process.env.JWT_SECRET;
    t.mock.method(User, "findById", () => assert.fail("Database must not be called"));
    const res = response();
    await requireAuth(request(`Bearer ${token()}`), res, () => assert.fail("Authentication must fail"));
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { message: "Login is not configured yet" });
});

test("invalid, expired, wrong-key and non-HS256 tokens are rejected before lookup", async t => {
    t.mock.method(User, "findById", () => assert.fail("Database must not be called"));
    for (const value of [
        "not-a-token",
        token({ version: 3 }, { expiresIn: -1 }),
        token({ version: 3 }, {}, "incorrect-secret"),
        token({ version: 3 }, { algorithm: "HS512" }),
        token({ version: 3 }, { algorithm: "none" }, null),
    ]) {
        const req = request(`Bearer ${value}`);
        const res = response();
        await requireAuth(req, res, () => assert.fail("Authentication must fail"));
        assert.equal(res.statusCode, 401);
        assert.deepEqual(res.body, { message: "Invalid or expired login token" });
        assert.equal(req.user, undefined);
    }
});

test("claims require an ObjectId subject and integer token version", async t => {
    t.mock.method(User, "findById", () => assert.fail("Database must not be called"));
    for (const value of [
        token({}),
        token({ version: "3" }),
        token({ version: 1.5 }),
        token({ version: -1 }),
        token({ version: Number.MAX_SAFE_INTEGER + 1 }),
        token({ version: null }),
        jwt.sign({ version: 3 }, secret, { algorithm: "HS256", subject: userId }),
        token({ version: 3 }, { subject: "invalid-user-id" }),
        jwt.sign({ version: 3 }, secret, { algorithm: "HS256", expiresIn: "1h" }),
    ]) {
        const req = request(`Bearer ${value}`);
        const res = response();
        await requireAuth(req, res, () => assert.fail("Authentication must fail"));
        assert.equal(res.statusCode, 401);
        assert.deepEqual(res.body, { message: "Invalid login token" });
        assert.equal(req.user, undefined);
    }
});

test("missing, unverified and version-mismatched accounts cannot authenticate", async t => {
    let storedUser;
    t.mock.method(User, "findById", id => {
        assert.equal(id, userId);
        return {
            select(fields) {
                assert.equal(fields, "+tokenVersion");
                return Promise.resolve(storedUser);
            },
        };
    });
    for (const value of [null, { _id: userId, isVerified: false, tokenVersion: 3 },
        { _id: userId, isVerified: true, tokenVersion: 4 }]) {
        storedUser = value;
        const req = request(`Bearer ${token()}`);
        const res = response();
        await requireAuth(req, res, () => assert.fail("Authentication must fail"));
        assert.equal(res.statusCode, 401);
        assert.deepEqual(res.body, { message: "Please log in again" });
        assert.equal(req.user, undefined);
    }
});

test("valid HS256 token attaches the verified database user and continues once", async t => {
    const storedUser = { _id: userId, name: "Student", role: "student", isVerified: true, tokenVersion: 3 };
    t.mock.method(User, "findById", id => {
        assert.equal(id, userId);
        return {
            select(fields) {
                assert.equal(fields, "+tokenVersion");
                return Promise.resolve(storedUser);
            },
        };
    });
    const req = request(`Bearer ${token({ version: 3, role: "admin" })}`);
    const res = response();
    let nextCalls = 0;
    await requireAuth(req, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(req.user, storedUser);
    assert.equal(req.user.role, "student");
    assert.equal(res.body, undefined);
});

test("database failures return a safe 500 response and do not continue", async t => {
    t.mock.method(User, "findById", () => ({
        select() { return Promise.reject(new Error("private connection credentials")); },
    }));
    const req = request(`Bearer ${token()}`);
    const res = response();
    await requireAuth(req, res, () => assert.fail("Authentication must fail"));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { message: "Could not check your login" });
    assert.equal(req.user, undefined);
});
