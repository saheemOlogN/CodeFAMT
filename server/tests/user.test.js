const assert = require("node:assert/strict");
const { test } = require("node:test");
const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const SolvedProblem = require("../models/solvedProblem.model");
const { getProfile, updateProfile, getSolvedProblems, changePassword } = require("../controllers/user.controller");

const userId = "507f1f77bcf86cd799439011";
const problemId = "507f1f77bcf86cd799439012";
const submissionId = "507f1f77bcf86cd799439013";
const createdAt = new Date("2026-10-18T10:00:00Z");

function user() {
    return {
        _id: userId,
        name: "Student",
        email: "student@famt.ac.in",
        department: "it",
        year: "2nd",
        role: "student",
        isVerified: true,
        tokenVersion: 3,
        passwordHash: "private-hash",
        createdAt,
    };
}

function request(values = {}) {
    return { user: user(), body: {}, query: {}, ...values };
}

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

function query(value) {
    return {
        select() { return this; },
        populate() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

test("profile exposes only safe fields and counts the authenticated student's solves", async t => {
    t.mock.method(SolvedProblem, "countDocuments", async filter => {
        assert.deepEqual(filter, { user: userId });
        return 5;
    });
    const res = response();
    await getProfile(request(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.user, {
        id: userId, name: "Student", email: "student@famt.ac.in", department: "it", year: "2nd",
        role: "student", createdAt, solvedCount: 5,
    });
});

test("profile updates only name, department and year despite privileged extra fields", async t => {
    const storedUser = user();
    let saved = false;
    storedUser.save = async () => { saved = true; };
    t.mock.method(User, "findById", id => {
        assert.equal(id, userId);
        return query(storedUser);
    });
    const res = response();
    await updateProfile(request({ body: {
        name: "New Name", department: "aiml", year: "3rd", role: "admin", email: "attacker@famt.ac.in",
        passwordHash: "attacker-hash", isVerified: false, tokenVersion: 999, _id: problemId,
    } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(storedUser.name, "New Name");
    assert.equal(storedUser.department, "aiml");
    assert.equal(storedUser.year, "3rd");
    assert.equal(storedUser.email, "student@famt.ac.in");
    assert.equal(storedUser.role, "student");
    assert.equal(storedUser.passwordHash, "private-hash");
    assert.equal(storedUser.isVerified, true);
    assert.equal(storedUser.tokenVersion, 3);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.tokenVersion, undefined);
});

test("invalid profile bodies cannot reach the database", async t => {
    t.mock.method(User, "findById", () => assert.fail("Database must not be called"));
    for (const body of [null, [], "name", 1, {}, { role: "admin" }, { name: " " }, { name: 1 },
        { department: { $ne: "it" } }, { year: ["1st"] }, { name: "Good", year: null }]) {
        const res = response();
        await updateProfile(request({ body }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("profile changes use schema department and year validation", async t => {
    t.mock.method(User, "findById", () => {
        const storedUser = new User(user());
        storedUser.save = async () => storedUser.validate();
        return query(storedUser);
    });
    for (const body of [{ department: "unknown" }, { year: "5th" }]) {
        const res = response();
        await updateProfile(request({ body }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("missing user during a profile update returns 404", async t => {
    t.mock.method(User, "findById", () => query(null));
    const res = response();
    await updateProfile(request({ body: { name: "New Name" } }), res);
    assert.equal(res.statusCode, 404);
});

test("solved history is paginated, owned by the student, and hides problem internals", async t => {
    const solvedAt = createdAt;
    t.mock.method(SolvedProblem, "find", filter => {
        assert.deepEqual(filter, { user: userId });
        const result = query([{
            _id: submissionId,
            user: userId,
            problem: { _id: problemId, title: "Sum", slug: "sum", difficulty: "easy", statement: "Private statement" },
            submission: submissionId,
            solvedAt,
        }]);
        result.select = fields => { assert.equal(fields, "problem submission solvedAt"); return result; };
        result.populate = (field, fields) => {
            assert.equal(field, "problem");
            assert.equal(fields, "title slug difficulty");
            return result;
        };
        result.sort = fields => { assert.deepEqual(fields, { solvedAt: -1, _id: -1 }); return result; };
        result.skip = value => { assert.equal(value, 20); return result; };
        result.limit = value => { assert.equal(value, 20); return result; };
        return result;
    });
    t.mock.method(SolvedProblem, "countDocuments", async filter => {
        assert.deepEqual(filter, { user: userId });
        return 21;
    });
    const res = response();
    await getSolvedProblems(request({ query: { page: "2" } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        solvedProblems: [{
            id: submissionId,
            problem: { id: problemId, title: "Sum", slug: "sum", difficulty: "easy" },
            submission: submissionId,
            solvedAt,
        }],
        page: 2,
        limit: 20,
        total: 21,
    });
});

test("solved history handles removed problems", async t => {
    t.mock.method(SolvedProblem, "find", () => query([{ _id: submissionId, problem: null, submission: submissionId, solvedAt: createdAt }]));
    t.mock.method(SolvedProblem, "countDocuments", async () => 1);
    const res = response();
    await getSolvedProblems(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.solvedProblems[0].problem, null);
});

test("solved history rejects invalid pagination and user filter injection", async t => {
    t.mock.method(SolvedProblem, "find", () => assert.fail("Database must not be called"));
    for (const filters of [{ user: problemId }, { page: "0" }, { page: "-1" }, { page: "1.5" },
        { page: "9007199254740992" }, { page: "9007199254740991", limit: "100" },
        { page: ["1"] }, { limit: "0" }, { limit: "101" }, { limit: { $gte: 1 } }]) {
        const res = response();
        await getSolvedProblems(request({ query: filters }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("password changes reject invalid bodies and password lengths before querying", async t => {
    t.mock.method(User, "findOne", () => assert.fail("Database must not be called"));
    for (const body of [null, [], "password", {}, { currentPassword: {}, newPassword: "valid-password" },
        { currentPassword: "short", newPassword: "valid-password" },
        { currentPassword: "valid-password", newPassword: "short" },
        { currentPassword: "a".repeat(73), newPassword: "valid-password" },
        { currentPassword: "valid-password", newPassword: "é".repeat(37) }]) {
        const res = response();
        await changePassword(request({ body }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("password changes require both the current password and current session version", async t => {
    const storedUser = { ...user(), passwordHash: await bcrypt.hash("correct-password", 4) };
    let exists = true;
    t.mock.method(User, "findOne", filter => {
        assert.deepEqual(filter, { _id: userId, tokenVersion: 3 });
        const result = query(exists ? storedUser : null);
        result.select = fields => { assert.equal(fields, "+passwordHash +tokenVersion"); return result; };
        return result;
    });
    t.mock.method(User, "updateOne", () => assert.fail("Password must not be updated"));
    const res = response();
    await changePassword(request({ body: { currentPassword: "wrong-password", newPassword: "new-password" } }), res);
    assert.equal(res.statusCode, 401);
    exists = false;
    const expiredRes = response();
    await changePassword(request({ body: { currentPassword: "correct-password", newPassword: "new-password" } }), expiredRes);
    assert.equal(expiredRes.statusCode, 401);
});

test("password changes hash with cost 12 and atomically revoke all previous sessions", async t => {
    const storedUser = { ...user(), passwordHash: await bcrypt.hash("correct-password", 4) };
    t.mock.method(User, "findOne", () => query(storedUser));
    t.mock.method(User, "updateOne", async (filter, update, options) => {
        assert.deepEqual(filter, { _id: userId, passwordHash: storedUser.passwordHash, tokenVersion: 3 });
        assert.equal(await bcrypt.compare("new-password", update.$set.passwordHash), true);
        assert.equal(bcrypt.getRounds(update.$set.passwordHash), 12);
        assert.deepEqual(update.$inc, { tokenVersion: 1 });
        assert.deepEqual(Object.keys(update.$set), ["passwordHash"]);
        assert.deepEqual(options, { runValidators: true });
        return { matchedCount: 1 };
    });
    const res = response();
    await changePassword(request({ body: {
        currentPassword: "correct-password", newPassword: "new-password", role: "admin", tokenVersion: 999,
    } }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { message: "Password changed. Log in again" });
});

test("a password or session change racing this request cannot be overwritten", async t => {
    const storedUser = { ...user(), passwordHash: await bcrypt.hash("correct-password", 4) };
    t.mock.method(User, "findOne", () => query(storedUser));
    t.mock.method(bcrypt, "hash", async () => "replacement-hash");
    t.mock.method(User, "updateOne", async () => ({ matchedCount: 0 }));
    const res = response();
    await changePassword(request({ body: { currentPassword: "correct-password", newPassword: "new-password" } }), res);
    assert.equal(res.statusCode, 409);
});

test("database failures return safe messages", async t => {
    const fail = () => { throw new Error("private database details"); };
    t.mock.method(SolvedProblem, "countDocuments", fail);
    t.mock.method(SolvedProblem, "find", fail);
    t.mock.method(User, "findById", fail);
    t.mock.method(User, "findOne", fail);
    for (const [controller, body] of [[getProfile, {}], [getSolvedProblems, {}],
        [updateProfile, { name: "New Name" }],
        [changePassword, { currentPassword: "correct-password", newPassword: "new-password" }]]) {
        const res = response();
        await controller(request({ body }), res);
        assert.equal(res.statusCode, 500);
        assert.equal(JSON.stringify(res.body).includes("private database"), false);
    }
});
