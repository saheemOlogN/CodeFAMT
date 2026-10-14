import { Router } from 'express';
import { getSession, requestOtp, verifyOtp, logout } from '../controllers/authController.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { emailSchema } from '../validators/index.js';
const router = Router();
router.get('/me', getSession);
router.post(
  '/otp',
  rateLimit('otp-ip', 600, 3600),
  rateLimit('otp-email', 6, 3600, (req) => emailSchema.parse(req.body?.email)),
  requestOtp,
);
router.post('/verify', rateLimit('verify', 600, 600), verifyOtp);
router.post('/logout', logout);

export default router;
