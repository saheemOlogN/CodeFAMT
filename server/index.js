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

const app = express();

const port = process.env.PORT;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/problems", problemRoutes);
app.use("/api/contests", contestRoutes);
app.use("/api/submissions", submissionRoutes);
app.use(handleError);

if (require.main === module) {
    connectDB().then(async () => {
        await initializeQueue();
        const server = http.createServer(app);
        const io = await initializeSocket(server);
        let stopping = false;
        async function stop() {
            if (stopping) return;
            stopping = true;
            await new Promise(resolve => io.close(resolve));
            await closeQueue();
            await closeRealtime();
            closeRedis();
            await mongoose.disconnect();
        }
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        server.listen(port, () => {
            console.log(`CODEFAMT API is running at http://localhost:${port}`);
        });
    }).catch((error) => {
        console.error("Could not start the server. Check MongoDB and Redis configuration:", error.name);
        process.exit(1);
    });
}

module.exports = app;
