import { Router } from 'express';
import { getCommunity } from '../controllers/communityController.js';

const router = Router();
router.get('/', getCommunity);

export default router;
