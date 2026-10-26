const { performance } = require("node:perf_hooks");

async function initializeServices(services, { timeoutMs = 15000, timeouts = {}, log = console.log } = {}) {
    return Promise.all(Object.entries(services).map(async ([name, initialize]) => {
        const started = performance.now();
        let timer;
        try {
            const result = await Promise.race([
                Promise.resolve().then(initialize),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error("Startup timed out")), timeouts[name] ?? timeoutMs);
                }),
            ]);
            log(`[startup] ${name} ready in ${((performance.now() - started) / 1000).toFixed(2)}s`);
            return result;
        } catch (error) {
            // Report only the service name; connection errors can contain credentials.
            const failure = new Error(`${name} could not start. Check its connection and configuration.`);
            failure.name = error.message === "Startup timed out" ? "StartupTimeoutError" : "StartupError";
            const codes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENODATA"];
            if (codes.includes(error.code)) failure.message += ` (${error.code})`;
            else if (error.code === 18) failure.message += " (Authentication failed)";
            else if (["MongooseServerSelectionError", "MongoServerSelectionError"].includes(error.name)) failure.message += " (Database server selection timed out)";
            else if (failure.name === "StartupTimeoutError") failure.message += " (Startup deadline exceeded)";
            throw failure;
        } finally {
            clearTimeout(timer);
        }
    }));
}

module.exports = { initializeServices };
