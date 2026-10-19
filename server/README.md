# CODEFAMT backend

Plain CommonJS JavaScript. Express setup stays in index.js. Controllers use named async functions, direct model calls and try/catch.

## Start

Use Node.js 24. From the server folder, run `npm install`, then `npm run dev`.

The npm scripts load .env. Configure PORT, MONGODB_URI, JWT_SECRET, OTP_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, ONECOMPILER_API_KEY and CLIENT_ORIGIN. Keep secrets in this ignored file.

Use MongoDB Atlas or a replica set. An accepted submission and its solved-problem record are saved in a transaction so both changes succeed together. Standalone MongoDB does not support these transactions. See [MongoDB requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/) and [Mongoose transactions](https://mongoosejs.com/docs/transactions.html).

Run exactly one API process for this version. The execution counter, request limits, admin-write guard and restart recovery are local to that process. Do not run overlapping instances or rolling restarts against the same database yet. Startup prepares indexes and changes interrupted running submissions to internal_error so their owners can retry.

## Understand the flow

1. A route connects an HTTP URL to a controller.
2. Authentication middleware checks the token and loads the verified student.
3. Admin middleware protects problem, hidden-test and contest management.
4. The controller validates the request and uses the models.
5. The controller returns JSON.

Submission flow: check access and contest timing, save source, execute hidden inputs through OneCompiler, compare results, save the verdict and first solve. The client cannot choose its verdict, score, user ID or receipt time.

| Model | Purpose |
| --- | --- |
| User | Profile, college email, password hash, role, verification and session version |
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

Add tests as `{ "input": "2 3", "expectedOutput": "5" }`. Empty strings are valid. Each field allows 100000 UTF-8 bytes, with 1–100 tests required for publication.

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

Published settings cannot change. Cancellation is allowed before start. Upcoming contest endpoints hide problem IDs and statements from students. Joined students can read statements after start.

Receipt time is recorded after reading the request body and before authentication. A submission must arrive at or after start and strictly before end. Judging may finish later. The client clock never decides eligibility.

Each accepted problem earns its points once. Equal scores are ordered by the earlier time at which the student completed their scored problems, then user ID. Wrong answers have no penalty in this version. Joined students with zero points also appear.

## Runs and submissions

| Method | Route | Request or purpose |
| --- | --- | --- |
| POST | /api/submissions/run | language, code, optional input |
| POST | /api/submissions | problemId, language, code, optional contestId |
| GET | /api/submissions | Own history; page, limit, optional problemId and contestId |
| GET | /api/submissions/:id | Own source and result; admins can inspect |
| POST | /api/submissions/:id/retry | Empty body; retry an internal error using saved source |

Languages: c, cpp, java, python, javascript. Source allows 50000 UTF-8 bytes. Write complete programs reading standard input and printing standard output. Java uses Main.

Custom runs use only supplied input and return output/diagnostics. They never load hidden tests or change solved counts.

Submissions use the [OneCompiler batch API](https://onecompiler.org/apis/code-execution), with X-API-Key and a 30-second request timeout. API success alone does not mean an accepted answer.

The judge normalizes CRLF and removes trailing whitespace; leading and internal whitespace remain significant. It checks reported time in milliseconds and memory in KB against problem limits after execution. This API does not configure a separate sandbox limit per problem. Exceptions or stderr fail the test. Missing usable metrics produce a retryable internal error.

Students never receive hidden inputs, expected outputs or raw hidden-test diagnostics. The first accepted solution creates one SolvedProblem record; later accepts do not increase its count.

Provider/database failures return a generic error and, when available, a submission ID. Retry preserves original source, language and receipt time, including after the contest ends. A failed answer needs a new submission.

Judging currently happens within the HTTP request, with four active executions per process and five runs/submissions/retries per student per minute. Extra requests receive 429. Redis queue workers and Socket.IO updates are a later stage. The leaderboard currently updates when its GET endpoint is requested.

## Verification

Run `npm test` in the server folder.

Tests cover controllers, authentication, judging, concurrency guards and localhost HTTP routes. Database queries, email delivery and OneCompiler calls are mocked. Live MongoDB transactions, SMTP delivery and OneCompiler responses still need an integration check with configured services before a college contest.
