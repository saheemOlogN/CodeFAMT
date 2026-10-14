import { Problem, Contest, Registration } from '../models/index.js';
import { idSchema } from '../validators/index.js';
import { contestState } from '../utils/contest.js';
import { fail } from '../utils/httpError.js';

export const findContest = async (id) =>
  (await Contest.findById(idSchema.parse(id)).lean()) || fail(404, 'Contest not found.');
export async function accessibleProblem(slug, contestId, user) {
  const problem = await Problem.findOne({ slug }).lean();
  if (!problem) fail(404, 'Problem not found.');
  if (contestId) {
    const contest = await findContest(contestId);
    if (!contest.problems.some((p) => String(p.problem) === String(problem._id)))
      fail(404, 'Problem is not in this contest.');
    if (contestState(contest) === 'upcoming') fail(403, 'Contest problems unlock at the start.');
    if (!user || !(await Registration.exists({ user: user._id, contest: contest._id })))
      fail(403, 'Register for this contest to open its problems.');
    return { problem, contest };
  }
  if (!problem.published) fail(404, 'Problem not found.');
  return { problem };
}
