const express = require("express");
const { getProfile, updateProfile, getSolvedProblems, changePassword } = require("../controllers/user.controller");
const { getLeaderboard } = require("../controllers/leaderboard.controller");
const { getActivity } = require("../controllers/activity.controller");
const { getProfileStats } = require("../controllers/profileStats.controller");
const requireAuth = require("../middleware/auth.middleware");
const { passwordLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();

router.use(requireAuth);
router.get("/leaderboard", getLeaderboard);
router.get("/me", getProfile);
router.patch("/me", updateProfile);
router.get("/me/solved", getSolvedProblems);
router.get("/me/activity", getActivity);
router.get("/me/stats", getProfileStats);
router.patch("/me/password", passwordLimiter, changePassword);

module.exports = router;
