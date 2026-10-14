import { Router } from 'express';
import { listProblems, getProblem } from '../controllers/problemController.js';

const router = Router();
router.get('/', listProblems);
router.get('/:slug', getProblem);

export default router;
