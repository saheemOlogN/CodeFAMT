const express = require("express");
const { createContest, getContests, getContest, updateContest, deleteContest, joinContest, getContestProblem, getLeaderboard } = require("../controllers/contest.controller");
const requireAuth = require("../middleware/auth.middleware");
const { requireAdmin, adminWrite } = require("../middleware/admin.middleware");

const router = express.Router();

router.use(requireAuth);
router.get("/", getContests);
router.post("/", requireAdmin, adminWrite(createContest));
router.get("/:id", getContest);
router.patch("/:id", requireAdmin, adminWrite(updateContest));
router.delete("/:id", requireAdmin, adminWrite(deleteContest));
router.post("/:id/join", joinContest);
router.get("/:id/problems/:problemId", getContestProblem);
router.get("/:id/leaderboard", getLeaderboard);

module.exports = router;
