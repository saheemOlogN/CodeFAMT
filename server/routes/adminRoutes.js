import { Router } from 'express';
import {
  listAdminProblems,
  createProblem,
  updateProblem,
  createContest,
} from '../controllers/adminController.js';
import { authenticated, admin } from '../middlewares/authMiddleware.js';

const router = Router();
router.get('/problems', authenticated, admin, listAdminProblems);
router.post('/problems', authenticated, admin, createProblem);
router.patch('/problems/:id', authenticated, admin, updateProblem);
router.post('/contests', authenticated, admin, createContest);

export default router;
