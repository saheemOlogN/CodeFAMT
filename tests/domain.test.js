import test from 'node:test';
import assert from 'node:assert/strict';
import { emailSchema, contestSchema, problemSchema } from '../server/validators/index.js';
import { contestState, normalizeOutput, buildLeaderboard } from '../server/utils/contest.js';
import { Problem, Submission } from '../server/models/index.js';

test('college email matching is exact and normalized', () => {
  assert.equal(emailSchema.parse('  STUDENT@FAMT.AC.IN  '), 'student@famt.ac.in');
  for (const email of [
    'student@gmail.com',
    'student@evilfamt.ac.in',
    'student@famt.ac.in.evil.com',
    'student@dept.famt.ac.in',
    'student@@famt.ac.in',
    'famt.ac.in',
  ])
    assert.equal(emailSchema.safeParse(email).success, false, email);
});
test('contest window includes start but excludes end', () => {
  const contest = { startsAt: '2026-10-18T04:30:00Z', endsAt: '2026-10-18T05:30:00Z' };
  assert.equal(contestState(contest, new Date('2026-10-18T04:29:59.999Z')), 'upcoming');
  assert.equal(contestState(contest, new Date(contest.startsAt)), 'live');
  assert.equal(contestState(contest, new Date('2026-10-18T05:29:59.999Z')), 'live');
  assert.equal(contestState(contest, new Date(contest.endsAt)), 'finished');
});
test('output comparison tolerates line endings and trailing spaces but preserves meaningful differences', () => {
  assert.equal(normalizeOutput('1 2  \r\n3\r\n\n'), normalizeOutput('1 2\n3'));
  assert.notEqual(normalizeOutput('12'), normalizeOutput('1 2'));
  assert.notEqual(normalizeOutput(' 1'), normalizeOutput('1'));
  assert.notEqual(normalizeOutput('1\n2'), normalizeOutput('1 2'));
});
test('leaderboard ranks by score, then total first-solve time, and shares exact ties', () => {
  const contest = {
    startsAt: new Date('2026-10-18T04:30:00Z'),
    problems: [
      { problem: 'p1', points: 100 },
      { problem: 'p2', points: 200 },
    ],
  };
  const solve = (id, problem, minutes) => ({
    user: { _id: id, name: id },
    problem,
    submittedAt: new Date(+contest.startsAt + minutes * 60000),
  });
  const rows = buildLeaderboard(
    [
      solve('alice', 'p1', 10),
      solve('alice', 'p2', 20),
      solve('bob', 'p2', 5),
      solve('carol', 'p2', 5),
      solve('dan', 'p2', 8),
    ],
    contest,
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.score, row.rank, row.penalty]),
    [
      ['alice', 300, 1, 1800],
      ['bob', 200, 2, 300],
      ['carol', 200, 2, 300],
      ['dan', 200, 4, 480],
    ],
  );
});
test('leaderboard works with populated problem objects', () => {
  const rows = buildLeaderboard(
    [{ user: { _id: 'u', name: 'Student' }, problem: 'p', submittedAt: new Date(1000) }],
    { startsAt: new Date(0), problems: [{ problem: { _id: 'p' }, points: 100 }] },
  );
  assert.equal(rows[0].score, 100);
});
test('empty leaderboard is empty', () =>
  assert.deepEqual(buildLeaderboard([], { problems: [], startsAt: new Date() }), []));

test('registered students with zero solves still receive tied ranks', () => {
  const rows = buildLeaderboard([], { problems: [], startsAt: new Date() }, [
    { _id: 'b', name: 'B' },
    { _id: 'a', name: 'A' },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.name, row.score, row.rank]),
    [
      ['A', 0, 1],
      ['B', 0, 1],
    ],
  );
});
test('duplicate contest problems and invalid points are rejected', () => {
  const problem = 'a'.repeat(24);
  const base = {
    title: 'Weekly contest',
    startsAt: '2026-10-18T04:30:00Z',
    problems: [{ problem, points: 100 }],
  };
  assert.equal(contestSchema.safeParse(base).success, true);
  assert.equal(
    contestSchema.safeParse({ ...base, problems: [...base.problems, ...base.problems] }).success,
    false,
  );
  assert.equal(
    contestSchema.safeParse({ ...base, problems: [{ problem, points: 0 }] }).success,
    false,
  );
  assert.equal(contestSchema.safeParse({ ...base, problems: [] }).success, false);
});
test('hidden tests and source are excluded from default database projections', () => {
  assert.equal(Problem.schema.path('testCases').options.select, false);
  assert.equal(Submission.schema.path('source').options.select, false);
  assert.equal(Submission.schema.path('stdin').options.select, false);
});

test('admin problem validation requires tests and enforces the provider output limit', () => {
  const problem = {
    slug: 'validation-fixture',
    title: 'Validation fixture',
    difficulty: 'Easy',
    pattern: 'Arrays & Hashing',
    description: 'A statement used only for request validation.',
    inputFormat: 'An integer.',
    outputFormat: 'An integer.',
    constraints: '1 to 10.',
    samples: [{ input: '1', output: '1' }],
    testCases: [{ input: '1', output: '1' }],
  };
  assert.equal(problemSchema.safeParse(problem).success, true);
  assert.equal(problemSchema.safeParse({ ...problem, testCases: [] }).success, false);
  assert.equal(
    problemSchema.safeParse({ ...problem, testCases: [{ input: '', output: 'x'.repeat(999) }] })
      .success,
    false,
  );
});
test('submission idempotency and contest lookup indexes are defined', () => {
  assert.ok(
    Submission.schema
      .indexes()
      .some(([keys, options]) => keys.user === 1 && keys.requestId === 1 && options.unique),
  );
  assert.ok(Submission.schema.indexes().some(([keys]) => keys.contest === 1 && keys.status === 1));
});
