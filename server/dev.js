const { spawn } = require("node:child_process");

function startDevelopment({ launch = spawn, host = process } = {}) {
    const children = [];
    let stopping = false;

    function stop(code = 0) {
        if (stopping) return;
        stopping = true;
        host.exitCode = code;
        for (const child of children) {
            if (child.exitCode !== null) continue;
            // Windows does not forward termination to a watch process's child.
            if (host.platform === "win32" && child.pid) {
                launch("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                    stdio: "ignore", windowsHide: true,
                });
            } else {
                child.kill("SIGTERM");
            }
        }
    }

    for (const entry of ["index.js", "worker.js"]) {
        const child = launch(host.execPath, [
            "--watch", "--require=./config/compileCache.js", "--env-file=.env", entry,
        ], { cwd: __dirname, stdio: "inherit", windowsHide: true });
        children.push(child);
        child.once("error", () => {
            console.error(`[dev] Could not launch ${entry}`);
            stop(1);
        });
        child.once("exit", code => {
            if (!stopping) {
                console.error(`[dev] ${entry} stopped; stopping development services.`);
                stop(code || 1);
            }
        });
    }
    host.once("SIGINT", () => stop());
    host.once("SIGTERM", () => stop());
    return { stop };
}

if (require.main === module) startDevelopment();
module.exports = { startDevelopment };
