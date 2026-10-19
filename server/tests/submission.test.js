const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const mongoose = require("mongoose");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const Submission = require("../models/submission.model");
const SolvedProblem = require("../models/solvedProblem.model");
const controller = require("../controllers/submission.controller");
const gradeSubmission = require("../utils/gradeSubmission");

const userId = new mongoose.Types.ObjectId();
const problemId = new mongoose.Types.ObjectId();
const contestId = new mongoose.Types.ObjectId();
const submissionId = new mongoose.Types.ObjectId();
const replacements = [];
const originalKey = process.env.ONECOMPILER_API_KEY;

function mock(target, key, value) {
    replacements.push([target, key, target[key]]);
    target[key] = value;
}

afterEach(() => {
    for (const [target, key, value] of replacements.reverse()) target[key] = value;
    replacements.length = 0;
    if (originalKey === undefined) delete process.env.ONECOMPILER_API_KEY;
    else process.env.ONECOMPILER_API_KEY = originalKey;
});

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        lean() { return Promise.resolve(value); },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function request(body = {}) {
    return {
        params: { id: String(submissionId) },
        query: {},
        body,
        receivedAt: new Date(),
        user: { _id: userId, role: "student" },
    };
}

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

function submissionBody() {
    return { problemId: String(problemId), language: "python", code: "print(input())" };
}

function setup(results = [{ status: "success", stdout: "expected\n", executionTime: 10, memoryUsed: 1024 }]) {
    const state = {
        problem: { _id: problemId, visibility: "public", timeLimitMs: 1000, memoryLimitMb: 128 },
        tests: [{ input: "hidden input", expectedOutput: "expected" }],
        submission: null,
        solves: [],
        executions: 0,
        testLoads: 0,
        transactions: 0,
    };
    process.env.ONECOMPILER_API_KEY = "test-key";
    mock(Problem, "findById", async () => state.problem);
    mock(TestCase, "find", () => {
        state.testLoads++;
        return query(state.tests);
    });
    mock(global, "fetch", async (url, options) => {
        state.executions++;
        state.providerBody = JSON.parse(options.body);
        return { ok: true, json: async () => results };
    });
    mock(Submission, "create", async (fields) => {
        state.submission = { _id: submissionId, ...fields };
        return state.submission;
    });
    mock(Submission, "findOne", () => query(state.submission));
    mock(Submission, "findOneAndUpdate", (filter, update, options) => {
        assert.equal(String(filter._id), String(submissionId));
        if (!state.submission || state.submission.status !== filter.status) return query(null);
        Object.assign(state.submission, update.$set);
        if (options.session) {
            const { code, ...safe } = state.submission;
            return query(safe);
        }
        return query(state.submission);
    });
    mock(Submission, "updateOne", async (filter, update) => {
        state.errorFilter = filter;
        if (state.submission?.status === filter.status) Object.assign(state.submission, update.$set);
    });
    mock(mongoose.connection, "transaction", async (callback) => {
        state.transactions++;
        const previous = state.submission ? { ...state.submission } : null;
        const solves = [...state.solves];
        try {
            await callback({ id: "test-session" });
        } catch (error) {
            state.submission = previous;
            state.solves = solves;
            throw error;
        }
    });
    mock(SolvedProblem, "updateOne", async (filter, update, options) => {
        assert.equal(options.session.id, "test-session");
        assert.equal(options.upsert, true);
        assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
        if (!state.solves.some((entry) => String(entry.user) === String(filter.user) && String(entry.problem) === String(filter.problem))) {
            state.solves.push(update.$setOnInsert);
        }
    });
    return state;
}

