const languages = {
    c: "gcc-15",
    cpp: "g++-15",
    java: "openjdk-25",
    python: "python-3.14",
    javascript: "nodejs-24",
};

async function executeCode({ language, code, inputs } = {}) {
    if (typeof language !== "string" || !Object.hasOwn(languages, language) ||
        typeof code !== "string" || !code.trim() || code.includes("\0") || Buffer.byteLength(code, "utf8") > 50000 ||
        !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100 ||
        Array.from(inputs).some(input => typeof input !== "string" || input.includes("\0") || Buffer.byteLength(input, "utf8") > 100000)) {
        const error = new Error("Provide a supported language, code, and 1 to 100 valid inputs without NUL characters");
        error.status = 400;
        throw error;
    }

    if (!process.env.ONLINECOMPILER_API_KEY) {
        const error = new Error("Code execution is not configured yet");
        error.status = 503;
        throw error;
    }

    try {
        const results = [];
        const deadline = AbortSignal.timeout(120000);

        for (const input of inputs) {
            deadline.throwIfAborted();
            const response = await fetch("https://api.onlinecompiler.io/api/run-code-sync/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: process.env.ONLINECOMPILER_API_KEY,
                },
                body: JSON.stringify({ compiler: languages[language], code, input }),
                signal: AbortSignal.any([deadline, AbortSignal.timeout(35000)]),
            });

            if (!response.ok) {
                const error = new Error("Execution request failed");
                error.permanent = [400, 401, 403, 404, 422].includes(response.status);
                const retryAfter = Number(response.headers?.get("retry-after"));
                if (response.status === 429) error.retryAfterMs = Math.min(300000, Math.max(60000, retryAfter * 1000 || 0));
                throw error;
            }

            const result = await response.json();

            if (!result || typeof result !== "object" || Array.isArray(result) ||
                !["success", "error"].includes(result.status) ||
                typeof result.output !== "string" || typeof result.error !== "string" ||
                !Number.isInteger(result.exit_code) || result.exit_code < 0 ||
                (result.signal !== null && (!Number.isInteger(result.signal) || result.signal < 1)) ||
                typeof result.truncated !== "boolean" ||
                (result.status === "error" && result.exit_code === 0 && result.signal === null)) {
                throw new Error("Invalid execution result");
            }

            const time = typeof result.time === "number" || (typeof result.time === "string" && result.time.trim())
                ? Number(result.time) : NaN;
            const memory = typeof result.memory === "number" || (typeof result.memory === "string" && result.memory.trim())
                ? Number(result.memory) : NaN;
            let exception = null;

            if (result.exit_code === 124) {
                exception = "Time limit exceeded";
            } else if (result.truncated) {
                exception = "Output limit exceeded";
            } else if (result.signal !== null) {
                exception = "Program stopped by signal " + result.signal;
            } else if (result.exit_code !== 0 && /SyntaxError|IndentationError|compilation failed|code\.(?:c|cc):\d+(?::\d+)?: (?:fatal )?error:/i.test(result.error)) {
                exception = "Compilation error";
            } else if (result.exit_code !== 0 && /OutOfMemoryError|MemoryError|std::bad_alloc/i.test(result.error)) {
                exception = "Memory limit exceeded";
            } else if (result.exit_code !== 0) {
                exception = "Program exited with code " + result.exit_code;
            }

            results.push({
                stdout: result.output,
                stderr: result.error || null,
                exception,
                exitCode: result.exit_code,
                executionTime: Number.isFinite(time * 1000) && time >= 0 ? time * 1000 : null,
                memoryUsed: Number.isFinite(memory) && memory >= 0 ? memory : null,
                truncated: result.truncated,
            });
        }

        return results;
    } catch (cause) {
        const error = new Error("Code execution is unavailable. Try again later");
        error.status = 503;
        if (cause.permanent) error.permanent = true;
        if (cause.retryAfterMs) error.retryAfterMs = cause.retryAfterMs;
        throw error;
    }
}

module.exports = { executeCode, languages };
