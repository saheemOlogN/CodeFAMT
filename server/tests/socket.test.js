const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const jwt = require("jsonwebtoken");
const { io: connect } = require("socket.io-client");
const User = require("../models/user.model");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const initializeSocket = require("../config/socket");
const redisConfig = require("../config/redis");
const { decode } = require("notepack.io");
const { setRealtimeServer, publishSubmission, publishRun, publishContest, disconnectUser, closeRealtime } = require("../utils/realtime");

const userId = "507f1f77bcf86cd799439011";
const secondUserId = "507f1f77bcf86cd799439012";
const contestId = "507f1f77bcf86cd799439013";
const secondContestId = "507f1f77bcf86cd799439014";
const problemId = "507f1f77bcf86cd799439015";
const submissionId = "507f1f77bcf86cd799439016";
const secret = "local-socket-test-secret";
const originalSecret = process.env.JWT_SECRET;
const originalOrigin = process.env.CLIENT_ORIGIN;
let io;
let base;
let clients;
let users;
let contests;
let participants;
let additionalServers;

function redisBus() {
    const connections = new Set();
    return () => {
        const connection = new EventEmitter();
        const channels = new Set();
        const patterns = new Set();
        connection.status = "wait";
        connection.connect = async () => { connection.status = "ready"; };
        connection.ping = async () => "PONG";
        connection.disconnect = () => { connections.delete(connection); };
        connection.subscribe = async (...names) => {
            for (const name of names.flat()) channels.add(name);
            return channels.size;
        };
        connection.psubscribe = async (...names) => {
            for (const name of names.flat()) patterns.add(name);
            return patterns.size;
        };
        connection.unsubscribe = async (...names) => {
            for (const name of names.flat()) channels.delete(name);
            return channels.size;
        };
        connection.punsubscribe = async (...names) => {
            for (const name of names.flat()) patterns.delete(name);
            return patterns.size;
        };
        connection.publish = async (channel, value) => {
            for (const other of connections) other.deliver(channel, value);
            return connections.size;
        };
        connection.deliver = (channel, value) => {
            const message = Buffer.isBuffer(value) ? value : Buffer.from(value);
            if (channels.has(channel)) connection.emit("messageBuffer", Buffer.from(channel), message);
            for (const pattern of patterns) {
                if (channel.startsWith(pattern.slice(0, -1))) {
                    connection.emit("pmessageBuffer", Buffer.from(pattern), Buffer.from(channel), message);
                }
            }
        };
        connections.add(connection);
        return connection;
    };
}

async function redisServer() {
    const server = http.createServer();
    const socketServer = await initializeSocket(server);
    additionalServers.push(socketServer);
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return { io: socketServer, url: `http://127.0.0.1:${server.address().port}` };
}

function query(value) {
    return {
        select() { return this; },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    };
}

function token(id = userId, options = {}, payload = { version: 0 }) {
    return jwt.sign(payload, secret, { subject: id, algorithm: "HS256", expiresIn: "1h", ...options });
}

function waitFor(socket, event) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, received);
            reject(new Error(`No ${event} event received`));
        }, 3000);
        function received(value) {
            clearTimeout(timer);
            resolve(value);
        }
        socket.once(event, received);
    });
}

function client(auth = { token: token() }, extra = {}) {
    const socket = connect(base, { transports: ["websocket"], auth, reconnection: false, autoConnect: false, ...extra });
    clients.push(socket);
    return socket;
}

async function connected(auth, extra) {
    const socket = client(auth, extra);
    const result = waitFor(socket, "connect");
    socket.connect();
    await result;
    return socket;
}

function acknowledge(socket, event, body) {
    return socket.timeout(3000).emitWithAck(event, body);
}

