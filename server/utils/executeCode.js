const languages = {
    c: "main.c",
    cpp: "main.cpp",
    java: "Main.java",
    python: "main.py",
    javascript: "main.js",
};

async function executeCode({ language, code, inputs } = {}) {
    if (typeof language !== "string" || !Object.hasOwn(languages, language) ||
        typeof code !== "string" || !code.trim() || Buffer.byteLength(code, "utf8") > 50000 ||
        !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100 ||
        Array.from(inputs).some(input => typeof input !== "string" || Buffer.byteLength(input, "utf8") > 100000)) {
        const error = new Error("Provide a supported language, code, and 1 to 100 valid inputs");
        error.status = 400;
        throw error;
    }

    if (!process.env.ONECOMPILER_API_KEY) {
        const error = new Error("Code execution is not configured yet");
        error.status = 503;
        throw error;
    }

    try {
        const response = await fetch("https://api.onecompiler.org/v1/run", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": process.env.ONECOMPILER_API_KEY,
            },
            body: JSON.stringify({
                language,
                stdin: inputs,
                files: [{ name: languages[language], content: code }],
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            throw new Error("Execution request failed");
        }

        const results = await response.json();

        if (!Array.isArray(results) || results.length !== inputs.length) {
            throw new Error("Invalid execution results");
        }

        return Array.from(results).map(result => {
            if (!result || typeof result !== "object" || result.status !== "success" ||
                (result.error !== undefined && result.error !== null && result.error !== "") ||
                !Object.hasOwn(result, "stdout") ||
                (result.stdout !== null && typeof result.stdout !== "string") ||
                (result.stderr !== undefined && result.stderr !== null && typeof result.stderr !== "string") ||
                (result.exception !== undefined && result.exception !== null && typeof result.exception !== "string")) {
                throw new Error("Invalid execution result");
            }

            return {
                stdout: result.stdout,
                stderr: result.stderr ?? null,
                exception: result.exception ?? null,
                executionTime: Number.isFinite(result.executionTime) && result.executionTime >= 0
                    ? result.executionTime : null,
                memoryUsed: Number.isFinite(result.memoryUsed) && result.memoryUsed >= 0
                    ? result.memoryUsed : null,
            };
        });
    } catch {
        const error = new Error("Code execution is unavailable. Try again later");
        error.status = 503;
        throw error;
    }
}

module.exports = { executeCode, languages };