test("run uses only custom input and returns custom diagnostics", async () => {
    const state = setup([{ status: "success", stdout: "hello", stderr: "custom diagnostic", executionTime: 5, memoryUsed: 1024 }]);
    const res = response();
    await controller.runCode(request({ language: "python", code: "print(input())", input: "custom" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.stderr, "custom diagnostic");
    assert.deepEqual(state.providerBody.stdin, ["custom"]);
    assert.equal(state.testLoads, 0);
    assert.equal(state.submission, null);
});

test("run rejects hidden test selectors, unsupported languages and oversized UTF-8 code", async () => {
    const state = setup();
    for (const body of [
        { ...submissionBody() },
        { language: "constructor", code: "x" },
        { language: "python", code: "é".repeat(25001) },
        { language: "python", code: "x", input: "é".repeat(50001) },
    ]) {
        const res = response();
        await controller.runCode(request(body), res);
        assert.equal(res.statusCode, 400);
    }
    assert.equal(state.executions, 0);
});

test("submission rejects client-owned verdicts and receipt timestamps", async () => {
    const state = setup();
    for (const field of ["user", "status", "createdAt", "score", "passedTests"]) {
        const res = response();
        await controller.submitCode(request({ ...submissionBody(), [field]: "forged" }), res);
        assert.equal(res.statusCode, 400);
    }
    assert.equal(state.submission, null);
});

test("a missing API key creates no submission and changes no retry state", async () => {
    const state = setup();
    delete process.env.ONECOMPILER_API_KEY;
    const submitted = response();
    const retried = response();
    await controller.submitCode(request(submissionBody()), submitted);
    await controller.retrySubmission(request(), retried);
    assert.equal(submitted.statusCode, 503);
    assert.equal(retried.statusCode, 503);
    assert.equal(state.submission, null);
    assert.equal(state.testLoads, 0);
});

test("accepted submission uses server receipt and creates one unique solve", async () => {
    const state = setup();
    const req = request(submissionBody());
    req.receivedAt = new Date(Date.now() - 1000);
    const first = response();
    await controller.submitCode(req, first);
    assert.equal(first.statusCode, 201);
    assert.equal(first.body.submission.status, "accepted");
    assert.equal(first.body.submission.code, undefined);
    assert.equal(state.submission.createdAt, req.receivedAt);
    assert.equal(state.submission.user, userId);
    assert.equal(state.solves.length, 1);
    assert.equal(state.testLoads, 1);
    assert.equal(JSON.stringify(first.body).includes("hidden input"), false);
    assert.equal(JSON.stringify(first.body).includes("expected"), false);

    const second = response();
    await controller.submitCode(request(submissionBody()), second);
    assert.equal(second.statusCode, 201);
    assert.equal(state.solves.length, 1);
});

test("provider success with incorrect output is wrong answer and adds no solve", async () => {
    const state = setup([{ status: "success", stdout: "hidden wrong output", executionTime: 5, memoryUsed: 1024 }]);
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.submission.status, "wrong_answer");
    assert.equal(state.solves.length, 0);
    assert.equal(JSON.stringify(res.body).includes("hidden wrong output"), false);
});

test("practice submissions cannot bypass contest visibility even for an admin", async () => {
    const state = setup();
    state.problem.visibility = "contest";
    const req = request(submissionBody());
    req.user.role = "admin";
    const res = response();
    await controller.submitCode(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(state.executions, 0);
});

test("contest submission requires membership before its server receipt", async () => {
    const state = setup();
    const req = request({ ...submissionBody(), contestId: String(contestId) });
    mock(Contest, "findById", async () => ({
        _id: contestId, status: "published", startTime: new Date(req.receivedAt - 1000),
        endTime: new Date(req.receivedAt.getTime() + 1000), problems: [{ problem: problemId }],
    }));
    mock(ContestParticipant, "exists", async (filter) => {
        assert.equal(filter.createdAt.$lte, req.receivedAt);
        return null;
    });
    const res = response();
    await controller.submitCode(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(state.executions, 0);
});

test("contest receipt at the end deadline is rejected", async () => {
    const state = setup();
    const req = request({ ...submissionBody(), contestId: String(contestId) });
    mock(Contest, "findById", async () => ({
        _id: contestId, status: "published", startTime: new Date(req.receivedAt - 1000),
        endTime: req.receivedAt, problems: [{ problem: problemId }],
    }));
    const res = response();
    await controller.submitCode(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(state.executions, 0);
});

test("receipt exactly at start is valid even if judging finishes after the deadline", async () => {
    const state = setup();
    const req = request({ ...submissionBody(), contestId: String(contestId) });
    req.receivedAt = new Date(Date.now() - 2000);
    mock(Contest, "findById", async () => ({
        _id: contestId, status: "published", startTime: req.receivedAt,
        endTime: new Date(req.receivedAt.getTime() + 1000), problems: [{ problem: problemId }],
    }));
    mock(ContestParticipant, "exists", async () => ({ _id: userId }));
    const res = response();
    await controller.submitCode(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(state.submission.contest, contestId);
    assert.equal(state.submission.createdAt, req.receivedAt);
});

test("an unconfigured test set never creates a submission", async () => {
    const state = setup();
    for (const testCases of [[], Array(101).fill(state.tests[0]), [{ input: "x".repeat(100001), expectedOutput: "" }]]) {
        state.tests = testCases;
        const res = response();
        await controller.submitCode(request(submissionBody()), res);
        assert.equal(res.statusCode, 503);
        assert.equal(state.submission, null);
    }
});

test("missing provider metrics produce a retryable safe internal error", async () => {
    const state = setup([{ status: "success", stdout: "expected" }]);
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.submissionId, submissionId);
    assert.equal(state.submission.status, "internal_error");
    assert.equal(state.solves.length, 0);
    assert.equal(state.transactions, 0);
});

test("provider failure does not expose diagnostics or lose the submission ID", async () => {
    const state = setup();
    mock(global, "fetch", async () => { throw new Error("private API key and hidden input"); });
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.submissionId, submissionId);
    assert.equal(state.submission.status, "internal_error");
    assert.equal(JSON.stringify(res.body).includes("private"), false);
});

test("failed solve persistence rolls back accepted status before marking internal error", async () => {
    const state = setup();
    mock(SolvedProblem, "updateOne", async () => { throw new Error("Database failure"); });
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 503);
    assert.equal(state.submission.status, "internal_error");
    assert.equal(state.solves.length, 0);
});

test("a competing first solve retries its transaction without executing code twice", async () => {
    const state = setup();
    let attempts = 0;
    mock(SolvedProblem, "updateOne", async () => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error("Duplicate solve"), { code: 11000 });
    });
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 201);
    assert.equal(state.transactions, 2);
    assert.equal(state.executions, 1);
    assert.equal(state.submission.status, "accepted");
});

