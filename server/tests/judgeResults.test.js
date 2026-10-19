const assert = require("node:assert/strict");
const { test } = require("node:test");
const judgeResults = require("../utils/judgeResults");

test("an incomplete provider result stays retryable even after an earlier wrong answer", () => {
    const result = judgeResults(
        [
            { stdout: "wrong", executionTime: 10, memoryUsed: 1024 },
            { stdout: "correct", executionTime: null, memoryUsed: null },
        ],
        [{ expectedOutput: "correct" }, { expectedOutput: "correct" }],
        { timeLimitMs: 1000, memoryLimitMb: 128 }
    );
    assert.equal(result.status, "internal_error");
});

const problem = { timeLimitMs: 1000, memoryLimitMb: 64 };
const testCases = [{ expectedOutput: "42" }];

function result(overrides = {}) {
    return {
        stdout: "42\n",
        stderr: null,
        exception: null,
        executionTime: 10,
        memoryUsed: 2048,
        ...overrides,
    };
}

test("accepts matching output and converts memory from KB to MB", () => {
    assert.deepEqual(judgeResults([result()], testCases, problem), {
        status: "accepted",
        passedTests: 1,
        totalTests: 1,
        executionTimeMs: 10,
        memoryUsedMb: 2,
        errorMessage: "",
    });
});

test("normalizes CRLF and trailing whitespace on both outputs", () => {
    const tests = [{ expectedOutput: "  a  b\r\nc\r\n\t " }];
    assert.equal(judgeResults([result({ stdout: "  a  b\nc\n " })], tests, problem).status, "accepted");
    assert.equal(judgeResults([result({ stdout: "  a  b\r\nc\r\n" })], tests, problem).status, "accepted");
});

test("preserves meaningful leading whitespace, internal spaces, and internal blank lines", () => {
    for (const [stdout, expectedOutput] of [
        [" 42", "42"],
        ["42", " 42"],
        ["a  b", "a b"],
        ["a\tb", "a b"],
        ["a\n\nb", "a\nb"],
        ["a \nb", "a\nb"],
    ]) {
        const verdict = judgeResults([result({ stdout })], [{ expectedOutput }], problem);
        assert.equal(verdict.status, "wrong_answer");
        assert.equal(verdict.passedTests, 0);
    }
});

test("supports empty output and a null empty stream with valid metrics", () => {
    for (const stdout of ["", "\r\n\t", null]) {
        assert.equal(judgeResults([result({ stdout })], [{ expectedOutput: "" }], problem).status, "accepted");
    }
});

test("does not treat API success as an accepted solution", () => {
    const verdict = judgeResults([result({ status: "success", stdout: "41" })], testCases, problem);
    assert.equal(verdict.status, "wrong_answer");
    assert.equal(verdict.passedTests, 0);
});

test("compares resource limits per test and reports peak resource use", () => {
    const results = [result({ executionTime: 800, memoryUsed: 65536 }), result({ executionTime: 1000, memoryUsed: 4096 })];
    const verdict = judgeResults(results, [...testCases, ...testCases], problem);
    assert.equal(verdict.status, "accepted");
    assert.equal(verdict.passedTests, 2);
    assert.equal(verdict.executionTimeMs, 1000);
    assert.equal(verdict.memoryUsedMb, 64);
});

test("enforces time limits even when output matches", () => {
    const verdict = judgeResults([result({ executionTime: 1000.01 })], testCases, problem);
    assert.equal(verdict.status, "time_limit_exceeded");
    assert.equal(verdict.passedTests, 0);
});

test("enforces memory limits after converting KB to MB", () => {
    const verdict = judgeResults([result({ memoryUsed: 65537 })], testCases, problem);
    assert.equal(verdict.status, "memory_limit_exceeded");
    assert.equal(verdict.passedTests, 0);
    assert.equal(verdict.memoryUsedMb, 65537 / 1024);
});

test("accepts finite zero metrics", () => {
    const verdict = judgeResults([result({ executionTime: 0, memoryUsed: 0 })], testCases, problem);
    assert.equal(verdict.status, "accepted");
    assert.equal(verdict.executionTimeMs, 0);
    assert.equal(verdict.memoryUsedMb, 0);
});

test("never accepts missing, negative, nonnumeric, or nonfinite metrics", () => {
    for (const field of ["executionTime", "memoryUsed"]) {
        for (const value of [undefined, null, -1, "10", NaN, Infinity, -Infinity, false, {}]) {
            const verdict = judgeResults([result({ [field]: value })], testCases, problem);
            assert.equal(verdict.status, "internal_error");
            assert.equal(verdict.passedTests, 0);
        }
    }
});

