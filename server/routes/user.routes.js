const express = require("express");
const { getProfile, updateProfile, getSolvedProblems, changePassword } = require("../controllers/user.controller");
const requireAuth = require("../middleware/auth.middleware");
const { passwordLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();

router.use(requireAuth);
router.get("/me", getProfile);
router.patch("/me", updateProfile);
router.get("/me/solved", getSolvedProblems);
router.patch("/me/password", passwordLimiter, changePassword);

module.exports = router;
