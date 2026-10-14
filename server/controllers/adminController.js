import mongoose from 'mongoose';
import { Problem, Contest, Submission } from '../models/index.js';
import { idSchema, problemSchema, contestSchema } from '../validators/index.js';
import { fail } from '../utils/httpError.js';

export async function listAdminProblems(req, res) {
  return res.json({
    problems: await Problem.find().select('+testCases').sort({ createdAt: -1 }).lean(),
  });
}

export async function createProblem(req, res) {
  res.status(201).json({ problem: await Problem.create(problemSchema.parse(req.body)) });
}

export async function updateProblem(req, res) {
  const id = idSchema.parse(req.params.id);
  const body = problemSchema.parse(req.body);
  if (await Submission.exists({ problem: id, status: { $in: ['Queued', 'Judging'] } }))
    fail(409, 'Wait for pending submissions to finish before editing this problem.');
  if (await Contest.exists({ 'problems.problem': id, endsAt: { $gt: new Date() } }))
    fail(409, 'Scheduled and live contest problems are locked until the contest ends.');
  const problem = await Problem.findByIdAndUpdate(id, body, { new: true });
  if (!problem) fail(404, 'Problem not found.');
  res.json({ problem });
}

export async function createContest(req, res) {
  const body = contestSchema.parse(req.body);
  const startsAt = new Date(body.startsAt);
  if (startsAt <= new Date()) fail(400, 'Schedule the contest in the future.');
  const ids = body.problems.map((p) => new mongoose.Types.ObjectId(p.problem));
  if ((await Problem.countDocuments({ _id: { $in: ids }, published: false })) !== ids.length)
    fail(400, 'Choose existing draft problems so contest questions remain private.');
  if (await Contest.exists({ 'problems.problem': { $in: ids } }))
    fail(400, 'Use new problems that have not appeared in another contest.');
  const contest = await Contest.create({
    ...body,
    startsAt,
    endsAt: new Date(+startsAt + 3600000),
  });
  res.status(201).json({ contest });
}
