const express = require("express");
const { runCode, getRun, submitCode, getSubmissions, getSubmission, retrySubmission } = require("../controllers/submission.controller");
const requireAuth = require("../middleware/auth.middleware");
const { executionLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();

router.use((req, res, next) => {
    req.receivedAt = new Date();
    next();
});
router.use(requireAuth);
router.get("/", getSubmissions);
router.post("/run", executionLimiter, runCode);
router.post("/", executionLimiter, submitCode);
router.get("/runs/:id", getRun);
router.get("/:id", getSubmission);
router.post("/:id/retry", executionLimiter, retrySubmission);

module.exports = router;
