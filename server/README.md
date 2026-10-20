# CODEFAMT backend

Plain CommonJS JavaScript. Express setup stays in index.js. Controllers use named async functions, direct model calls and try/catch.

## Start

Use Node.js 24. From the server folder, run `npm install`, then run `npm run dev` in one terminal and `npm run worker:dev` in another. For deployment use `npm start` and `npm run worker`. Both processes are required.

The npm scripts load .env. Configure PORT, MONGODB_URI, JWT_SECRET, OTP_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, ONLINECOMPILER_API_KEY, CLIENT_ORIGIN and REDIS_URL. Hosted Redis normally provides a redis:// or rediss:// URL. Set REDIS_PREFIX=codefamt, JUDGE_CONCURRENCY=2 and COMPILER_RUNS_PER_MINUTE=30; adjust the latter two to your provider plan. Keep secrets in this ignored file.

Use MongoDB Atlas or a replica set. An accepted submission and its solved-problem record are saved in a transaction so both changes succeed together. Standalone MongoDB does not support these transactions. See [MongoDB requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/) and [Mongoose transactions](https://mongoosejs.com/docs/transactions.html).

API instances and workers must share MongoDB, REDIS_URL and REDIS_PREFIX. Redis shares execution concurrency, compiler request budgets, HTTP rate limits and socket broadcasts. MongoDB transactions serialize admin writes. Startup does not reset active submissions. A worker scans unfinished MongoDB records every 15 seconds to recover missing queue jobs.

Set the Redis eviction policy to noeviction in your hosting dashboard. The configured instance reported volatile-lru during verification, which can evict queue state under memory pressure. See [BullMQ production settings](https://docs.bullmq.io/guide/going-to-production). Keep Redis persistence enabled where your hosting plan supports it.

## Understand the flow

1. A route connects an HTTP URL to a controller.
2. Authentication middleware checks the token and loads the verified student.
3. Admin middleware protects problem, hidden-test and contest management.
4. The controller validates the request and uses the models.
5. The controller returns JSON.

Submission flow: check access and contest timing, save source with queued status, enqueue its ID, and return HTTP 202. A separate worker executes hidden tests through OnlineCompiler.io, compares results, saves the verdict and first solve, and publishes a live update. Passed-test progress survives retries. Judging stops at the first failing test. The client cannot choose its verdict, score, user ID or receipt time.

| Model | Purpose |
| --- | --- |
| User | Profile, college email, password hash, role, verification and session version |
| PasswordReset | Separate password-reset OTP, expiry and attempts |
| CodeRun | Queued custom execution and private result; expires after 24 hours |
| AdminLock | Transaction lock for admin writes |
| Otp | Hashed verification code, expiry, cooldown and attempts |
| Problem | Statement, examples, constraints, limits and visibility |
| TestCase | Hidden input and expected output |
| Submission | Source, language, problem, optional contest, verdict and metrics |
| SolvedProblem | One accepted user/problem pair |
| Contest | Schedule, problem IDs, points and publication status |
| ContestParticipant | One user/contest registration |

Unique indexes prevent duplicate emails, registrations and solved counts.

## Authentication and profile

| Method | Route | Request or purpose |
| --- | --- | --- |
| POST | /api/auth/register | name, email, password, department, year |
| POST | /api/auth/verify-otp | Same registration fields plus otp as a six-digit string |
| POST | /api/auth/resend-otp | email |
| POST | /api/auth/login | email, password |
| POST | /api/auth/forgot-password | email; sends a reset OTP for a verified account |
| POST | /api/auth/reset-password | email, otp, newPassword; revokes existing sessions |
| POST | /api/auth/logout | Authenticated; logs out all devices |
| GET | /api/users/me | Own profile and solved count |
| PATCH | /api/users/me | name, department or year |
| GET | /api/users/me/solved | Own solved history; page and limit |
| PATCH | /api/users/me/password | currentPassword, newPassword; logs out all devices |

Registration accepts only @famt.ac.in addresses. Departments: mechanical, cybersecurity, aiml, it, chemical, electrical, entc, mca. Years: 1st, 2nd, 3rd, 4th.

OTPs expire after five minutes, allow five verification attempts and have a 60-second resend cooldown. Verification receives the registration fields again so the email owner chooses the final profile and password. Resending does not change an existing pending account's credentials.

Login returns a one-hour token. Send `Authorization: Bearer <token>` on every other API group and logout. The account must remain verified and its session version must match. Logout and password changes invalidate previous tokens.

Registration always creates a student. Bootstrap the first admin by verifying that account, then setting its role to admin using MongoDB Compass or your database console. No public endpoint grants admin access.

## Problems and hidden tests

| Method | Route | Access |
| --- | --- | --- |
| GET | /api/problems | Verified users; students see public problems |
| GET | /api/problems/:id | Verified users; students see public problems |
| POST | /api/problems | Admin; creates a draft |
| PATCH | /api/problems/:id | Admin; edits or publishes a draft |
| DELETE | /api/problems/:id | Admin; unused drafts only |
| GET, POST | /api/problems/:problemId/tests | Admin; list or add hidden tests |
| PATCH, DELETE | /api/problems/:problemId/tests/:id | Admin; edit or remove a hidden test |

Create a draft with title, slug, statement, difficulty, inputFormat, outputFormat, constraints, timeLimitMs and memoryLimitMb. Optional tags and examples describe the problem. Each example has input, output and an optional explanation.

Add tests as `{ "input": "2 3", "expectedOutput": "5" }`. Empty strings are valid. Input allows 100000 UTF-8 bytes and expected output allows 65536 bytes. NUL characters are rejected. Publication requires 1–100 tests.

Publish by patching visibility to public for practice or contest for a contest. Published definitions and hidden tests are fixed to keep judging consistent. Prepare corrections in a new draft. Delete only unused drafts and remove their tests first.

Problem lists accept page, limit, difficulty, tag and admin visibility. Lists default to 20 rows and allow at most 100.

## Contests

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /api/contests | Published/cancelled contests; admins also see drafts |
| POST | /api/contests | Admin creates a draft |
| GET | /api/contests/:id | Details, joined state and server time |
| PATCH | /api/contests/:id | Admin edits a draft, publishes or cancels before start |
| DELETE | /api/contests/:id | Admin deletes an unused draft |
| POST | /api/contests/:id/join | Join before the end, including during the contest |
| GET | /api/contests/:id/problems/:problemId | Joined students after start; admin preview |
| GET | /api/contests/:id/leaderboard | Current standings after start; admin preview |

Create with title, optional description, ISO startTime and endTime, and `problems: [{ problem: "<problemId>", points: 100 }]`. A contest allows up to 20 distinct problems.

Publish with `{ "status": "published" }` before its start. Every selected problem must have contest visibility and hidden tests. Weekly contests are scheduled by creating their dates; recurring generation is not implemented.

A problem cannot be reused in another published contest because its earlier participants could already know the statement. Create fresh problems for each contest. Cancelled contests release their problems for publication elsewhere.

Published settings cannot change. Cancellation is allowed before start. Upcoming contest endpoints hide problem IDs and statements from students. Joined students can read statements after start.

Receipt time is recorded after reading the request body and before authentication. A submission must arrive at or after start and strictly before end. Judging may finish later. The client clock never decides eligibility.

Each accepted problem earns its points once. Equal scores are ordered by the earlier time at which the student completed their scored problems, then user ID. Wrong answers have no penalty in this version. Joined students with zero points also appear.

## Runs and submissions

| Method | Route | Request or purpose |
| --- | --- | --- |
| POST | /api/submissions/run | language, code, optional input |
| GET | /api/submissions/runs/:id | Own custom run status and result; admins can inspect |
| POST | /api/submissions | problemId, language, code, optional contestId |
| GET | /api/submissions | Own history; page, limit, optional problemId and contestId |
| GET | /api/submissions/:id | Own source and result; admins can inspect |
| POST | /api/submissions/:id/retry | Empty body; retry an internal error using saved source |

Languages: c, cpp, java, python, javascript. Source allows 50000 UTF-8 bytes. Write complete programs reading standard input and printing standard output. Java runs its first top-level class in source-file mode.

Custom runs use only supplied input. POST returns HTTP 202 with a run ID; GET /api/submissions/runs/:id returns its status and, when completed, output/diagnostics. They never load hidden tests or change solved counts.

Submissions use [OnlineCompiler.io's synchronous API](https://onlinecompiler.io/docs) at /api/run-code-sync/. The server sends its REST API key in the Authorization header and maps c/cpp/java/python/javascript to gcc-15/g++-15/openjdk-25/python-3.14/nodejs-24. Each input runs sequentially in its own request. Each request has a 35-second timeout. The worker saves progress after each passed test and delays work when the shared request budget is exhausted. Temporary provider failures retry up to five attempts; permanent configuration failures stop immediately. Each test consumes a compiler request, so your provider plan determines judging throughput. API success alone does not mean an accepted answer.

The judge normalizes CRLF and removes trailing whitespace; leading and internal whitespace remain significant. The adapter converts reported seconds to milliseconds and keeps memory in KB; the judge checks both against problem limits after execution. This API does not configure a separate sandbox limit per problem. Nonzero exit codes, signals and truncated output fail the test. Stderr alone does not fail a program that exits successfully. The native API combines compiler and runtime diagnostics, so only recognized compilation, timeout and memory diagnostics receive those specific verdicts; ambiguous failures remain runtime_error. Missing usable metrics produce a retryable internal error.

Students never receive hidden inputs, expected outputs or raw hidden-test diagnostics. The first accepted solution creates one SolvedProblem record; later accepts do not increase its count.

Provider/database failures during background judging eventually set internal_error with safe diagnostics. If enqueueing fails after MongoDB saves a submission, HTTP 202 still returns its ID and worker recovery queues it later. Retry preserves original source, language and receipt time, including after the contest ends. A failed answer needs a new submission.

Runs, submissions and retries return HTTP 202 and are limited to five requests per student per minute. Workers share a global execution concurrency limit (default two). More submissions wait in the queue. Increase capacity only within the compiler account limits.

## Live updates

Connect Socket.IO using websocket transport and auth: { token: loginToken }. The API authenticates the student, joins their private user room and disconnects expired or revoked sessions. Logout and password changes also disconnect their devices.

After joining a contest through HTTP, emit contest:join with { contestId } and an acknowledgement callback. Successful acknowledgement includes serverNow. Emit contest:leave with the same payload to unsubscribe.

| Event | Payload | Client action |
| --- | --- | --- |
| submission:updated | { submission } | Update the owned submission status and passed-test count |
| run:updated | { run } | Fetch the custom run result when completed |
| leaderboard:updated | { contestId } | Fetch the contest leaderboard |
| contest:updated | { contestId } | Fetch contest details |

Sockets do not send hidden tests or source code. Notifications are best effort: fetch current status and rejoin contest rooms after reconnecting. Contest start/end access is enforced by server timestamps; use serverNow for the displayed countdown. There is no separate timer broadcast at each boundary.

## Verification

Run `npm test` in the server folder.

Tests cover controllers, authentication, password reset, worker retry/resume behavior, judging, localhost HTTP routes and concurrent Socket.IO clients. Database queries, email delivery and compiler calls are mocked in the default suite.

The live tests are opt-in and load the settings from .env. From PowerShell:

```powershell
$env:RUN_QUEUE_INTEGRATION="1"
node --env-file=.env --test tests/queue.integration.test.js
Remove-Item Env:RUN_QUEUE_INTEGRATION

$env:RUN_BACKEND_INTEGRATION="1"
node --env-file=.env --test tests/backend.integration.test.js
Remove-Item Env:RUN_BACKEND_INTEGRATION

$env:RUN_COMPILER_INTEGRATION="1"
node --env-file=.env --test tests/compiler.integration.test.js
Remove-Item Env:RUN_COMPILER_INTEGRATION
```

Queue and backend integration tests create isolated temporary databases and Redis namespaces, then remove only their own data. The backend and compiler tests consume a small number of real compiler executions. Email is captured inside the backend test rather than delivered.

Verified on 20 October 2026:

- 198 automated tests passed; the three live tests are skipped by default.
- Hosted Redis and MongoDB: 20 queued runs completed across two workers, with combined concurrency limited to two.
- Actual HTTP API: concurrent contest submissions executed through OnlineCompiler.io and reached accepted status. Duplicate accepted submissions counted only once in solved counts and leaderboard scores.
- Socket.IO: private verdicts and leaderboard notifications reached clients connected to two API servers through hosted Redis. Logout disconnected the matching user's socket across servers.
- Concurrent contest publication: two admins attempting to publish contests with the same problem produced one success and one conflict.
- Registration, OTP verification and password reset passed using real MongoDB transactions and captured mail. Password reset revoked the previous login.
- C, C++, Java, Python and JavaScript each produced the expected output with valid time and memory metrics. Invalid Python syntax produced compilation_error.
- SMTP authentication succeeded without sending email. Actual inbox delivery remains to be checked.
- Dependency audit reported zero known vulnerabilities.

These are functional and limited concurrency checks, not a full college-wide capacity benchmark. Before hosting a contest, verify inbox delivery, set Redis to noeviction, deploy the API and worker, and test the expected student load against your compiler plan. Frontend clients must refetch state and rejoin contest rooms after reconnecting.
