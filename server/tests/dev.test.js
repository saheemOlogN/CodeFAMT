const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { startDevelopment } = require("../dev");

function fixture(platform = "linux") {
    const host = Object.assign(new EventEmitter(), { platform, execPath: "node" });
    const calls = [];
    const children = [];
    const launch = (...args) => {
        calls.push(args);
        const child = Object.assign(new EventEmitter(), {
            pid: 100 + calls.length, exitCode: null, killed: false,
            kill() { this.killed = true; },
        });
        children.push(child);
        return child;
    };
    startDevelopment({ launch, host });
    return { host, calls, children };
}

test("development starts API and worker with environment and watch enabled", () => {
    const { calls } = fixture();
    assert.deepEqual(calls.map(call => call[1].at(-1)), ["index.js", "worker.js"]);
    for (const [, args, options] of calls) {
        assert.ok(args.includes("--watch"));
        assert.ok(args.includes("--env-file=.env"));
        assert.equal(options.stdio, "inherit");
    }
});

test("Ctrl+C stops both services only once", () => {
    const { host, children } = fixture();
    host.emit("SIGINT");
    host.emit("SIGTERM");
    assert.ok(children.every(child => child.killed));
    assert.equal(host.exitCode, 0);
});

test("Windows shutdown targets only the two owned process trees", () => {
    const { host, calls } = fixture("win32");
    host.emit("SIGINT");
    host.emit("SIGTERM");
    assert.deepEqual(calls.slice(2).map(call => call.slice(0, 2)), [
        ["taskkill", ["/pid", "101", "/T", "/F"]],
        ["taskkill", ["/pid", "102", "/T", "/F"]],
    ]);
});

test("a failed launcher stops the other service and reports failure", () => {
    const { host, children } = fixture();
    children[0].exitCode = 1;
    children[0].emit("exit", 1);
    assert.equal(children[1].killed, true);
    assert.equal(host.exitCode, 1);
});
