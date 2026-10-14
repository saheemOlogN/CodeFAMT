import { Router } from 'express';
import {
  createSubmission,
  listSubmissions,
  getSubmission,
} from '../controllers/submissionController.js';
import { authenticated } from '../middlewares/authMiddleware.js';
import { rateLimit } from '../middlewares/rateLimit.js';

const router = Router();
router.post(
  '/',
  authenticated,
  rateLimit('submit', 20, 60, (req) => req.user._id),
  createSubmission,
);
router.get('/', authenticated, listSubmissions);
router.get('/:id', authenticated, getSubmission);

export default router;
