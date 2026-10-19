const express = require("express");
const { register, verifyOtp, resendOtp, login, logout } = require("../controllers/auth.controller");
const requireAuth = require("../middleware/auth.middleware");
const { authLimiter, accountLimiter } = require("../middleware/rateLimit.middleware");

const router = express.Router();

router.use(authLimiter);
router.post("/register", accountLimiter, register);
router.post("/verify-otp", accountLimiter, verifyOtp);
router.post("/resend-otp", accountLimiter, resendOtp);
router.post("/login", accountLimiter, login);
router.post("/logout", requireAuth, logout);

module.exports = router;