test.beforeEach(async t => {
    process.env.JWT_SECRET = secret;
    process.env.CLIENT_ORIGIN = "http://localhost:5173";
    clients = [];
    additionalServers = [];
    users = new Map([
        [userId, { _id: userId, isVerified: true, role: "student", tokenVersion: 0 }],
        [secondUserId, { _id: secondUserId, isVerified: true, role: "student", tokenVersion: 0 }],
    ]);
    contests = new Map([
        [contestId, { _id: contestId, status: "published", startTime: new Date(Date.now() + 60000) }],
        [secondContestId, { _id: secondContestId, status: "published" }],
    ]);
    participants = new Set([`${contestId}:${userId}`, `${contestId}:${secondUserId}`]);
    t.mock.method(User, "findById", id => query(users.get(String(id)) || null));
    t.mock.method(Contest, "findById", id => query(contests.get(String(id)) || null));
    t.mock.method(ContestParticipant, "exists", async filter => participants.has(`${filter.contest}:${filter.user}`) ? { _id: userId } : null);
    const server = http.createServer();
    io = await initializeSocket(server, { redis: false });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.afterEach(async () => {
    for (const socket of clients) socket.disconnect();
    await new Promise(resolve => io.close(resolve));
    for (const server of additionalServers) await new Promise(resolve => server.close(resolve));
    await closeRealtime();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalOrigin === undefined) delete process.env.CLIENT_ORIGIN;
    else process.env.CLIENT_ORIGIN = originalOrigin;
});

test("socket handshake rejects missing, invalid, expired and wrong-algorithm tokens", async () => {
    for (const auth of [{}, { token: "invalid" }, { token: token(userId, { expiresIn: -1 }) },
        { token: token(userId, { algorithm: "HS512" }) }, { token: token(userId, {}, { version: "0" }) }]) {
        const socket = client(auth);
        const rejected = waitFor(socket, "connect_error");
        socket.connect();
        assert.equal((await rejected).message, "Invalid or expired login token");
        assert.equal(socket.connected, false);
    }
});

test("unverified, revoked and deleted users cannot open a socket", async () => {
    for (const user of [null, { _id: userId, isVerified: false, tokenVersion: 0 },
        { _id: userId, isVerified: true, tokenVersion: 1 }]) {
        users.set(userId, user);
        const socket = client();
        const rejected = waitFor(socket, "connect_error");
        socket.connect();
        assert.equal((await rejected).message, "Invalid or expired login token");
    }
});

test("browser connections from an unconfigured origin are refused", async () => {
    const socket = client(undefined, { extraHeaders: { Origin: "https://untrusted.example" } });
    const rejected = waitFor(socket, "connect_error");
    socket.connect();
    assert.match((await rejected).message, /websocket error/);
});

test("verified students can subscribe before the contest starts after joining through HTTP", async () => {
    const socket = await connected(undefined, { extraHeaders: { Origin: process.env.CLIENT_ORIGIN } });
    const result = await acknowledge(socket, "contest:join", { contestId });
    assert.equal(result.success, true);
    assert.equal(result.contestId, contestId);
    assert.ok(Number.isFinite(Date.parse(result.serverNow)));
    assert.equal(result.problems, undefined);
    assert.ok(io.of("/").sockets.get(socket.id).rooms.has(`contest:${contestId}`));
});

test("contest subscriptions validate IDs and refuse unjoined, draft or cancelled contests", async () => {
    const socket = await connected();
    for (const body of [null, [], {}, { contestId: "wrong" }, { contestId, role: "admin" }]) {
        assert.equal((await acknowledge(socket, "contest:join", body)).success, false);
    }
    assert.equal((await acknowledge(socket, "contest:join", { contestId: secondContestId })).success, false);
    for (const status of ["draft", "cancelled"]) {
        contests.get(contestId).status = status;
        assert.equal((await acknowledge(socket, "contest:join", { contestId })).success, false);
    }
});

test("admin room access uses the database role rather than a token claim", async () => {
    contests.get(contestId).status = "draft";
    const student = await connected({ token: token(userId, {}, { version: 0, role: "admin" }) });
    assert.equal((await acknowledge(student, "contest:join", { contestId })).success, false);
    users.get(secondUserId).role = "admin";
    const admin = await connected({ token: token(secondUserId) });
    assert.equal((await acknowledge(admin, "contest:join", { contestId })).success, true);
});

test("submission events reach only their owner and omit source, hidden tests and raw errors", async () => {
    const owner = await connected();
    const other = await connected({ token: token(secondUserId) });
    const otherEvents = [];
    other.on("submission:updated", value => otherEvents.push(value));
    const received = waitFor(owner, "submission:updated");
    assert.equal(await publishSubmission({
        _id: submissionId, user: userId, problem: problemId, contest: contestId,
        language: "cpp", status: "accepted", passedTests: 2, totalTests: 2,
        code: "private source", input: "private input", expectedOutput: "private output", errorMessage: "private error",
    }), true);
    const event = await received;
    assert.deepEqual(event, { submission: {
        _id: submissionId, problem: problemId, contest: contestId, language: "cpp", status: "accepted", passedTests: 2, totalTests: 2,
    } });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(otherEvents, []);
});

test("accepted verdicts invalidate only the subscribed contest leaderboard", async () => {
    const first = await connected();
    const second = await connected({ token: token(secondUserId) });
    participants.add(`${secondContestId}:${secondUserId}`);
    await acknowledge(first, "contest:join", { contestId });
    await acknowledge(second, "contest:join", { contestId: secondContestId });
    const wrongRoomEvents = [];
    second.on("leaderboard:updated", value => wrongRoomEvents.push(value));
    const received = waitFor(first, "leaderboard:updated");
    await publishSubmission({ _id: submissionId, user: userId, problem: problemId, contest: contestId, status: "accepted" });
    assert.deepEqual(await received, { contestId });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(wrongRoomEvents, []);
});

test("custom execution updates contain only status metadata and reach only their owner", async () => {
    const owner = await connected();
    const other = await connected({ token: token(secondUserId) });
    const otherEvents = [];
    other.on("run:updated", value => otherEvents.push(value));
    const received = waitFor(owner, "run:updated");
    assert.equal(await publishRun({
        _id: submissionId, user: userId, language: "cpp", status: "completed",
        code: "private source", input: "private input", result: { stdout: "private output" }, errorMessage: "private error",
    }), true);
    assert.deepEqual(await received, { run: { _id: submissionId, status: "completed", language: "cpp" } });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(otherEvents, []);
});

test("contest updates are invalidations and leaving a contest removes its subscription", async () => {
    const socket = await connected();
    await acknowledge(socket, "contest:join", { contestId });
    const received = waitFor(socket, "contest:updated");
    await publishContest(contestId);
    assert.deepEqual(await received, { contestId });
    assert.deepEqual(await acknowledge(socket, "contest:leave", { contestId }), { success: true, contestId });
    assert.equal(io.of("/").sockets.get(socket.id).rooms.has(`contest:${contestId}`), false);
});

test("password changes and logout can disconnect all user devices without affecting other users", async () => {
    const first = await connected();
    const second = await connected();
    const other = await connected({ token: token(secondUserId) });
    const disconnected = Promise.all([waitFor(first, "disconnect"), waitFor(second, "disconnect")]);
    assert.equal(await disconnectUser(userId), true);
    await disconnected;
    assert.equal(first.connected, false);
    assert.equal(second.connected, false);
    assert.equal(other.connected, true);
});

test("a new contest subscription rechecks token revocation and disconnects stale login", async () => {
    const socket = await connected();
    users.get(userId).tokenVersion++;
    const disconnected = waitFor(socket, "disconnect");
    const result = await acknowledge(socket, "contest:join", { contestId });
    assert.equal(result.success, false);
    assert.equal(result.message, "Please log in again");
    await disconnected;
    assert.equal(socket.connected, false);
});

test("sockets disconnect when their login token expires", async () => {
    const socket = await connected({ token: token(userId, { expiresIn: 2 }) });
    await waitFor(socket, "disconnect");
    assert.equal(socket.connected, false);
});

test("periodic revalidation removes revoked users even without client messages", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const socket = await connected();
    const disconnected = waitFor(socket, "disconnect");
    users.get(userId).tokenVersion++;
    t.mock.timers.tick(15000);
    await disconnected;
    assert.equal(socket.connected, false);
});

