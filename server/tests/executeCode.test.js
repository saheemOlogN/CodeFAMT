const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");
const { executeCode, languages } = require("../utils/executeCode");

const originalFetch = global.fetch;
const originalKey = process.env.ONECOMPILER_API_KEY;

afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
        delete process.env.ONECOMPILER_API_KEY;
    } else {
        process.env.ONECOMPILER_API_KEY = originalKey;
    }
});

function setResults(results) {
    process.env.ONECOMPILER_API_KEY = "test-api-key";
    global.fetch = async () => ({ ok: true, json: async () => results });
}

const request = { language: "python", code: "print(input())", inputs: ["hello"] };

test("sends the documented API payload and preserves ordered outputs and metrics", async () => {
    process.env.ONECOMPILER_API_KEY = "test-api-key";
    global.fetch = async (url, options) => {
        assert.equal(url, "https://api.onecompiler.org/v1/run");
        assert.equal(options.method, "POST");
        assert.equal(options.headers["X-API-Key"], "test-api-key");
        assert.equal(options.headers["Content-Type"], "application/json");
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.signal.aborted, false);
        assert.deepEqual(JSON.parse(options.body), {
            language: "python",
            stdin: ["hello", "world"],
            files: [{ name: "main.py", content: request.code }],
        });
        return {
            ok: true,
            json: async () => [
                { status: "success", stdout: "hello\n", executionTime: 12, memoryUsed: 4096 },
                { status: "success", stdout: "world\n", executionTime: 20, memoryUsed: 8192 },
            ],
        };
    };

    assert.deepEqual(await executeCode({ ...request, inputs: ["hello", "world"] }), [
        { stdout: "hello\n", stderr: null, exception: null, executionTime: 12, memoryUsed: 4096 },
        { stdout: "world\n", stderr: null, exception: null, executionTime: 20, memoryUsed: 8192 },
    ]);
});

test("API success preserves incorrect output for the caller to judge", async () => {
    setResults([{ status: "success", stdout: "wrong output" }]);
    const [result] = await executeCode(request);
    assert.equal(result.stdout, "wrong output");
    assert.equal(result.status, undefined);
    assert.equal(result.executionTime, null);
    assert.equal(result.memoryUsed, null);
});

test("preserves execution errors and a legitimate null stdout", async () => {
    setResults([{
        status: "success",
        stdout: null,
        stderr: "SyntaxError: invalid syntax",
        exception: "Program exited with code 1",
    }]);
    assert.deepEqual(await executeCode(request), [{
        stdout: null,
        stderr: "SyntaxError: invalid syntax",
        exception: "Program exited with code 1",
        executionTime: null,
        memoryUsed: null,
    }]);
});

test("missing or invalid metrics stay null and valid zero metrics stay zero", async () => {
    setResults([
        { status: "success", stdout: "", executionTime: "12", memoryUsed: -1 },
        { status: "success", stdout: "", executionTime: Infinity, memoryUsed: NaN },
        { status: "success", stdout: "", executionTime: 0, memoryUsed: 0 },
    ]);
    const results = await executeCode({ ...request, inputs: ["", "", ""] });
    assert.deepEqual(results.map(result => [result.executionTime, result.memoryUsed]), [
        [null, null], [null, null], [0, 0],
    ]);
});

test("uses the expected source filename for each supported language", async () => {
    process.env.ONECOMPILER_API_KEY = "test-api-key";
    for (const [language, filename] of Object.entries(languages)) {
        global.fetch = async (url, options) => {
            assert.equal(JSON.parse(options.body).files[0].name, filename);
            return { ok: true, json: async () => [{ status: "success", stdout: "" }] };
        };
        await executeCode({ ...request, language });
    }
    assert.deepEqual(Object.keys(languages), ["c", "cpp", "java", "python", "javascript"]);
});

test("rejects a missing API key without making a request", async () => {
    delete process.env.ONECOMPILER_API_KEY;
    global.fetch = () => assert.fail("A request must not be made");
    await assert.rejects(executeCode(request), { status: 503, message: "Code execution is not configured yet" });
});

test("rejects unsupported and prototype language keys without making a request", async () => {
    global.fetch = () => assert.fail("A request must not be made");
    for (const language of ["ruby", "Python", "toString", "constructor", "__proto__", null, 1]) {
        await assert.rejects(executeCode({ ...request, language }), { status: 400 });
    }
});

test("rejects invalid code and enforces its UTF-8 byte limit", async () => {
    global.fetch = () => assert.fail("A request must not be made");
    for (const code of ["", " \n", null, 1, "a".repeat(50001), "é".repeat(25001)]) {
        await assert.rejects(executeCode({ ...request, code }), { status: 400 });
    }
});

test("rejects invalid input batches and enforces size limits", async () => {
    global.fetch = () => assert.fail("A request must not be made");
    for (const inputs of [null, "input", [], Array(1), Array(101).fill(""), [1], [null], ["a".repeat(100001)], ["é".repeat(50001)]]) {
        await assert.rejects(executeCode({ ...request, inputs }), { status: 400 });
    }
});

test("accepts values exactly at the configured limits", async () => {
    setResults(Array.from({ length: 100 }, () => ({ status: "success", stdout: "" })));
    const results = await executeCode({
        language: "javascript",
        code: "a".repeat(50000),
        inputs: Array(100).fill("a".repeat(100000)),
    });
    assert.equal(results.length, 100);
});

test("rejects failed statuses and provider errors even when status is success", async () => {
    for (const result of [
        { status: "failed", stdout: "" },
        { status: "success", stdout: "", error: "E001: operation timed out" },
        { status: "success", stdout: "", error: { code: "E001", message: "operation timed out" } },
    ]) {
        setResults([result]);
        await assert.rejects(executeCode(request), { status: 503 });
    }
});

test("rejects malformed results and mismatched result counts", async () => {
    for (const results of [
        null,
        {},
        [],
        Array(1),
        [{ status: "success", stdout: "" }, { status: "success", stdout: "" }],
        [null],
        [{ stdout: "" }],
        [{ status: "success" }],
        [{ status: "success", stdout: 0 }],
        [{ status: "success", stdout: "", stderr: {} }],
        [{ status: "success", stdout: "", exception: [] }],
    ]) {
        setResults(results);
        await assert.rejects(executeCode(request), { status: 503 });
    }
});

test("bounds each execution request to 30 seconds", async () => {
    const originalTimeout = AbortSignal.timeout;
    const signal = new AbortController().signal;
    AbortSignal.timeout = milliseconds => {
        assert.equal(milliseconds, 30000);
        return signal;
    };
    process.env.ONECOMPILER_API_KEY = "test-api-key";
    global.fetch = async (url, options) => {
        assert.equal(options.signal, signal);
        return { ok: true, json: async () => [{ status: "success", stdout: "" }] };
    };
    try {
        await executeCode(request);
    } finally {
        AbortSignal.timeout = originalTimeout;
    }
});

test("converts HTTP, timeout, network, and invalid JSON failures to safe errors", async () => {
    process.env.ONECOMPILER_API_KEY = "secret-not-for-client";
    for (const stub of [
        async () => ({ ok: false }),
        async () => { throw new DOMException("The operation was aborted", "TimeoutError"); },
        async () => { throw new Error("secret-not-for-client private source and input"); },
        async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } }),
    ]) {
        global.fetch = stub;
        await assert.rejects(executeCode(request), {
            status: 503,
            message: "Code execution is unavailable. Try again later",
        });
    }
});
