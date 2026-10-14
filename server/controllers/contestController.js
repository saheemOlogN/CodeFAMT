import { Contest, Registration, Submission } from '../models/index.js';
import { findContest } from '../services/problemService.js';
import { contestState, buildLeaderboard } from '../utils/contest.js';
import { fail } from '../utils/httpError.js';

export async function listContests(req, res) {
  const contests = await Contest.find()
    .select('-problems.problem')
    .sort({ startsAt: -1 })
    .limit(100)
    .lean();
  const registrations = req.user
    ? await Registration.find({ user: req.user._id }).select('contest').lean()
    : [];
  res.json({
    contests: contests.map((c) => ({
      ...c,
      state: contestState(c),
      registered: registrations.some((r) => String(r.contest) === String(c._id)),
    })),
  });
}

export async function getContest(req, res) {
  const contest = await findContest(req.params.id);
  const registered = !!(
    req.user && (await Registration.exists({ user: req.user._id, contest: contest._id }))
  );
  const state = contestState(contest);
  if (state !== 'upcoming' && registered)
    await Contest.populate(contest, {
      path: 'problems.problem',
      select: 'slug title difficulty pattern',
    });
  else contest.problems = contest.problems.map((p) => ({ points: p.points }));
  res.json({ contest: { ...contest, registered, state }, serverTime: new Date().toISOString() });
}

export async function registerForContest(req, res) {
  const contest = await findContest(req.params.id);
  if (contestState(contest) === 'finished') fail(400, 'This contest has ended.');
  await Registration.updateOne(
    { contest: contest._id, user: req.user._id },
    { $setOnInsert: { contest: contest._id, user: req.user._id } },
    { upsert: true },
  );
  res.json({ ok: true });
}

export async function getLeaderboard(req, res) {
  const contest = await findContest(req.params.id);
  const solves = await Submission.aggregate([
    {
      $match: {
        contest: contest._id,
        kind: 'submit',
        status: 'Accepted',
        createdAt: { $gte: contest.startsAt, $lt: contest.endsAt },
      },
    },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { user: '$user', problem: '$problem' },
        submittedAt: { $first: '$createdAt' },
      },
    },
    { $lookup: { from: 'users', localField: '_id.user', foreignField: '_id', as: 'student' } },
    { $unwind: '$student' },
    {
      $project: {
        user: { _id: '$student._id', name: '$student.name' },
        problem: '$_id.problem',
        submittedAt: 1,
      },
    },
  ]);
  const registrations = await Registration.find({ contest: contest._id })
    .populate('user', 'name')
    .lean();
  res.json({
    leaderboard: buildLeaderboard(
      solves,
      contest,
      registrations.map((row) => row.user).filter(Boolean),
    ),
    pending: await Submission.countDocuments({
      contest: contest._id,
      kind: 'submit',
      status: { $in: ['Queued', 'Judging'] },
    }),
  });
}