test("many students can keep separate sockets and receive a shared contest update", async () => {
    const studentIds = Array.from({ length: 30 }, (_, index) => (1000 + index).toString(16).padStart(24, "0"));
    for (const id of studentIds) {
        users.set(id, { _id: id, isVerified: true, role: "student", tokenVersion: 0 });
        participants.add(`${contestId}:${id}`);
    }
    const sockets = await Promise.all(studentIds.map(id => connected({ token: token(id) })));
    const results = await Promise.all(sockets.map(socket => acknowledge(socket, "contest:join", { contestId })));
    assert.ok(results.every(result => result.success));
    const events = Promise.all(sockets.map(socket => waitFor(socket, "contest:updated")));
    await publishContest(contestId);
    assert.ok((await events).every(event => event.contestId === contestId));
    assert.equal(io.of("/").sockets.size, 30);
});

test("invalid publisher IDs cannot target arbitrary rooms", async () => {
    assert.equal(await publishSubmission({ _id: submissionId, user: "contest:all" }), false);
    assert.equal(await publishContest("*"), false);
    assert.equal(await disconnectUser("*"), false);
});

test("worker events use the shared Redis namespace and include only safe payloads", async t => {
    setRealtimeServer(null);
    const packets = [];
    let connections = 0;
    t.mock.method(redisConfig, "createRedisConnection", () => ({
        status: "wait",
        async connect() { connections++; },
        async publish(channel, payload) { packets.push({ channel, payload }); return 1; },
        disconnect() {},
    }));
    assert.equal(await publishSubmission({
        _id: submissionId, user: userId, problem: problemId, contest: contestId,
        status: "accepted", code: "secret source", expectedOutput: "secret expected output",
    }), true);
    assert.equal(connections, 1);
    assert.equal(packets.length, 2);
    const prefix = `${process.env.REDIS_PREFIX || "codefamt"}:socket.io`;
    assert.equal(packets[0].channel, `${prefix}#/#user:${userId}#`);
    assert.equal(packets[1].channel, `${prefix}#/#contest:${contestId}#`);
    const payload = decode(packets[0].payload);
    assert.deepEqual(payload[1].data, ["submission:updated", { submission: {
        _id: submissionId, problem: problemId, contest: contestId, status: "accepted",
    } }]);
    assert.equal(await disconnectUser(userId), true);
    assert.equal(packets[2].channel, `${prefix}-request#/#`);
    const disconnect = JSON.parse(packets[2].payload);
    assert.deepEqual(disconnect.opts.rooms, [`user:${userId}`]);
    assert.equal(disconnect.close, true);
});

