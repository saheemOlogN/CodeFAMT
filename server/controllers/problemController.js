import { Problem, Submission } from '../models/index.js';
import { accessibleProblem } from '../services/problemService.js';

export async function listProblems(req, res) {
  const problems = await Problem.find({ published: true })
    .select('slug title difficulty pattern')
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  const solved = req.user
    ? await Submission.distinct('problem', {
        user: req.user._id,
        kind: 'submit',
        status: 'Accepted',
      })
    : [];
  res.json({ problems, solved: solved.map(String) });
}

export async function getProblem(req, res) {
  const { problem } = await accessibleProblem(req.params.slug, req.query.contest, req.user);
  res.json({ problem });
}
