import { z } from 'zod';
import { Submission } from '../models/index.js';
import { idSchema, languages } from '../validators/index.js';
import { accessibleProblem } from '../services/problemService.js';
import { contestState } from '../utils/contest.js';
import { fail } from '../utils/httpError.js';
import { enqueue } from '../services/queueService.js';

export async function createSubmission(req, res) {
  const receivedAt = req.receivedAt;
  const body = z
    .object({
      slug: z.string().max(100),
      contestId: idSchema.optional(),
      requestId: z.uuid(),
      kind: z.enum(['run', 'submit']),
      language: z.enum(languages),
      source: z.string().min(1).max(50000),
      stdin: z.string().max(10000).default(''),
    })
    .parse(req.body);
  const existing = await Submission.findOne({
    user: req.user._id,
    requestId: body.requestId,
  }).lean();
  if (existing) return res.status(202).json({ submission: existing });
  const { problem, contest } = await accessibleProblem(body.slug, body.contestId, req.user);
  if (contest && contestState(contest, receivedAt) !== 'live')
    fail(400, 'Contest submissions are only open during the one-hour window.');
  if (!process.env.COMPILER_API_KEY)
    fail(
      503,
      'Code execution is not configured yet. Ask your administrator to connect the compiler API.',
    );
  const submission = await Submission.create({
    user: req.user._id,
    problem: problem._id,
    contest: contest?._id || null,
    requestId: body.requestId,
    kind: body.kind,
    language: body.language,
    source: body.source,
    stdin: body.stdin,
    createdAt: receivedAt,
  });
  // The durable MongoDB record is the outbox. The worker also sweeps Queued records after Redis outages.
  try {
    await enqueue(submission);
  } catch (error) {
    console.error('Queue deferred:', error.message);
  }
  res.status(202).json({ submission: { _id: submission._id, status: submission.status } });
}

export async function listSubmissions(req, res) {
  const submissions = await Submission.find({ user: req.user._id })
    .populate('problem', 'title slug')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ submissions });
}

export async function getSubmission(req, res) {
  const submission = await Submission.findOne({
    _id: idSchema.parse(req.params.id),
    user: req.user._id,
  }).lean();
  if (!submission) fail(404, 'Submission not found.');
  res.json({ submission });
}