test("an ambiguous commit failure cannot overwrite an accepted submission", async () => {
    const state = setup();
    mock(mongoose.connection, "transaction", async (callback) => {
        await callback({ id: "test-session" });
        throw new Error("Commit response unavailable");
    });
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 503);
    assert.equal(state.submission.status, "accepted");
    assert.equal(state.errorFilter.status, "running");
    assert.equal(state.solves.length, 1);
});

test("four active custom runs block a submission and slots release after completion", async () => {
    const state = setup();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    mock(global, "fetch", async () => {
        await gate;
        return { ok: true, json: async () => [{ status: "success", stdout: "expected", executionTime: 10, memoryUsed: 1024 }] };
    });
    const requests = Array.from({ length: 4 }, () => controller.runCode(request({ language: "python", code: "x" }), response()));
    const blocked = response();
    await controller.submitCode(request(submissionBody()), blocked);
    assert.equal(blocked.statusCode, 429);
    assert.equal(state.submission, null);
    release();
    await Promise.all(requests);
    const after = response();
    await controller.submitCode(request(submissionBody()), after);
    assert.equal(after.statusCode, 201);
});

test("retry preserves original code and contest receipt after the contest ends", async () => {
    const state = setup();
    const createdAt = new Date(Date.now() - 60000);
    state.submission = {
        _id: submissionId, user: userId, problem: problemId, contest: contestId,
        language: "python", code: "original code", status: "internal_error", createdAt,
    };
    mock(Contest, "findById", async () => ({
        _id: contestId, status: "published", startTime: new Date(createdAt - 1000),
        endTime: new Date(createdAt.getTime() + 1000), problems: [{ problem: problemId }],
    }));
    mock(ContestParticipant, "exists", async (filter) => {
        assert.equal(filter.user, userId);
        assert.equal(filter.createdAt.$lte, createdAt);
        return { _id: userId };
    });
    const res = response();
    await controller.retrySubmission(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.submission.createdAt, createdAt);
    assert.equal(state.providerBody.files[0].content, "original code");
    assert.equal(state.testLoads, 1);
});

test("retry rejects new source and rejects a submission already claimed", async () => {
    const state = setup();
    const changed = response();
    await controller.retrySubmission(request({ code: "replacement" }), changed);
    assert.equal(changed.statusCode, 400);

    state.submission = { _id: submissionId, user: userId, problem: problemId, status: "internal_error" };
    mock(Submission, "findOneAndUpdate", (filter) => {
        assert.equal(filter.status, "internal_error");
        return query(null);
    });
    const claimed = response();
    await controller.retrySubmission(request(), claimed);
    assert.equal(claimed.statusCode, 409);
    assert.equal(state.executions, 0);
});

test("individual submissions are scoped to their owner unless the requester is admin", async () => {
    mock(Submission, "findOne", (filter) => {
        assert.equal(filter.user, userId);
        return {
            select(fields) {
                assert.ok(fields.includes("+code"));
                assert.ok(fields.includes("+errorMessage"));
                return query(null);
            },
        };
    });
    const res = response();
    await controller.getSubmission(request(), res);
    assert.equal(res.statusCode, 404);
});

test("submission listing never accepts another user's ID or unbounded pagination", async () => {
    for (const queryValue of [{ user: String(userId) }, { limit: "101" }, { page: "1.5" }, { page: "9007199254740991", limit: "100" }]) {
        const req = request();
        req.query = queryValue;
        const res = response();
        await controller.getSubmissions(req, res);
        assert.equal(res.statusCode, 400);
    }
});

test("a lost running claim never changes the committed result", async () => {
    const state = setup();
    state.submission = { _id: submissionId, user: userId, problem: problemId, language: "python", code: "x", status: "accepted" };
    await assert.rejects(gradeSubmission(state.submission, state.problem, state.tests), { status: 409 });
    assert.equal(state.submission.status, "accepted");
    assert.equal(state.errorFilter, undefined);
});
