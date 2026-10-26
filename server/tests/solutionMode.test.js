require("node:test").beforeEach(t => { if (!process.env.RUN_LEADERBOARD_INTEGRATION) t.mock.method(Contest, "distinct", async () => []); });
const test = require("node:test");
const assert = require("node:assert/strict");
const { validDsa, publicProblem, buildExecutionCode } = require("../utils/solutionMode");
const Problem = require("../models/problem.model");
const CodeRun = require("../models/codeRun.model");
const Submission = require("../models/submission.model");
const TestCase = require("../models/testCase.model");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const queue = require("../utils/executionQueue");
const controller = require("../controllers/submission.controller");
const problemController = require("../controllers/problem.controller");
const id = "507f1f77bcf86cd799439011";
const config = { language: "cpp", starter: "int add(int a, int b) { return 0; }", prefix: "#include <bits/stdc++.h>", suffix: "int main() { return add(1, 2); }" };
const problem = { _id: id, visibility: "public", dsa: [config] };
function query(value) { return { select() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return Promise.resolve(value); }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } }; }
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(body) { return { body, params: { id }, user: { _id: id, role: "student" }, receivedAt: new Date() }; }

test("DSA configuration validates unique languages, source sizes and driver presence", () => {
    assert.ok(validDsa([config]));
    assert.ok(validDsa([]));
    for (const value of [null, {}, [config, config], [{ ...config, language: "__proto__" }], [{ ...config, prefix: "", suffix: "" }], [{ ...config, starter: "\0" }], [{ ...config, prefix: "x".repeat(20001) }], [{ ...config, extra: true }]]) assert.equal(Boolean(validDsa(value)), false);
});
test("CP is unchanged; DSA wraps exact source without interpreting dollar substitutions", () => {
    assert.equal(buildExecutionCode(problem, "cp", "cpp", "program"), "program");
    assert.equal(buildExecutionCode(problem, "dsa", "cpp", "$&"), `${config.prefix}\n$&\n${config.suffix}`);
    assert.throws(() => buildExecutionCode(problem, "dsa", "java", "source"), { status: 400 });
    assert.throws(() => buildExecutionCode(problem, "dsa", "cpp", "x".repeat(50000)), { status: 400 });
});
test("student problem responses contain starters but no driver", async t => {
    t.mock.method(Problem, "findOne", () => query(problem));
    const res = response();
    await problemController.getProblem(request({}), res);
    assert.deepEqual(res.body.problem.dsa, [{ language: "cpp", starter: config.starter }]);
    assert.equal(JSON.stringify(res.body).includes(config.prefix), false);
    assert.equal(publicProblem(problem).dsa[0].suffix, undefined);
    assert.equal(Problem.schema.path("dsa").options.select, false);
    assert.equal(Submission.schema.path("executionCode").options.select, false);
    assert.equal(CodeRun.schema.path("executionCode").options.select, false);
});
test("DSA run and submission save a private driver snapshot, returning only mode and source metadata", async t => {
    const oldKey = process.env.ONLINECOMPILER_API_KEY;
    process.env.ONLINECOMPILER_API_KEY = "test-key";
    t.after(() => { if (oldKey === undefined) delete process.env.ONLINECOMPILER_API_KEY; else process.env.ONLINECOMPILER_API_KEY = oldKey; });
    t.mock.method(Problem, "findById", () => query(problem));
    t.mock.method(TestCase, "find", () => query([{ input: "1 2", expectedOutput: "3" }]));
    t.mock.method(queue, "enqueueRun", async () => {});
    t.mock.method(queue, "enqueueSubmission", async () => {});
    for (const [Model, action] of [[CodeRun, controller.runCode], [Submission, controller.submitCode]]) {
        let saved;
        t.mock.method(Model, "create", async value => { saved = value; return { ...value, _id: id }; });
        const res = response();
        await action(request({ problemId: id, mode: "dsa", language: "cpp", code: "int add(int a,int b){return a+b;}" }), res);
        assert.equal(res.statusCode, 202);
        assert.equal(saved.mode, "dsa");
        assert.ok(saved.executionCode.includes(config.prefix));
        assert.ok(!saved.code.includes(config.prefix));
        assert.equal(JSON.stringify(res.body).includes("executionCode"), false);
    }
});
test("DSA runs reject unavailable modes, forged drivers and inaccessible problems", async t => {
    const oldKey = process.env.ONLINECOMPILER_API_KEY;
    process.env.ONLINECOMPILER_API_KEY = "test-key";
    t.after(() => { if (oldKey === undefined) delete process.env.ONLINECOMPILER_API_KEY; else process.env.ONLINECOMPILER_API_KEY = oldKey; });
    t.mock.method(Problem, "findById", () => query({ ...problem, visibility: "contest" }));
    t.mock.method(Contest, "exists", async () => null);
    for (const [body, status] of [
        [{ mode: "other" }, 400], [{ mode: "dsa" }, 400],
        [{ mode: "dsa", problemId: id, executionCode: "forged" }, 400],
        [{ mode: "dsa", problemId: id }, 404],
    ]) {
        const res = response();
        await controller.runCode(request({ language: "cpp", code: "source", ...body }), res);
        assert.equal(res.statusCode, status);
    }
});
test("contest DSA runs require an opened contest and membership", async t => {
    const oldKey = process.env.ONLINECOMPILER_API_KEY;
    process.env.ONLINECOMPILER_API_KEY = "test-key";
    t.after(() => { if (oldKey === undefined) delete process.env.ONLINECOMPILER_API_KEY; else process.env.ONLINECOMPILER_API_KEY = oldKey; });
    t.mock.method(Problem, "findById", () => query(problem));
    let contest = { _id: id, status: "published", startTime: new Date(Date.now() + 60000), problems: [{ problem: id }] };
    t.mock.method(Contest, "findById", async () => contest);
    t.mock.method(ContestParticipant, "exists", async () => null);
    for (const start of [new Date(Date.now() + 60000), new Date(0)]) {
        contest.startTime = start;
        const res = response();
        await controller.runCode(request({ problemId: id, contestId: id, mode: "dsa", language: "cpp", code: "source" }), res);
        assert.equal(res.statusCode, 403);
    }
});
