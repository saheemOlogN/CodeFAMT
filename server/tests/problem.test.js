const test = require("node:test");
const assert = require("node:assert/strict");
const Problem = require("../models/problem.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const Submission = require("../models/submission.model");
const problems = require("../controllers/problem.controller");
const tests = require("../controllers/testCase.controller");

const problemId = "507f1f77bcf86cd799439011";
const testId = "507f1f77bcf86cd799439012";
const userId = "507f1f77bcf86cd799439013";

function request(values = {}) {
    return { user: { _id: userId, role: "admin" }, params: { id: problemId, problemId }, query: {}, body: {}, ...values };
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
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function editable(t) {
    t.mock.method(Contest, "exists", async () => null);
    t.mock.method(Submission, "exists", async () => null);
}

test("students cannot use any problem or test mutation or inspect hidden tests", async () => {
    for (const controller of [problems.createProblem, problems.updateProblem, problems.deleteProblem,
        tests.createTestCase, tests.getTestCases, tests.updateTestCase, tests.deleteTestCase]) {
        const res = response();
        await controller(request({ user: { _id: userId, role: "student" } }), res);
        assert.equal(res.statusCode, 403);
    }
});

test("student lists enforce public visibility even when draft is requested", async (t) => {
    t.mock.method(Problem, "find", (filter) => {
        assert.deepEqual(filter, { visibility: "public" });
        const result = query([]);
        result.select = (fields) => {
            assert.equal(fields.includes("statement"), false);
            assert.equal(fields.includes("createdBy"), false);
            return result;
        };
        return result;
    });
    t.mock.method(Problem, "countDocuments", async (filter) => {
        assert.equal(filter.visibility, "public");
        return 0;
    });
    const res = response();
    await problems.getProblems(request({ user: { role: "student" }, query: { visibility: "draft" } }), res);
    assert.equal(res.statusCode, 200);
});

test("student detail lookup cannot fetch a draft or contest problem", async (t) => {
    t.mock.method(Problem, "findOne", (filter) => {
        assert.deepEqual(filter, { _id: problemId, visibility: "public" });
        const result = query(null);
        result.select = (fields) => {
            assert.equal(fields.includes("statement"), true);
            assert.equal(fields.includes("createdBy"), false);
            return result;
        };
        return result;
    });
    const res = response();
    await problems.getProblem(request({ user: { role: "student" } }), res);
    assert.equal(res.statusCode, 404);
});

test("problem query filters reject object injection and unbounded pagination", async () => {
    for (const filters of [{ difficulty: { $ne: "easy" } }, { tag: { $regex: ".*" } }, { limit: "101" },
        { limit: ["20"] }, { page: "1.5" }, { page: "9007199254740992" }, { search: "abc" }]) {
        const res = response();
        await problems.getProblems(request({ query: filters }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("invalid problem IDs return a client error", async () => {
    for (const controller of [problems.getProblem, problems.updateProblem, problems.deleteProblem]) {
        const res = response();
        await controller(request({ params: { id: "bad" } }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("new problems cannot forge a creator or bypass draft creation", async () => {
    for (const body of [{ createdBy: problemId }, { visibility: "public" }, { visibility: "contest" }]) {
        const res = response();
        await problems.createProblem(request({ body }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("create validates the schema and assigns the authenticated creator", async (t) => {
    t.mock.method(Problem.prototype, "save", async function () {
        await this.validate();
        return this;
    });
    const res = response();
    await problems.createProblem(request({ body: {
        title: "Sum", slug: "sum", statement: "Add two numbers", difficulty: "easy", inputFormat: "Two integers",
        outputFormat: "Their sum", constraints: "0 to 100", timeLimitMs: 1000, memoryLimitMb: 128,
    } }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.problem.visibility, "draft");
    assert.equal(String(res.body.problem.createdBy), userId);
});

test("publishing a problem without hidden tests fails", async (t) => {
    editable(t);
    t.mock.method(Problem, "findById", async () => ({ _id: problemId, visibility: "draft" }));
    t.mock.method(TestCase, "find", () => query([]));
    const res = response();
    await problems.updateProblem(request({ body: { visibility: "public" } }), res);
    assert.equal(res.statusCode, 400);
});

test("publishing accepts a valid empty-input and empty-output test", async (t) => {
    editable(t);
    let saved = false;
    t.mock.method(Problem, "findById", async () => ({
        _id: problemId, visibility: "draft", save: async () => { saved = true; },
    }));
    t.mock.method(TestCase, "find", () => query([{ input: "", expectedOutput: "" }]));
    const res = response();
    await problems.updateProblem(request({ body: { visibility: "public" } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
});

test("published and cancelled contest references freeze problem updates", async (t) => {
    t.mock.method(Problem, "findById", async () => ({ _id: problemId }));
    t.mock.method(Contest, "exists", async (filter) => {
        assert.deepEqual(filter, { "problems.problem": problemId, status: { $ne: "draft" } });
        return { _id: testId };
    });
    const res = response();
    await problems.updateProblem(request({ body: { title: "Changed" } }), res);
    assert.equal(res.statusCode, 409);
});

test("any submission freezes problem updates", async (t) => {
    t.mock.method(Problem, "findById", async () => ({ _id: problemId }));
    t.mock.method(Contest, "exists", async () => null);
    t.mock.method(Submission, "exists", async () => ({ _id: testId }));
    const res = response();
    await problems.updateProblem(request({ body: { title: "Changed" } }), res);
    assert.equal(res.statusCode, 409);
});

test("problem deletion rejects even draft contest references", async (t) => {
    t.mock.method(Problem, "findById", async () => ({ _id: problemId, visibility: "draft" }));
    t.mock.method(Contest, "exists", async (filter) => {
        assert.deepEqual(filter, { "problems.problem": problemId });
        return { _id: testId };
    });
    const res = response();
    await problems.deleteProblem(request(), res);
    assert.equal(res.statusCode, 409);
});

test("problem deletion cannot leave orphan test cases", async (t) => {
    editable(t);
    t.mock.method(Problem, "findById", async () => ({ _id: problemId, visibility: "draft" }));
    t.mock.method(TestCase, "exists", async () => ({ _id: testId }));
    const res = response();
    await problems.deleteProblem(request(), res);
    assert.equal(res.statusCode, 409);
});

test("test creation rejects non-string values, oversized data and forged ownership", async () => {
    for (const body of [{ input: 5, expectedOutput: "5" }, { input: "", expectedOutput: null },
        { input: "a".repeat(100001), expectedOutput: "" }, { input: "", expectedOutput: "", problem: testId }]) {
        const res = response();
        await tests.createTestCase(request({ body }), res);
        assert.equal(res.statusCode, 400);
    }
});

test("a missing problem cannot receive a test case", async (t) => {
    t.mock.method(Problem, "findById", async () => null);
    const res = response();
    await tests.createTestCase(request({ body: { input: "", expectedOutput: "" } }), res);
    assert.equal(res.statusCode, 404);
});

test("test creation accepts explicit empty strings", async (t) => {
    editable(t);
    t.mock.method(Problem, "findById", async () => ({ _id: problemId }));
    t.mock.method(TestCase, "countDocuments", async () => 0);
    t.mock.method(TestCase, "create", async (value) => {
        assert.deepEqual(value, { problem: problemId, input: "", expectedOutput: "" });
        return value;
    });
    const res = response();
    await tests.createTestCase(request({ body: { input: "", expectedOutput: "" } }), res);
    assert.equal(res.statusCode, 201);
});

test("test count is capped before execution batches become unbounded", async (t) => {
    editable(t);
    t.mock.method(Problem, "findById", async () => ({ _id: problemId }));
    t.mock.method(TestCase, "countDocuments", async () => 100);
    const res = response();
    await tests.createTestCase(request({ body: { input: "", expectedOutput: "" } }), res);
    assert.equal(res.statusCode, 400);
});

test("test listing explicitly retrieves hidden fields only after admin authorization", async (t) => {
    t.mock.method(Problem, "exists", async () => ({ _id: problemId }));
    t.mock.method(TestCase, "find", () => {
        const result = query([{ input: "secret", expectedOutput: "secret" }]);
        result.select = (fields) => {
            assert.equal(fields, "+input +expectedOutput");
            return result;
        };
        return result;
    });
    t.mock.method(TestCase, "countDocuments", async () => 1);
    const res = response();
    await tests.getTestCases(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.testCases[0].input, "secret");
});

test("a test cannot be updated through another problem's URL", async (t) => {
    t.mock.method(Problem, "exists", async () => ({ _id: problemId }));
    t.mock.method(TestCase, "findOne", (filter) => {
        assert.deepEqual(filter, { _id: testId, problem: problemId });
        return query(null);
    });
    const res = response();
    await tests.updateTestCase(request({ params: { id: testId, problemId }, body: { input: "new" } }), res);
    assert.equal(res.statusCode, 404);
});

test("submissions freeze hidden test updates", async (t) => {
    t.mock.method(Problem, "exists", async () => ({ _id: problemId }));
    t.mock.method(TestCase, "findOne", () => query({ _id: testId }));
    t.mock.method(Contest, "exists", async () => null);
    t.mock.method(Submission, "exists", async () => ({ _id: testId }));
    const res = response();
    await tests.updateTestCase(request({ params: { id: testId, problemId }, body: { input: "new" } }), res);
    assert.equal(res.statusCode, 409);
});

test("the last test of a published problem cannot be removed", async (t) => {
    editable(t);
    t.mock.method(Problem, "findById", async () => ({ _id: problemId, visibility: "public" }));
    t.mock.method(TestCase, "findOne", () => query({ _id: testId }));
    t.mock.method(TestCase, "countDocuments", async () => 1);
    const res = response();
    await tests.deleteTestCase(request({ params: { id: testId, problemId } }), res);
    assert.equal(res.statusCode, 409);
});

test("database failures do not expose internal messages", async (t) => {
    t.mock.method(Problem, "findById", async () => { throw new Error("private database connection details"); });
    const res = response();
    await problems.deleteProblem(request(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message.includes("private"), false);
});
