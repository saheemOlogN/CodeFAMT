const test = require("node:test");
const assert = require("node:assert/strict");
const { executeCode } = require("../utils/executeCode");
const judgeResults = require("../utils/judgeResults");

test("OnlineCompiler.io executes every supported language and returns usable judging metrics", {
    skip: process.env.RUN_COMPILER_INTEGRATION !== "1",
    timeout: 180000,
}, async t => {
    const programs = {
        c: "#include <stdio.h>\nint main(void) { int a,b; scanf(\"%d %d\", &a, &b); printf(\"%d\\n\", a+b); return 0; }",
        cpp: "#include <iostream>\nint main() { int a,b; std::cin >> a >> b; std::cout << a+b << '\\n'; }",
        java: "import java.util.Scanner;\nclass Main { public static void main(String[] args) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt() + s.nextInt()); } }",
        python: "a, b = map(int, input().split())\nprint(a + b)",
        javascript: "const [a,b] = require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number); console.log(a+b);",
    };
    for (const [language, code] of Object.entries(programs)) {
        const results = await executeCode({ language, code, inputs: ["2 3"] });
        assert.equal(results[0].stdout.trim(), "5", language);
        assert.equal(results[0].exitCode, 0, language);
        assert.equal(judgeResults(results, [{ expectedOutput: "5" }], { timeLimitMs: 30000, memoryLimitMb: 1024 }).status, "accepted", language);
        t.diagnostic(`${language}: output 5, valid execution time and memory`);
    }
    const results = await executeCode({ language: "python", code: "print(", inputs: [""] });
    assert.equal(judgeResults(results, [{ expectedOutput: "" }], { timeLimitMs: 30000, memoryLimitMb: 1024 }).status, "compilation_error");
});
