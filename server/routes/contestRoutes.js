import { Router } from 'express';
import {
  listContests,
  getContest,
  registerForContest,
  getLeaderboard,
} from '../controllers/contestController.js';
import { authenticated } from '../middlewares/authMiddleware.js';

const router = Router();
router.get('/', listContests);
router.get('/:id', getContest);
router.post('/:id/register', authenticated, registerForContest);
router.get('/:id/leaderboard', getLeaderboard);

export default router;
