const router = require('express').Router();
const requireAuth = require('../middleware/auth.middleware');
const { requireAdmin, adminWrite } = require('../middleware/admin.middleware');
const { getRoadmap, saveRoadmap, saveProgress } = require('../controllers/roadmap.controller');
router.use(requireAuth);
router.get('/', getRoadmap);
router.patch('/progress', saveProgress);
router.put('/', requireAdmin, adminWrite(saveRoadmap));
module.exports = router;
