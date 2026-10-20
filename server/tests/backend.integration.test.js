const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { io: connectSocket } = require("socket.io-client");

test("live HTTP contest, compiler, transactions, Redis workers and cross-server sockets", {
    skip: process.env.RUN_BACKEND_INTEGRATION !== "1",
    timeout: 180000,
}, async t => {
    for (const key of ["MONGODB_URI", "REDIS_URL", "ONLINECOMPILER_API_KEY", "JWT_SECRET"]) {
        assert.ok(process.env[key], `Set ${key} before running the integration test`);
    }
    const namespace = `cf_test_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    process.env.REDIS_PREFIX = namespace;
    process.env.JUDGE_CONCURRENCY = "2";
    process.env.COMPILER_RUNS_PER_MINUTE = "30";
    const app = require("../index");
    const initializeSocket = require("../config/socket");
    const realtime = require("../utils/realtime");
    const redis = require("../config/redis");
    const queue = require("../utils/executionQueue");
    const { createWorker } = require("../workers/execution.worker");
    const User = require("../models/user.model");
    const AdminLock = require("../models/adminLock.model");
    const SolvedProblem = require("../models/solvedProblem.model");
    const sockets = [];
    const servers = [];
    const workers = [];
    let queueReady = false;

    async function request(base, path, token, method = "GET", body) {
        const response = await fetch(base + path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });
        return { status: response.status, body: await response.json() };
    }

    async function waitFor(check) {
        const deadline = Date.now() + 35000;
        while (Date.now() < deadline) {
            const result = await check();
            if (result) return result;
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        assert.fail("Timed out waiting for the live result");
    }

    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: namespace, serverSelectionTimeoutMS: 10000 });
        await Promise.all(Object.values(mongoose.models).map(model => model.init()));
        await AdminLock.create({ _id: "admin" });
        await queue.initializeQueue();
        queueReady = true;
        for (let index = 0; index < 2; index++) {
            const server = http.createServer(app);
            const io = await initializeSocket(server);
            servers.push({ server, io });
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        }
        const bases = servers.map(({ server }) => `http://127.0.0.1:${server.address().port}`);
        realtime.setRealtimeServer(null);
        const password = "integration-password";
        const passwordHash = await bcrypt.hash(password, 4);
        const users = await User.create(["admin", "first", "second"].map((name, index) => ({
            name, email: `${name}@famt.ac.in`, department: "it", year: "2nd", passwordHash,
            role: index === 0 ? "admin" : "student", isVerified: true,
        })));
        const tokens = [];
        for (const user of users) {
            const login = await request(bases[0], "/api/auth/login", null, "POST", { email: user.email, password });
            assert.equal(login.status, 200);
            tokens.push(login.body.token);
        }
        const created = await request(bases[0], "/api/problems", tokens[0], "POST", {
            title: "Add two numbers", slug: "add-two", statement: "Print the sum of two integers.",
            difficulty: "easy", inputFormat: "Two integers", outputFormat: "Their sum",
            constraints: "0 <= a, b <= 100", timeLimitMs: 2000, memoryLimitMb: 256,
        });
        assert.equal(created.status, 201);
        const problemId = created.body.problem._id;
        const added = await request(bases[0], `/api/problems/${problemId}/tests`, tokens[0], "POST", {
            input: "2 3", expectedOutput: "5",
        });
        assert.equal(added.status, 201);
        assert.equal((await request(bases[0], `/api/problems/${problemId}`, tokens[0], "PATCH", { visibility: "contest" })).status, 200);
        const startTime = new Date(Date.now() + 20000);
        const contestBody = { title: "Integration contest", startTime, endTime: new Date(startTime.getTime() + 60000),
            problems: [{ problem: problemId, points: 100 }] };
        const drafts = await Promise.all(bases.map(base => request(base, "/api/contests", tokens[0], "POST", contestBody)));
        assert.ok(drafts.every(result => result.status === 201));
        const published = await Promise.all(drafts.map((draft, index) => request(bases[index],
            `/api/contests/${draft.body.contest._id}`, tokens[0], "PATCH", { status: "published" })));
        assert.deepEqual(published.map(result => result.status).sort(), [200, 409]);
        const contestId = drafts[published.findIndex(result => result.status === 200)].body.contest._id;
        const ownerEvents = [[], []];
        const leaderboardEvents = [[], []];
        for (let index = 0; index < 2; index++) {
            assert.equal((await request(bases[index], `/api/contests/${contestId}/join`, tokens[index + 1], "POST", {})).status, 200);
            const socket = connectSocket(bases[index], { transports: ["websocket"], auth: { token: tokens[index + 1] }, reconnection: false });
            sockets.push(socket);
            await new Promise((resolve, reject) => {
                socket.once("connect", resolve);
                socket.once("connect_error", reject);
            });
            socket.on("submission:updated", event => ownerEvents[index].push(event.submission));
            socket.on("leaderboard:updated", event => leaderboardEvents[index].push(event.contestId));
            const joined = await socket.timeout(5000).emitWithAck("contest:join", { contestId });
            assert.equal(joined.success, true);
        }
        workers.push(createWorker(), createWorker());
        await new Promise(resolve => setTimeout(resolve, Math.max(0, startTime.getTime() - Date.now() + 20)));
        const code = "a, b = map(int, input().split())\nprint(a + b)";
        const submitted = await Promise.all([0, 0, 1].map(index => request(bases[index], "/api/submissions", tokens[index + 1],
            "POST", { problemId, contestId, language: "python", code })));
        assert.ok(submitted.every(result => result.status === 202));
        for (let index = 0; index < submitted.length; index++) {
            const owner = index === 2 ? 1 : 0;
            const id = submitted[index].body.submission._id;
            const final = await waitFor(async () => {
                const result = await request(bases[owner], `/api/submissions/${id}`, tokens[owner + 1]);
                return !["queued", "running"].includes(result.body.submission.status) && result.body.submission;
            });
            assert.equal(final.status, "accepted");
            assert.equal(final.passedTests, 1);
            assert.equal((await request(bases[1 - owner], `/api/submissions/${id}`, tokens[2 - owner])).status, 404);
        }
        await waitFor(() => ownerEvents[0].filter(event => event.status === "accepted").length === 2 &&
            ownerEvents[1].filter(event => event.status === "accepted").length === 1 &&
            leaderboardEvents.every(events => events.includes(contestId)));
        assert.equal(await SolvedProblem.countDocuments(), 2);
        const board = await request(bases[1], `/api/contests/${contestId}/leaderboard`, tokens[2]);
        assert.equal(board.status, 200);
        assert.equal(board.body.leaderboard.length, 2);
        assert.ok(board.body.leaderboard.every(row => row.score === 100 && row.solvedCount === 1));
        const run = await request(bases[0], "/api/submissions/run", tokens[1], "POST", { language: "python", code, input: "7 8" });
        assert.equal(run.status, 202);
        const runResult = await waitFor(async () => {
            const result = await request(bases[0], `/api/submissions/runs/${run.body.run._id}`, tokens[1]);
            return result.body.run.status === "completed" && result.body.run;
        });
        assert.equal(runResult.result.stdout.trim(), "15");
        assert.equal((await request(bases[1], `/api/submissions/runs/${run.body.run._id}`, tokens[2])).status, 404);
        assert.equal((await request(bases[1], "/api/auth/logout", tokens[1], "POST", {})).status, 200);
        await waitFor(() => !sockets[0].connected);
        assert.equal(sockets[1].connected, true);
        let mail;
        t.mock.method(require("nodemailer"), "createTransport", () => ({
            async sendMail(message) { mail = message; },
        }));
        const registration = { name: "New student", email: "new-student@famt.ac.in", password,
            department: "mechanical", year: "1st" };
        assert.equal((await request(bases[0], "/api/auth/register", null, "POST", registration)).status, 200);
        const verificationOtp = mail.text.match(/\b\d{6}\b/)[0];
        const verification = await request(bases[0], "/api/auth/verify-otp", null, "POST", { ...registration, otp: verificationOtp });
        assert.equal(verification.status, 200);
        const login = await request(bases[0], "/api/auth/login", null, "POST", { email: registration.email, password });
        assert.equal(login.status, 200);
        const profile = await request(bases[0], "/api/users/me", login.body.token);
        assert.equal(profile.status, 200);
        assert.equal(profile.body.user.department, "mechanical");
        assert.equal((await request(bases[0], "/api/auth/forgot-password", null, "POST", { email: registration.email })).status, 200);
        const resetOtp = mail.text.match(/\b\d{6}\b/)[0];
        const newPassword = "updated-integration-password";
        assert.equal((await request(bases[0], "/api/auth/reset-password", null, "POST", {
            email: registration.email, otp: resetOtp, newPassword,
        })).status, 200);
        assert.equal((await request(bases[1], "/api/users/me", login.body.token)).status, 401);
        assert.equal((await request(bases[0], "/api/auth/login", null, "POST", { email: registration.email, password })).status, 401);
        assert.equal((await request(bases[0], "/api/auth/login", null, "POST", { email: registration.email, password: newPassword })).status, 200);
        t.diagnostic("Real compiler: three accepted contest submissions and one custom run. Duplicate solves counted once; private verdicts and leaderboard updates reached both API servers.");
        t.diagnostic("Registration, OTP verification and password reset passed with real MongoDB transactions and captured mail; no emails were sent.");
    } finally {
        sockets.forEach(socket => socket.disconnect());
        try {
            await Promise.all(workers.map(worker => worker.close()));
            await Promise.all(servers.map(({ io }) => new Promise(resolve => io.close(resolve))));
            if (mongoose.connection.name === namespace) await mongoose.connection.dropDatabase();
            if (queueReady && queue.getQueue().opts.prefix === namespace) await queue.getQueue().obliterate({ force: true });
            const client = redis.getRedis();
            let cursor = "0";
            do {
                const page = await client.scan(cursor, "MATCH", `${namespace}:*`, "COUNT", 100);
                cursor = page[0];
                if (page[1].length) await client.del(...page[1]);
            } while (cursor !== "0");
        } finally {
            await queue.closeQueue();
            await realtime.closeRealtime();
            await redis.closeRedis();
            await mongoose.disconnect();
        }
    }
});