test("classifies compilation, timeout, memory, and runtime exceptions without requiring metrics", () => {
    for (const [exception, status] of [
        ["Compilation failed", "compilation_error"],
        ["SyntaxError: invalid syntax", "compilation_error"],
        ["Syntax error", "compilation_error"],
        ["Time limit exceeded", "time_limit_exceeded"],
        ["Execution timed out", "time_limit_exceeded"],
        ["Timeout", "time_limit_exceeded"],
        ["Memory limit exceeded", "memory_limit_exceeded"],
        ["Out of memory", "memory_limit_exceeded"],
        ["MemoryError", "memory_limit_exceeded"],
        ["std::bad_alloc", "memory_limit_exceeded"],
        ["Division by zero", "runtime_error"],
        ["Program exited with code 1", "runtime_error"],
        [" ", "runtime_error"],
    ]) {
        const verdict = judgeResults([result({ exception, executionTime: null, memoryUsed: null })], testCases, problem);
        assert.equal(verdict.status, status);
        assert.equal(verdict.passedTests, 0);
        assert.equal(verdict.executionTimeMs, null);
        assert.equal(verdict.memoryUsedMb, null);
    }
});

test("a matching output never overrides a nonempty exception or stderr", () => {
    for (const overrides of [
        { exception: "Runtime failure" },
        { stderr: "A warning on stderr" },
        { stderr: "SyntaxError: invalid syntax" },
        { stderr: "\n" },
        { stderr: "Runtime failure", executionTime: null, memoryUsed: null },
    ]) {
        const verdict = judgeResults([result(overrides)], testCases, problem);
        assert.equal(verdict.status, "runtime_error");
        assert.equal(verdict.passedTests, 0);
    }
});

test("retains the first failing test verdict while counting later passing tests", () => {
    const results = [
        result(),
        result({ stdout: "wrong" }),
        result({ exception: "Compilation failed" }),
        result(),
    ];
    const tests = Array.from({ length: 4 }, () => ({ expectedOutput: "42" }));
    const verdict = judgeResults(results, tests, problem);
    assert.equal(verdict.status, "wrong_answer");
    assert.equal(verdict.passedTests, 2);
    assert.equal(verdict.totalTests, 4);
    assert.equal(judgeResults(results.slice().reverse(), tests, problem).status, "compilation_error");
});

test("returns generic diagnostics without exposing hidden output or provider errors", () => {
    const secret = "hidden-input-9345";
    const tests = [{ expectedOutput: secret }];
    for (const overrides of [
        { stdout: `wrong-${secret}` },
        { exception: `Compilation failed ${secret}`, stderr: secret },
        { stderr: secret },
    ]) {
        const verdict = judgeResults([result(overrides)], tests, problem);
        assert.ok(verdict.errorMessage.length > 0);
        assert.equal(JSON.stringify(verdict).includes(secret), false);
        assert.deepEqual(Object.keys(verdict), [
            "status", "passedTests", "totalTests", "executionTimeMs", "memoryUsedMb", "errorMessage",
        ]);
    }
});

test("rejects empty, missing, sparse, and mismatched test batches", () => {
    for (const [results, tests] of [
        [[], []],
        [null, testCases],
        [{}, testCases],
        [[result()], null],
        [[result()], {}],
        [[], testCases],
        [[result(), result()], testCases],
        [Array(1), testCases],
        [[result()], Array(1)],
    ]) {
        const verdict = judgeResults(results, tests, problem);
        assert.equal(verdict.status, "internal_error");
        assert.equal(verdict.passedTests, 0);
    }
});

test("rejects malformed result fields before counting any test as passed", () => {
    for (const malformed of [
        null,
        "42",
        [],
        {},
        result({ stdout: undefined }),
        result({ stdout: 42 }),
        result({ stdout: {} }),
        result({ stderr: [] }),
        result({ exception: false }),
    ]) {
        const verdict = judgeResults([result(), malformed], [...testCases, ...testCases], problem);
        assert.equal(verdict.status, "internal_error");
        assert.equal(verdict.passedTests, 0);
    }
});

test("rejects missing or malformed expected outputs", () => {
    for (const testCase of [null, {}, { expectedOutput: null }, { expectedOutput: 42 }]) {
        assert.equal(judgeResults([result()], [testCase], problem).status, "internal_error");
    }
});

test("rejects missing, invalid, or fractional problem limits", () => {
    for (const invalidProblem of [undefined, null, {}, [], "problem"]) {
        assert.equal(judgeResults([result()], testCases, invalidProblem).status, "internal_error");
    }
    for (const field of ["timeLimitMs", "memoryLimitMb"]) {
        for (const value of [undefined, null, 0, -1, 1.5, "1000", NaN, Infinity]) {
            assert.equal(judgeResults([result()], testCases, { ...problem, [field]: value }).status, "internal_error");
        }
    }
});

test("judges without changing input objects", () => {
    const results = Object.freeze([Object.freeze(result())]);
    const tests = Object.freeze([Object.freeze({ expectedOutput: "42\r\n" })]);
    assert.equal(judgeResults(results, tests, Object.freeze({ ...problem })).status, "accepted");
    assert.equal(results[0].stdout, "42\n");
    assert.equal(tests[0].expectedOutput, "42\r\n");
});
