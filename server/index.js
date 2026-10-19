const express = require("express");
const cors = require("cors");
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
    connectDB().then(() => {
        app.listen(port, () => {
            console.log(`CODEFAMT API is running at http://localhost:${port}`);
        });
    }).catch((error) => {
        console.error("Could not start the server. Check MongoDB configuration:", error.name);
        process.exit(1);
    });
}

module.exports = app;
