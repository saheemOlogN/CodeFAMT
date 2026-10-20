function judgeResults(results, testCases, problem) {
    const verdict = {
        status: "internal_error",
        passedTests: 0,
        totalTests: Array.isArray(testCases) ? testCases.length : 0,
        executionTimeMs: null,
        memoryUsedMb: null,
        errorMessage: "Unable to judge this submission. Try again later",
    };

    if (!Array.isArray(results) || !Array.isArray(testCases) || testCases.length === 0 ||
        results.length !== testCases.length || !problem ||
        !Number.isInteger(problem.timeLimitMs) || problem.timeLimitMs < 1 ||
        !Number.isInteger(problem.memoryLimitMb) || problem.memoryLimitMb < 1) {
        return verdict;
    }

    for (let index = 0; index < testCases.length; index++) {
        const result = results[index];
        const testCase = testCases[index];

        if (!testCase || typeof testCase.expectedOutput !== "string" ||
            !result || typeof result !== "object" || Array.isArray(result) ||
            !Object.hasOwn(result, "stdout") ||
            (result.stdout !== null && typeof result.stdout !== "string") ||
            (result.stderr !== undefined && result.stderr !== null && typeof result.stderr !== "string") ||
            (result.exception !== undefined && result.exception !== null && typeof result.exception !== "string")) {
            return verdict;
        }
    }

    verdict.status = "accepted";
    verdict.errorMessage = "";

    const messages = {
        wrong_answer: "Output did not match the expected result",
        time_limit_exceeded: "Time limit exceeded",
        memory_limit_exceeded: "Memory limit exceeded",
        runtime_error: "The program failed during execution",
        compilation_error: "The program could not be compiled",
        internal_error: "Unable to judge this submission. Try again later",
    };

    for (let index = 0; index < results.length; index++) {
        const result = results[index];
        const hasTime = Number.isFinite(result.executionTime) && result.executionTime >= 0;
        const hasMemory = Number.isFinite(result.memoryUsed) && result.memoryUsed >= 0;
        let status = "accepted";

        if (hasTime) {
            verdict.executionTimeMs = Math.max(verdict.executionTimeMs ?? 0, result.executionTime);
        }

        if (hasMemory) {
            verdict.memoryUsedMb = Math.max(verdict.memoryUsedMb ?? 0, result.memoryUsed / 1024);
        }

        if (result.exception) {
            if (/compil|syntax\s*error/i.test(result.exception)) {
                status = "compilation_error";
            } else if (/time\s*limit|timed?\s*out|timeout/i.test(result.exception)) {
                status = "time_limit_exceeded";
            } else if (/memory\s*limit|out\s*of\s*memory|memoryerror|bad_alloc/i.test(result.exception)) {
                status = "memory_limit_exceeded";
            } else {
                status = "runtime_error";
            }
        } else if (result.truncated || (result.exitCode !== undefined && result.exitCode !== 0) ||
            (result.stderr && result.exitCode !== 0)) {
            status = "runtime_error";
        } else if (!hasTime || !hasMemory) {
            status = "internal_error";
        } else if (result.executionTime > problem.timeLimitMs) {
            status = "time_limit_exceeded";
        } else if (result.memoryUsed / 1024 > problem.memoryLimitMb) {
            status = "memory_limit_exceeded";
        } else if ((result.stdout ?? "").replace(/\r\n/g, "\n").trimEnd() !==
            testCases[index].expectedOutput.replace(/\r\n/g, "\n").trimEnd()) {
            status = "wrong_answer";
        }

        if (status === "accepted") {
            verdict.passedTests++;
        } else if (status === "internal_error" || verdict.status === "accepted") {
            verdict.status = status;
            verdict.errorMessage = messages[status];
        }
    }

    return verdict;
}

module.exports = judgeResults;
