const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const SolvedProblem = require("../models/solvedProblem.model");
const { adminWrite } = require("../middleware/admin.middleware");

process.env.JWT_SECRET = "local-route-test-secret-only";
process.env.CLIENT_ORIGIN = "http://localhost:5173";
const app = require("../index");
const userId = "507f1f77bcf86cd799439011";
const problemId = "507f1f77bcf86cd799439012";
let server;
let base;
let user;

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function token() {
    return jwt.sign({ version: user.tokenVersion }, process.env.JWT_SECRET, { subject: userId, expiresIn: "1h" });
}

async function request(path, { method = "GET", body, auth, raw } = {}) {
    const headers = { "Content-Type": "application/json", Origin: process.env.CLIENT_ORIGIN };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: method === "GET" ? undefined : raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
}

test.before(async () => {
    await new Promise((resolve, reject) => {
        server = app.listen(0, "127.0.0.1", resolve);
        server.on("error", reject);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test.beforeEach((t) => {
    user = { _id: userId, name: "Student", email: "student@famt.ac.in", department: "it", year: "2nd",
        role: "student", isVerified: true, tokenVersion: 0, passwordHash: "private-hash" };
    t.mock.method(User, "findById", () => query(user));
});

test("every protected route rejects unauthenticated requests", async () => {
    const routes = [
        ["GET", "/api/users/me"], ["PATCH", "/api/users/me"], ["GET", "/api/users/me/solved"],
        ["PATCH", "/api/users/me/password"], ["POST", "/api/auth/logout"],
        ["GET", "/api/problems"], ["POST", "/api/problems"],
        ["GET", `/api/problems/${problemId}/tests`], ["POST", `/api/problems/${problemId}/tests`],
        ["PATCH", `/api/problems/${problemId}/tests/${problemId}`], ["DELETE", `/api/problems/${problemId}/tests/${problemId}`],
        ["GET", `/api/problems/${problemId}`], ["PATCH", `/api/problems/${problemId}`], ["DELETE", `/api/problems/${problemId}`],
        ["GET", "/api/contests"], ["POST", "/api/contests"],
        ["GET", `/api/contests/${problemId}`], ["PATCH", `/api/contests/${problemId}`], ["DELETE", `/api/contests/${problemId}`],
        ["POST", `/api/contests/${problemId}/join`], ["GET", `/api/contests/${problemId}/problems/${problemId}`],
        ["GET", `/api/contests/${problemId}/leaderboard`], ["GET", "/api/submissions"],
        ["POST", "/api/submissions/run"], ["POST", "/api/submissions"],
        ["GET", `/api/submissions/${problemId}`], ["POST", `/api/submissions/${problemId}/retry`],
    ];
    for (const [method, path] of routes) {
        const response = await request(path, { method });
        assert.equal(response.status, 401, `${method} ${path}`);
    }
});

test("students cannot reach admin problem, hidden test or contest endpoints", async () => {
    const auth = token();
    for (const [method, path] of [
        ["POST", "/api/problems"], ["PATCH", `/api/problems/${problemId}`], ["DELETE", `/api/problems/${problemId}`],
        ["GET", `/api/problems/${problemId}/tests`], ["POST", `/api/problems/${problemId}/tests`],
        ["PATCH", `/api/problems/${problemId}/tests/${problemId}`], ["DELETE", `/api/problems/${problemId}/tests/${problemId}`],
        ["POST", "/api/contests"], ["PATCH", `/api/contests/${problemId}`], ["DELETE", `/api/contests/${problemId}`],
    ]) {
        const response = await request(path, { method, auth, body: {} });
        assert.equal(response.status, 403, `${method} ${path}`);
    }
});

test("profile route returns the authenticated profile and configured browser origin", async (t) => {
    t.mock.method(SolvedProblem, "countDocuments", async filter => {
        assert.deepEqual(filter, { user: userId });
        return 3;
    });
    const response = await request("/api/users/me", { auth: token() });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.solvedCount, 3);
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.body.user.tokenVersion, undefined);
    assert.equal(response.headers.get("access-control-allow-origin"), process.env.CLIENT_ORIGIN);
});

test("an admin can read hidden tests through the nested route", async (t) => {
    user.role = "admin";
    t.mock.method(Problem, "exists", async () => ({ _id: problemId }));
    t.mock.method(TestCase, "find", filter => {
        assert.deepEqual(filter, { problem: problemId });
        return query([{ input: "2 3", expectedOutput: "5" }]);
    });
    t.mock.method(TestCase, "countDocuments", async () => 1);
    const response = await request(`/api/problems/${problemId}/tests`, { auth: token() });
    assert.equal(response.status, 200);
    assert.equal(response.body.testCases[0].expectedOutput, "5");
});

test("login issues a usable token and logout invalidates it", async (t) => {
    user.passwordHash = await bcrypt.hash("test-password", 4);
    t.mock.method(User, "findOne", () => query(user));
    t.mock.method(User, "updateOne", async (filter, update) => {
        assert.deepEqual(filter, { _id: userId });
        assert.deepEqual(update, { $inc: { tokenVersion: 1 } });
        user.tokenVersion++;
        return { matchedCount: 1 };
    });
    t.mock.method(SolvedProblem, "countDocuments", async () => 0);
    const login = await request("/api/auth/login", { method: "POST", body: { email: user.email, password: "test-password" } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.passwordHash, undefined);
    const auth = login.body.token;
    assert.equal((await request("/api/users/me", { auth })).status, 200);
    assert.equal((await request("/api/auth/logout", { method: "POST", auth })).status, 200);
    assert.equal((await request("/api/users/me", { auth })).status, 401);
});

test("JSON parsing rejects malformed and oversized bodies safely", async () => {
    const malformed = await request("/api/auth/login", { method: "POST", raw: "{" });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.message, "Request body must be valid JSON");
    const oversized = await request("/api/auth/login", { method: "POST", body: { data: "a".repeat(1024 * 1024) } });
    assert.equal(oversized.status, 413);
});

test("failed login attempts are limited per normalized email", async () => {
    for (let index = 0; index < 20; index++) {
        const response = await request("/api/auth/login", { method: "POST", body: { email: "limited@famt.ac.in" } });
        assert.equal(response.status, 400);
    }
    const response = await request("/api/auth/login", { method: "POST", body: { email: " LIMITED@FAMT.AC.IN " } });
    assert.equal(response.status, 429);
});

test("admin responses wait for commit and controller failures roll back", async (t) => {
    let committed = false;
    t.mock.method(require("mongoose").connection, "transaction", async callback => {
        await callback({});
        committed = true;
    });
    t.mock.method(require("../models/adminLock.model"), "updateOne", async () => ({ matchedCount: 1 }));
    const res = { status(code) { this.code = code; return this; }, json(body) {
        assert.equal(committed, this.code < 400);
        this.body = body;
        return this;
    } };
    await adminWrite(async (req, response) => response.status(201).json({ saved: true }))({}, res, error => { throw error; });
    assert.equal(res.code, 201);
    committed = false;
    await adminWrite(async (req, response) => response.status(409).json({ message: "Conflict" }))({}, res, error => { throw error; });
    assert.equal(res.code, 409);
    assert.equal(committed, false);
});
