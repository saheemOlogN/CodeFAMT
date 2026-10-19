const express = require("express");
const { createProblem, getProblems, getProblem, updateProblem, deleteProblem } = require("../controllers/problem.controller");
const { createTestCase, getTestCases, updateTestCase, deleteTestCase } = require("../controllers/testCase.controller");
const requireAuth = require("../middleware/auth.middleware");
const { requireAdmin, adminWrite } = require("../middleware/admin.middleware");

const router = express.Router();

router.use(requireAuth);
router.get("/", getProblems);
router.post("/", requireAdmin, adminWrite(createProblem));
router.get("/:problemId/tests", requireAdmin, getTestCases);
router.post("/:problemId/tests", requireAdmin, adminWrite(createTestCase));
router.patch("/:problemId/tests/:id", requireAdmin, adminWrite(updateTestCase));
router.delete("/:problemId/tests/:id", requireAdmin, adminWrite(deleteTestCase));
router.get("/:id", getProblem);
router.patch("/:id", requireAdmin, adminWrite(updateProblem));
router.delete("/:id", requireAdmin, adminWrite(deleteProblem));

module.exports = router;
