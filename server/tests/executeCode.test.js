const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const { executeCode, languages } = require("../utils/executeCode");
const judgeResults = require("../utils/judgeResults");

const originalFetch = global.fetch;
const originalKey = process.env.ONLINECOMPILER_API_KEY;
const request = { language: "python", code: "print(input())", inputs: ["hello"] };

afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ONLINECOMPILER_API_KEY;
    else process.env.ONLINECOMPILER_API_KEY = originalKey;
});

function result(fields = {}) {
    return { status: "success", output: "hello\n", error: "", exit_code: 0, signal: null,
        truncated: false, time: "0.0248", memory: "8192", ...fields };
}

function setResult(value) {
    process.env.ONLINECOMPILER_API_KEY = "test-api-key";
    global.fetch = async () => ({ ok: true, json: async () => value });
}

test("uses the native sync endpoint, bare Authorization key and compiler IDs", async () => {
    process.env.ONLINECOMPILER_API_KEY = "test-api-key";
    for (const [language, compiler] of Object.entries(languages)) {
        global.fetch = async (url, options) => {
            assert.equal(url, "https://api.onlinecompiler.io/api/run-code-sync/");
            assert.equal(options.method, "POST");
            assert.deepEqual(options.headers, { "Content-Type": "application/json", Authorization: "test-api-key" });
            assert.deepEqual(JSON.parse(options.body), { compiler, code: request.code, input: "hello" });
            assert.ok(options.signal instanceof AbortSignal);
            return { ok: true, json: async () => result() };
        };
        await executeCode({ ...request, language });
    }
    assert.deepEqual(languages, { c: "gcc-15", cpp: "g++-15", java: "openjdk-25", python: "python-3.14", javascript: "nodejs-24" });
});

test("runs inputs sequentially and preserves their order", async () => {
    process.env.ONLINECOMPILER_API_KEY = "test-api-key";
    const order = [];
    let active = 0;
    global.fetch = async (url, options) => {
        const { input } = JSON.parse(options.body);
        assert.equal(active++, 0);
        order.push(input);
        await Promise.resolve();
        active--;
        return { ok: true, json: async () => result({ output: input }) };
    };
    const results = await executeCode({ ...request, inputs: ["first", "second", "third"] });
    assert.deepEqual(order, ["first", "second", "third"]);
    assert.deepEqual(results.map(value => value.stdout), order);
});

test("converts seconds to milliseconds and keeps memory in KB", async () => {
    setResult(result());
    assert.deepEqual(await executeCode(request), [{
        stdout: "hello\n", stderr: null, exception: null, exitCode: 0,
        executionTime: 24.8, memoryUsed: 8192, truncated: false,
    }]);
});

test("missing and invalid metrics stay null while numeric zero remains valid", async () => {
    for (const value of [null, undefined, "", " ", false, {}, "bad", -1, "-1", Infinity]) {
        setResult(result({ time: value, memory: value }));
        const [output] = await executeCode(request);
        assert.equal(output.executionTime, null);
        assert.equal(output.memoryUsed, null);
    }
    for (const value of [0, "0"]) {
        setResult(result({ time: value, memory: value }));
        const [output] = await executeCode(request);
        assert.equal(output.executionTime, 0);
        assert.equal(output.memoryUsed, 0);
    }
});

test("program errors remain verdicts rather than provider failures", async () => {
    setResult(result({ status: "error", output: "", error: "SyntaxError: bad syntax", exit_code: 1, time: null, memory: null }));
    const [output] = await executeCode(request);
    assert.equal(output.stderr, "SyntaxError: bad syntax");
    assert.equal(output.exception, "Compilation error");
    assert.equal(output.exitCode, 1);
});

test("known timeout exits are time limits and ambiguous signals are not guessed as memory failures", async () => {
    setResult(result({ status: "error", exit_code: 124 }));
    assert.equal((await executeCode(request))[0].exception, "Time limit exceeded");
    setResult(result({ status: "error", exit_code: 137, signal: 9 }));
    assert.equal((await executeCode(request))[0].exception, "Program stopped by signal 9");
});

test("warnings on stderr with a zero exit code do not reject a correct solution", async () => {
    setResult(result({ error: "warning: unused variable" }));
    const results = await executeCode(request);
    const verdict = judgeResults(results, [{ expectedOutput: "hello" }], { timeLimitMs: 1000, memoryLimitMb: 128 });
    assert.equal(results[0].stderr, "warning: unused variable");
    assert.equal(verdict.status, "accepted");
});