test("a Redis publish failure is contained and a later event can reconnect", async t => {
    setRealtimeServer(null);
    let attempts = 0;
    let closed = 0;
    t.mock.method(redisConfig, "createRedisConnection", () => ({
        status: "wait",
        async connect() {},
        async publish() {
            attempts++;
            if (attempts === 1) throw new Error("Private Redis connection details");
            return 1;
        },
        disconnect() { closed++; },
    }));
    assert.equal(await publishContest(contestId), false);
    assert.equal(closed, 1);
    assert.equal(await publishContest(contestId), true);
    assert.equal(attempts, 2);
});

test("API and worker broadcasts cross two Socket.IO servers without leaking private events", async t => {
    t.mock.method(redisConfig, "createRedisConnection", redisBus());
    const first = await redisServer();
    const second = await redisServer();
    base = first.url;
    const firstDevice = await connected();
    base = second.url;
    const secondDevice = await connected();
    const other = await connected({ token: token(secondUserId) });
    await acknowledge(firstDevice, "contest:join", { contestId });
    await acknowledge(secondDevice, "contest:join", { contestId });
    setRealtimeServer(first.io);
    const contestEvents = Promise.all([
        waitFor(firstDevice, "contest:updated"),
        waitFor(secondDevice, "contest:updated"),
    ]);
    assert.equal(await publishContest(contestId), true);
    assert.deepEqual(await contestEvents, [{ contestId }, { contestId }]);
    setRealtimeServer(null);
    const otherEvents = [];
    other.on("submission:updated", value => otherEvents.push(value));
    const verdicts = Promise.all([
        waitFor(firstDevice, "submission:updated"),
        waitFor(secondDevice, "submission:updated"),
    ]);
    const leaderboards = Promise.all([
        waitFor(firstDevice, "leaderboard:updated"),
        waitFor(secondDevice, "leaderboard:updated"),
    ]);
    await publishSubmission({ _id: submissionId, user: userId, contest: contestId, status: "accepted" });
    assert.ok((await verdicts).every(value => value.submission.status === "accepted"));
    assert.deepEqual(await leaderboards, [{ contestId }, { contestId }]);
    const disconnected = Promise.all([
        waitFor(firstDevice, "disconnect"),
        waitFor(secondDevice, "disconnect"),
    ]);
    await disconnectUser(userId);
    await disconnected;
    assert.equal(other.connected, true);
    assert.deepEqual(otherEvents, []);
});

test("socket startup rejects failed Redis subscriptions", async t => {
    const createConnection = redisBus();
    t.mock.method(redisConfig, "createRedisConnection", () => {
        const connection = createConnection();
        connection.psubscribe = async () => { throw new Error("Subscription unavailable"); };
        return connection;
    });
    await assert.rejects(initializeSocket(http.createServer()), /Subscription unavailable/);
});

test("Redis unsubscribe failures do not reject socket shutdown", async t => {
    const createConnection = redisBus();
    t.mock.method(redisConfig, "createRedisConnection", () => {
        const connection = createConnection();
        connection.unsubscribe = async () => { throw new Error("Redis unavailable"); };
        connection.punsubscribe = async () => { throw new Error("Redis unavailable"); };
        return connection;
    });
    const server = await redisServer();
    await new Promise(resolve => server.io.close(resolve));
    additionalServers = [];
});

test("an older failed worker broadcast cannot disconnect a replacement Redis connection", async t => {
    setRealtimeServer(null);
    const failures = [];
    let created = 0;
    let replacementClosed = false;
    t.mock.method(redisConfig, "createRedisConnection", () => {
        const index = created++;
        return {
            status: "wait",
            async connect() {},
            publish() {
                return index === 0 ? new Promise((resolve, reject) => failures.push(reject)) : Promise.resolve(1);
            },
            disconnect() { if (index === 1) replacementClosed = true; },
        };
    });
    const first = publishContest(contestId);
    const second = publishContest(contestId);
    await new Promise(resolve => setImmediate(resolve));
    failures[0](new Error("First connection failed"));
    assert.equal(await first, false);
    assert.equal(await publishContest(contestId), true);
    failures[1](new Error("Previous publish failed later"));
    assert.equal(await second, false);
    assert.equal(replacementClosed, false);
    assert.equal(await publishContest(contestId), true);
    assert.equal(created, 2);
});
