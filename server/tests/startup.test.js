const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeServices } = require("../utils/startup");

test("services connect concurrently but readiness waits for every dependency", async () => {
    const started = [];
    const release = {};
    const services = Object.fromEntries(["database", "queue", "sockets"].map(name => [name, () => {
        started.push(name);
        return new Promise(resolve => { release[name] = resolve; });
    }]));
    let ready = false;
    const result = initializeServices(services, { log() {} }).then(value => { ready = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ["database", "queue", "sockets"]);
    release.queue("queue ready");
    release.sockets("socket server");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    release.database("database ready");
    assert.deepEqual(await result, ["database ready", "queue ready", "socket server"]);
});

test("an unavailable service fails startup without exposing its connection URL", async () => {
    await assert.rejects(initializeServices({ MongoDB: async () => {
        throw new Error("Cannot connect to mongodb://private:password@example.invalid");
    } }, { log() {} }), error => {
        assert.equal(error.name, "StartupError");
        assert.match(error.message, /MongoDB/);
        assert.doesNotMatch(error.message, /private|password|example/);
        return true;
    });
});

test("a service that never becomes ready has a bounded startup deadline", async () => {
    await assert.rejects(initializeServices({ Redis: () => new Promise(() => {}) }, {
        timeoutMs: 20, log() {},
    }), { name: "StartupTimeoutError", message: "Redis could not start. Check its connection and configuration. (Startup deadline exceeded)" });
});

test("MongoDB can have a longer deadline than other startup services", async () => {
    const result = await initializeServices({
        MongoDB: () => new Promise(resolve => setTimeout(() => resolve("connected"), 30)),
        Redis: async () => "ready",
    }, { timeoutMs: 10, timeouts: { MongoDB: 1000 }, log() {} });
    assert.deepEqual(result, ["connected", "ready"]);
});
