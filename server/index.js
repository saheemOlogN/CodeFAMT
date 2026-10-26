const { validateEnvironment } = require('./config/environment');
if (require.main === module) {
    try { validateEnvironment(); } catch (error) { console.error(error.message); process.exit(1); }
}
const path = require('node:path');
const { readiness } = require('./utils/health');
const startupStarted = performance.now();
if (require.main === module) console.log("[startup] Loading API dependencies...");
const express = require("express");
const cors = require("cors");
const http = require("node:http");
const mongoose = require("mongoose");
const initializeSocket = require("./config/socket");
const { initializeQueue, closeQueue } = require("./utils/executionQueue");
const { closeRedis } = require("./config/redis");
const { closeRealtime } = require("./utils/realtime");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const problemRoutes = require("./routes/problem.routes");
const contestRoutes = require("./routes/contest.routes");
const submissionRoutes = require("./routes/submission.routes");
const handleError = require("./middleware/error.middleware");
const { initializeServices } = require("./utils/startup");

const app = express();

const port = Number(process.env.PORT || 6767);
let stopping = false;
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
});
app.get('/health/live', (req, res) => res.status(stopping ? 503 : 200).json({ status: stopping ? 'stopping' : 'ok' }));
app.get('/health/ready', async (req, res) => {
    const ready = !stopping && await readiness();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/problems", problemRoutes);
app.use("/api/contests", contestRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/roadmap", require('./routes/roadmap.routes'));
app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found' }));
if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(__dirname, '../client/dist');
    app.use(express.static(dist, { index: false }));
    app.get('/{*path}', (req, res, next) => {
        if (path.extname(req.path)) return res.sendStatus(404);
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(dist, 'index.html'), error => { if (error) next(error); });
    });
}
app.use(handleError);

if (require.main === module) {
    console.log(`[startup] Dependencies loaded in ${((performance.now() - startupStarted) / 1000).toFixed(2)}s; connecting services...`);
    const server = http.createServer(app);
    initializeServices({
        MongoDB: connectDB,
        "Execution queue": initializeQueue,
        "Realtime sockets": () => initializeSocket(server),
    }, { timeouts: { MongoDB: 120000 } }).then(async ([, , io]) => {
        async function stop() {
            if (stopping) return;
            stopping = true;
            const deadline = setTimeout(() => process.exit(1), 30000);
            deadline.unref();
            await new Promise(resolve => io.close(resolve));
            await closeQueue();
            await closeRealtime();
            await closeRedis();
            await mongoose.disconnect();
            clearTimeout(deadline);
        }
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        server.listen(port, () => {
            console.log(`CodeFAMT API is running at http://localhost:${port} (started in ${((performance.now() - startupStarted) / 1000).toFixed(2)}s)`);
        });
    }).catch((error) => {
        console.error(`[startup] ${error.message}`);
        process.exit(1);
    });
}

module.exports = app;
