const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Contest = require("../models/contest.model");
const ContestParticipant = require("../models/contestParticipant.model");
const { setRealtimeServer } = require("../utils/realtime");

async function checkLogin(socket) {
    const token = socket.handshake.auth?.token;

    if (typeof token !== "string" || token.length > 8192 || !process.env.JWT_SECRET) {
        throw new Error("Please log in again");
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

    if (!mongoose.isObjectIdOrHexString(payload.sub) || !Number.isInteger(payload.version) || !Number.isInteger(payload.exp)) {
        throw new Error("Please log in again");
    }

    const user = await User.findById(payload.sub).select("role isVerified +tokenVersion");

    if (!user || !user.isVerified || user.tokenVersion !== payload.version || payload.exp * 1000 <= Date.now()) {
        throw new Error("Please log in again");
    }

    socket.data.userId = String(user._id);
    socket.data.role = user.role;
    socket.data.expiresAt = payload.exp * 1000;
}

async function initializeSocket(httpServer, options = {}) {
    const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
    const io = new Server(httpServer, {
        transports: ["websocket"],
        cors: { origin },
        maxHttpBufferSize: 4096,
        allowRequest(req, callback) {
            callback(null, !req.headers.origin || req.headers.origin === origin);
        },
    });
    let publisher;
    let subscriber;

    if (options.redis !== false) {
        try {
            const { createRedisConnection } = require("./redis");
            publisher = createRedisConnection();
            subscriber = createRedisConnection();
            const publish = publisher.publish.bind(publisher);
            publisher.publish = (...args) => publish(...args).catch(() => 0);
            const subscriptions = [];
            for (const method of ["subscribe", "psubscribe", "unsubscribe", "punsubscribe"]) {
                const command = subscriber[method].bind(subscriber);
                subscriber[method] = (...args) => {
                    const pending = command(...args);
                    pending.catch(() => {});
                    if (method === "subscribe" || method === "psubscribe") subscriptions.push(pending);
                    return pending;
                };
            }
            await Promise.all([
                publisher.status === "wait" ? publisher.connect() : publisher.ping(),
                subscriber.status === "wait" ? subscriber.connect() : subscriber.ping(),
            ]);
            io.adapter(createAdapter(publisher, subscriber, { key: `${process.env.REDIS_PREFIX || "codefamt"}:socket.io` }));
            await Promise.all(subscriptions);
        } catch (error) {
            publisher?.disconnect();
            subscriber?.disconnect();
            await io.close();
            throw error;
        }
    }

    setRealtimeServer(io);
    httpServer.on("close", () => {
        publisher?.disconnect();
        subscriber?.disconnect();
        setRealtimeServer(null);
    });

    io.use(async (socket, next) => {
        try {
            await checkLogin(socket);
            next();
        } catch {
            next(new Error("Invalid or expired login token"));
        }
    });

    io.on("connection", socket => {
        socket.join(`user:${socket.data.userId}`);
        let checking = false;
        let joining = false;
        let joinCount = 0;
        let joinWindow = Date.now();
        const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(1, socket.data.expiresAt - Date.now()));
        const loginTimer = setInterval(async () => {
            if (checking) return;
            checking = true;
            try {
                await checkLogin(socket);
            } catch {
                socket.disconnect(true);
            } finally {
                checking = false;
            }
        }, 15000);
        expiryTimer.unref();
        loginTimer.unref();

        socket.on("contest:join", async (body, acknowledge) => {
            if (typeof acknowledge !== "function") return;

            if (!body || typeof body !== "object" || Array.isArray(body) ||
                Object.keys(body).some(key => key !== "contestId") || !mongoose.isObjectIdOrHexString(body.contestId)) {
                return acknowledge({ success: false, message: "Send a valid contest ID" });
            }

            if (Date.now() - joinWindow >= 60000) {
                joinCount = 0;
                joinWindow = Date.now();
            }

            if (joining || joinCount >= 20) {
                return acknowledge({ success: false, message: "Wait before subscribing to another contest" });
            }

            joining = true;
            joinCount++;
            try {
                await checkLogin(socket);
            } catch {
                acknowledge({ success: false, message: "Please log in again" });
                joining = false;
                return socket.disconnect(true);
            }

            try {
                const contestId = String(body.contestId).toLowerCase();
                const contest = await Contest.findById(contestId).select("status");

                if (!contest || (socket.data.role !== "admin" && contest.status !== "published")) {
                    return acknowledge({ success: false, message: "Contest not found" });
                }

                if (socket.data.role !== "admin" && !await ContestParticipant.exists({ contest: contest._id, user: socket.data.userId })) {
                    return acknowledge({ success: false, message: "Join the contest before subscribing" });
                }

                const room = `contest:${contestId}`;

                if (!socket.rooms.has(room) && socket.rooms.size >= 22) {
                    return acknowledge({ success: false, message: "Leave another contest before subscribing" });
                }

                if (!socket.connected) return;
                await socket.join(room);
                return acknowledge({ success: true, contestId, serverNow: new Date().toISOString() });
            } catch {
                return acknowledge({ success: false, message: "Could not subscribe to this contest" });
            } finally {
                joining = false;
            }
        });

        socket.on("contest:leave", async (body, acknowledge) => {
            if (typeof acknowledge !== "function") return;
            if (!body || !mongoose.isObjectIdOrHexString(body.contestId)) {
                return acknowledge({ success: false, message: "Send a valid contest ID" });
            }
            const contestId = String(body.contestId).toLowerCase();
            await socket.leave(`contest:${contestId}`);
            acknowledge({ success: true, contestId });
        });

        socket.on("disconnect", () => {
            clearTimeout(expiryTimer);
            clearInterval(loginTimer);
        });
    });

    return io;
}

module.exports = initializeSocket;
