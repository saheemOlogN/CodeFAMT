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
const CodeRun = require("../models/codeRun.model");
const queue = require("../utils/executionQueue");
const gradeSubmission = require("../utils/gradeSubmission");

const userId = new mongoose.Types.ObjectId();
const problemId = new mongoose.Types.ObjectId();
const contestId = new mongoose.Types.ObjectId();
const submissionId = new mongoose.Types.ObjectId();
const replacements = [];
const originalKey = process.env.ONLINECOMPILER_API_KEY;

function mock(target, key, value) {
    replacements.push([target, key, target[key]]);
    target[key] = value;
}

afterEach(() => {
    for (const [target, key, value] of replacements.reverse()) target[key] = value;
    replacements.length = 0;
    if (originalKey === undefined) delete process.env.ONLINECOMPILER_API_KEY;
    else process.env.ONLINECOMPILER_API_KEY = originalKey;
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

function providerResult(fields = {}) {
    return { status: "success", output: "expected\n", error: "", exit_code: 0, signal: null,
        truncated: false, time: "0.01", memory: "1024", ...fields };
}

function setup(results = [providerResult()]) {
    const state = {
        problem: { _id: problemId, visibility: "public", timeLimitMs: 1000, memoryLimitMb: 128 },
        tests: [{ input: "hidden input", expectedOutput: "expected" }],
        submission: null,
        solves: [],
        executions: 0,
        testLoads: 0,
        transactions: 0,
    };
    process.env.ONLINECOMPILER_API_KEY = "test-key";
    mock(queue, "enqueueSubmission", async () => {});
    mock(queue, "enqueueRun", async () => {});
    mock(CodeRun, "create", async fields => ({ _id: submissionId, ...fields }));
    mock(require("../utils/providerLimit"), "reserveProviderRun", async () => {});
    mock(require("../utils/realtime"), "publishSubmission", async () => {});
    mock(Problem, "findById", async () => state.problem);
    mock(TestCase, "find", () => {
        state.testLoads++;
        return query(state.tests);
    });
    mock(global, "fetch", async (url, options) => {
        state.executions++;
        state.providerBody = JSON.parse(options.body);
        return { ok: true, json: async () => results[0] };
    });
    mock(Submission, "create", async (fields) => {
        state.submission = { _id: submissionId, ...fields, toObject() { return { ...this }; } };
        return state.submission;
    });
    mock(Submission, "findOne", () => query(state.submission));
    mock(Submission, "findOneAndUpdate", (filter, update, options) => {
        assert.equal(String(filter._id), String(submissionId));
        if (!state.submission || state.submission.status !== filter.status) return query(null);
        Object.assign(state.submission, update.$set);
        if (update.$inc) state.submission.queueVersion = (state.submission.queueVersion || 0) + update.$inc.queueVersion;
        if (options.session) {
            const { code, ...safe } = state.submission;
            return query(safe);
        }
        return query(state.submission);
    });
    mock(Submission, "updateOne", async (filter, update) => {
        state.errorFilter = filter;
        if (state.submission?.status !== filter.status) return { matchedCount: 0 };
        Object.assign(state.submission, update.$set);
        return { matchedCount: 1 };
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

test("custom runs return queued IDs without executing code in the request", async () => {
    const state = setup();
    const res = response();
    await controller.runCode(request({ language: "python", code: "print(input())", input: "custom" }), res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.run.status, "queued");
    assert.equal(state.executions, 0);
    assert.equal(state.testLoads, 0);
});

test("run rejects hidden test selectors, unsupported languages and oversized UTF-8 code", async () => {
    const state = setup();
    for (const body of [
        { ...submissionBody() },
        { language: "constructor", code: "x" },
        { language: "python", code: "é".repeat(25001) },
        { language: "python", code: "x", input: "é".repeat(50001) },
        { language: "python", code: "x\0" },
        { language: "python", code: "x", input: "\0" },
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

test("NUL source and unexecutable hidden inputs are rejected before saving a submission", async () => {
    const state = setup();
    const invalidSource = response();
    await controller.submitCode(request({ ...submissionBody(), code: "x\0" }), invalidSource);
    assert.equal(invalidSource.statusCode, 400);
    state.tests = [{ input: "\0", expectedOutput: "" }];
    const invalidInput = response();
    await controller.submitCode(request(submissionBody()), invalidInput);
    assert.equal(invalidInput.statusCode, 503);
    assert.equal(state.submission, null);
    assert.equal(state.executions, 0);
});

test("a missing API key creates no submission and changes no retry state", async () => {
    const state = setup();
    delete process.env.ONLINECOMPILER_API_KEY;
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
    assert.equal(first.statusCode, 202);
    state.submission.status = "running";
    const judged = await gradeSubmission(state.submission, state.problem, state.tests);
    assert.equal(judged.status, "accepted");
    assert.equal(first.body.submission.code, undefined);
    assert.equal(state.submission.createdAt, req.receivedAt);
    assert.equal(state.submission.user, userId);
    assert.equal(state.solves.length, 1);
    assert.equal(state.testLoads, 1);
    assert.equal(JSON.stringify(first.body).includes("hidden input"), false);
    assert.equal(JSON.stringify(first.body).includes("expected"), false);

    const second = response();
    await controller.submitCode(request(submissionBody()), second);
    assert.equal(second.statusCode, 202);
    state.submission.status = "running";
    await gradeSubmission(state.submission, state.problem, state.tests);
    assert.equal(state.solves.length, 1);
});

test("provider success with incorrect output is wrong answer and adds no solve", async () => {
    const state = setup([providerResult({ output: "hidden wrong output" })]);
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 202);
    state.submission.status = "running";
    const judged = await gradeSubmission(state.submission, state.problem, state.tests);
    assert.equal(judged.status, "wrong_answer");
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
    assert.equal(res.statusCode, 202);
    assert.equal(state.submission.contest, contestId);
    assert.equal(state.submission.createdAt, req.receivedAt);
});

test("an unconfigured test set never creates a submission", async () => {
    const state = setup();
    for (const testCases of [[], Array(101).fill(state.tests[0]), [{ input: "x".repeat(100001), expectedOutput: "" }],
        [{ input: "", expectedOutput: "a".repeat(65537) }], [{ input: "", expectedOutput: "\0" }]]) {
        state.tests = testCases;
        const res = response();
        await controller.submitCode(request(submissionBody()), res);
        assert.equal(res.statusCode, 503);
        assert.equal(state.submission, null);
    }
});

test("queue outages retain durable submissions and return their IDs", async () => {
    const state = setup();
    mock(queue, "enqueueSubmission", async () => { throw new Error("Redis unavailable"); });
    const res = response();
    await controller.submitCode(request(submissionBody()), res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.submission._id, submissionId);
    assert.equal(state.submission.status, "queued");
    assert.equal(state.executions, 0);
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
    assert.equal(res.statusCode, 202);
    assert.equal(state.submission.createdAt, createdAt);
    assert.equal(state.submission.code, "original code");
    assert.equal(state.submission.queueVersion, 1);
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
    await assert.rejects(gradeSubmission(state.submission, state.problem, state.tests), { stale: true });
    assert.equal(state.submission.status, "accepted");
    assert.equal(state.errorFilter.status, "running");
});