test("nonzero exits cannot accept matching output even without stderr", async () => {
    setResult(result({ status: "error", exit_code: 1 }));
    const results = await executeCode(request);
    assert.equal(judgeResults(results, [{ expectedOutput: "hello" }], { timeLimitMs: 1000, memoryLimitMb: 128 }).status, "runtime_error");
});

test("truncated output can never accept a matching prefix", async () => {
    setResult(result({ truncated: true }));
    const results = await executeCode(request);
    assert.equal(results[0].truncated, true);
    assert.equal(judgeResults(results, [{ expectedOutput: "hello" }], { timeLimitMs: 1000, memoryLimitMb: 128 }).status, "runtime_error");
});

test("a missing new provider key fails before any request", async () => {
    delete process.env.ONLINECOMPILER_API_KEY;
    global.fetch = () => assert.fail("A request must not be made");
    await assert.rejects(executeCode(request), { status: 503, message: "Code execution is not configured yet" });
});

test("rejects unsupported languages and prototype keys", async () => {
    global.fetch = () => assert.fail("A request must not be made");
    for (const language of ["ruby", "Python", "toString", "constructor", "__proto__", null, 1]) {
        await assert.rejects(executeCode({ ...request, language }), { status: 400 });
    }
});

test("rejects invalid, oversized and NUL-containing source", async () => {
    global.fetch = () => assert.fail("A request must not be made");
    for (const code of ["", " \n", null, 1, "a".repeat(50001), "é".repeat(25001), "x\0y"]) {
        await assert.rejects(executeCode({ ...request, code }), { status: 400 });
    }
});

test("rejects invalid, oversized and NUL-containing inputs", async () => {
    global.fetch = () => assert.fail("A request must not be made");
    for (const inputs of [null, "input", [], Array(1), Array(101).fill(""), [1], [null],
        ["a".repeat(100001)], ["é".repeat(50001)], ["\0"]]) {
        await assert.rejects(executeCode({ ...request, inputs }), { status: 400 });
    }
});

test("accepts source and inputs at the configured byte limits", async () => {
    setResult(result());
    const results = await executeCode({ ...request, code: "a".repeat(50000), inputs: Array(100).fill("a".repeat(100000)) });
    assert.equal(results.length, 100);
});

test("rejects malformed or infrastructure-error responses", async () => {
    for (const value of [null, [], {}, { error: "private infrastructure details" },
        result({ status: "queued" }), result({ status: "error" }), result({ output: null }),
        result({ error: null }), result({ exit_code: undefined }), result({ exit_code: "0" }),
        result({ signal: undefined }), result({ signal: "9" }), result({ truncated: undefined }), result({ truncated: "false" })]) {
        setResult(value);
        await assert.rejects(executeCode(request), { status: 503 });
    }
});

test("bounds each call to 35 seconds and the complete input batch to two minutes", async (t) => {
    const durations = [];
    t.mock.method(AbortSignal, "timeout", milliseconds => {
        durations.push(milliseconds);
        return new AbortController().signal;
    });
    setResult(result());
    await executeCode({ ...request, inputs: ["one", "two"] });
    assert.deepEqual(durations, [120000, 35000, 35000]);
});

test("starts no more calls after the batch deadline", async (t) => {
    const controller = new AbortController();
    t.mock.method(AbortSignal, "timeout", () => controller.signal);
    let calls = 0;
    process.env.ONLINECOMPILER_API_KEY = "test-api-key";
    global.fetch = async () => {
        calls++;
        controller.abort();
        return { ok: true, json: async () => result() };
    };
    await assert.rejects(executeCode({ ...request, inputs: ["one", "two"] }), { status: 503 });
    assert.equal(calls, 1);
});

test("stops after a provider failure and keeps diagnostics private", async () => {
    process.env.ONLINECOMPILER_API_KEY = "test-api-key";
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return { ok: false, status: 429 };
    };
    await assert.rejects(executeCode({ ...request, inputs: ["one", "two"] }), {
        status: 503, message: "Code execution is unavailable. Try again later",
    });
    assert.equal(calls, 1);
});

test("handles HTTP, timeout, network and invalid JSON failures safely", async () => {
    process.env.ONLINECOMPILER_API_KEY = "private-test-key";
    for (const stub of [
        async () => ({ ok: false, status: 401 }),
        async () => { throw new DOMException("The operation was aborted", "TimeoutError"); },
        async () => { throw new Error("private-test-key and hidden input"); },
        async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } }),
    ]) {
        global.fetch = stub;
        await assert.rejects(executeCode(request), { status: 503, message: "Code execution is unavailable. Try again later" });
    }
});
