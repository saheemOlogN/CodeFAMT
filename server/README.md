# CODEFAMT backend

Keep Express setup in `index.js`. Use plain CommonJS JavaScript without code
comments or emojis. Build models first, then controllers and routes in small steps.

Run with Node.js 24:

```powershell
cd server
npm install
npm run dev
```

The npm scripts load `.env`, where `PORT=6767` sets the server port.
`index.js` only creates the Express app and starts the server.

## Models

| File | Stores |
| --- | --- |
| `models/user.model.js` | Name, college email, password hash, role, and email verification state. |
| `models/otp.model.js` | One current email-verification OTP hash per user, expiry, attempts, and last send time. |
| `models/problem.model.js` | Statement, difficulty, tags, public examples, limits, visibility, and author. |
| `models/testCase.model.js` | Hidden judging inputs and expected outputs for a problem. |
| `models/submission.model.js` | A user's code, language, problem, optional contest, verdict, and judging results. |
| `models/solvedProblem.model.js` | One accepted user/problem pair and the submission that first earned it. |
| `models/contest.model.js` | Schedule, problems with points, publication state, and organizer. |
| `models/contestParticipant.model.js` | Which users joined which contests. |

`ObjectId` with `ref` links a record to another model. For example, a submission's
`user` refers to a User and its `problem` refers to a Problem. A null `contest`
means a practice submission. Every model has creation and update timestamps.

If a student submits an accepted solution to the same problem twice, we keep
both Submissions but only one SolvedProblem. Counting that student's solve
records gives their solved-problem count. A separate unique contest/user index
prevents duplicate contest registrations once the database builds the indexes.

Problem visibility is `draft`, `contest`, or `public`. Only public problems
belong in the practice list. Public examples stay on Problem; hidden judging
tests stay in TestCase. Empty input/output strings are valid for both.

A contest is `draft`, `published`, or `cancelled`. Upcoming, running, and ended
are calculated from its dates and the server clock. Drafts can have no problems;
published contests need at least one. Duplicate problems and end times at or
before the start time fail document validation. Each problem defaults to 100
points. The planned scoring rule is full points once per accepted problem;
tie-break rules will be defined when we build the contest controller.

## What comes with controllers

The models are defined, but MongoDB is not connected. Indexes, OTP cleanup,
registration, judging, and live leaderboards are not running yet.

- Hash passwords and OTPs before storing them. Enforce OTP expiry, attempt limits,
  resend delays, and single use. Expiry indexes clean up in the background; they
  do not replace checking `expiresAt` during verification.
- Check referenced records exist, users are verified, and admin actions are
  authorized. A `ref` does not enforce these rules. Never accept roles, verdicts,
  scores, verification flags, or submission timestamps from a request body.
- Require at least one valid TestCase before publishing a problem or a contest
  that uses it. Validate the admin's test inputs and expected outputs explicitly;
  public examples alone do not supply the hidden judging tests.
- Choose safe response fields explicitly. `select: false` excludes sensitive
  fields from normal queries; it does not protect new documents, aggregation
  results, or fields explicitly selected by a query. Never return hidden tests.
- Load, edit, and save contest documents so the date and problem-list validators
  run together. Raw updates do not automatically enforce those cross-field rules.
  Freeze contest problem lists, points, and associated test definitions after
  the contest starts so stored submissions keep their meaning.
- Accept contest submissions only from participants during the server-enforced
  window, with `startTime <= createdAt < endTime`. Judge valid queued submissions
  even after the contest ends. Check the problem belongs to that contest.
- The worker owns submission verdicts and test counts. An accepted result needs
  all tests to pass, and test counts must be consistent. A solve record must
  refer to an accepted submission by the same user for the same problem.
- Check OneCompiler capabilities before enforcing the stored execution limits
  or choosing supported languages. Redis will queue jobs and can cache scores;
  these MongoDB records remain the durable data. No Redis model is needed.

The next implementation step is the registration controller.

[Mongoose validation](https://mongoosejs.com/docs/validation.html) and
[MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)
