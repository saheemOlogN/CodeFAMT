export function contestState(contest, now = new Date()) {
  if (now < new Date(contest.startsAt)) return 'upcoming';
  if (now >= new Date(contest.endsAt)) return 'finished';
  return 'live';
}

export function normalizeOutput(output) {
  return String(output)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

export function buildLeaderboard(solves, contest, participants = []) {
  const points = new Map(
    contest.problems.map((p) => [String(p.problem._id || p.problem), p.points]),
  );
  const users = new Map(
    participants.map((user) => [
      String(user._id),
      {
        userId: String(user._id),
        name: user.name,
        score: 0,
        solved: 0,
        penalty: 0,
      },
    ]),
  );
  for (const solve of solves) {
    const key = String(solve.user._id);
    const row = users.get(key) || {
      userId: key,
      name: solve.user.name,
      score: 0,
      solved: 0,
      penalty: 0,
    };
    row.score += points.get(String(solve.problem)) || 0;
    row.solved++;
    row.penalty += Math.max(
      0,
      Math.floor((new Date(solve.submittedAt) - new Date(contest.startsAt)) / 1000),
    );
    users.set(key, row);
  }
  let previous;
  return [...users.values()]
    .sort((a, b) => b.score - a.score || a.penalty - b.penalty || a.userId.localeCompare(b.userId))
    .map((row, index) => {
      const rank =
        previous && row.score === previous.score && row.penalty === previous.penalty
          ? previous.rank
          : index + 1;
      previous = { ...row, rank };
      return previous;
    });
}
