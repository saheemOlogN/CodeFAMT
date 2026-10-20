**CODEFAMT backend study guide**

Read this alongside the files in server. Begin with the profile request near the end, then work through registration and submissions.

**The overall structure**

CODEFAMT runs two Node.js programs:

- index.js starts the API and Socket.IO server. It handles requests from the frontend.
- worker.js starts the execution worker. It processes code execution jobs in the background.

Both connect to the same MongoDB database and Redis instance. OnlineCompiler.io executes submitted programs. SMTP delivers verification and password-reset emails.

MongoDB stores users, problems, submissions, contests and results. Redis stores execution queue state, shared request counters and carries live notifications between processes.

The frontend requests an action through HTTP. For background judging, it receives a queued submission ID first, then learns about later changes through Socket.IO or a GET request.

**Top-level files**

| File or directory | Responsibility |
| --- | --- |
| index.js | Builds Express, enables browser-origin access and JSON parsing, mounts routes, connects services, attaches Socket.IO and listens on PORT. Also closes connections when stopping. |
| worker.js | Connects MongoDB and the queue, recovers unfinished work, starts workers and runs recovery every 15 seconds. |
| package.json | Lists libraries and commands such as npm run dev, npm run worker:dev and npm test. |
| package-lock.json | Records resolved dependency versions so installations can reproduce them. |
| .env | Holds configuration and credentials. npm start/dev/worker scripts load it using Node's --env-file option. |
| README.md | Setup instructions, endpoint reference, socket events and verification notes. |
| BACKEND_STUDY_GUIDE.md | This explanation of the implementation and reading order. |
| node_modules/ | Installed dependency code. npm maintains this directory. |

In index.js, require.main === module means "start listening when this file is run directly." Tests can require the exported Express app and start it on their own port.

http.createServer(app) gives Express and Socket.IO the same HTTP server and port.

**config/ connects shared services**

| File | Responsibility |
| --- | --- |
| db.js | Connects Mongoose to MongoDB, prepares model indexes, fills missing version fields in older records, and creates the admin lock record. Enables transaction context so admin controller database operations share their transaction. |
| redis.js | Creates Redis connections, provides a shared client, sets reconnection behavior and closes the shared client. |
| socket.js | Starts Socket.IO, connects its Redis adapter, authenticates sockets, manages user/contest rooms and disconnects expired or revoked logins. |

An index helps MongoDB find records efficiently. A unique index also prevents duplicate records, even when two requests arrive together.

**models/ describes stored data**

A Mongoose schema defines fields, allowed values, defaults and indexes. A model uses that schema to read and write MongoDB documents.

| File | What its documents represent |
| --- | --- |
| user.model.js | A college account: name, department, year, college email, password hash, role, verification state and tokenVersion. |
| otp.model.js | A registration verification request: user, OTP hash, expiration, resend time and attempts. |
| passwordReset.model.js | A password-reset OTP request, kept separate from registration OTPs. |
| problem.model.js | A problem statement, examples, difficulty, tags, constraints, resource limits, visibility and creator. |
| testCase.model.js | A hidden input and expected output belonging to one problem. |
| submission.model.js | One judged attempt: user, problem, optional contest, source, language, status, passed tests, metrics and recovery progress. |
| solvedProblem.model.js | A unique user/problem pair recording that the student has solved that problem. |
| contest.model.js | A contest's title, start/end times, status and selected problems with their points. |
| contestParticipant.model.js | A unique user/contest pair recording registration. |
| codeRun.model.js | A custom-input execution and its private result. It expires after 24 hours. |
| adminLock.model.js | A shared database record used to coordinate admin writes inside transactions. |

Important relationships:

- A problem has many TestCase records and many Submission records.
- A user has many submissions, solved-problem records and contest registrations.
- A contest lists problem IDs and points. ContestParticipant records store its participants.
- A submission links its user and problem, and optionally its contest.

The unique SolvedProblem index allows ten accepted submissions for the same problem to count as one solved problem.

select: false excludes a field from ordinary Mongoose query results. Authorized backend code explicitly requests it with select("+field"). Controllers still need ownership checks and safe response fields; select: false is not an access-control system.

**routes/ connects URLs to functions**

index.js supplies the URL prefix. Each router supplies the remaining path and middleware.

| File | Prefix and responsibilities |
| --- | --- |
| auth.routes.js | /api/auth: registration, verification, resend, login, logout, forgot password and reset password. |
| user.routes.js | /api/users: profile, profile updates, solved history and password change. |
| problem.routes.js | /api/problems: problem browsing and admin changes; also contains the nested hidden-test routes. |
| contest.routes.js | /api/contests: contest management, joining, problem access and leaderboard. |
| submission.routes.js | /api/submissions: custom runs, submissions, result/history retrieval and retries. Also records server receipt time before authentication. |

For example, app.use("/api/users", userRoutes) plus router.get("/me", getProfile) produces GET /api/users/me.

There is no separate hidden-test router: problem.routes.js calls the testCase controller.

**middleware/ checks requests before controllers**

| File | Responsibility |
| --- | --- |
| auth.middleware.js | Checks the Bearer token, verifies its signature/expiry, loads the verified user, checks tokenVersion and attaches the user to req.user. |
| admin.middleware.js | requireAdmin checks req.user.role. adminWrite wraps a change in a database transaction, coordinates competing admin writes and sends the response after the transaction commits. |
| rateLimit.middleware.js | Limits authentication attempts, attempts per email, executions per student and password changes. Configured Redis shares counters between API processes. |
| error.middleware.js | Formats malformed JSON, oversized body and other forwarded errors into safe HTTP responses. |

Middleware calls next() when the request can continue. Returning a response stops that path.

req.body holds submitted JSON; req.params holds path values such as :id; req.query holds values after ?; req.user is supplied by authentication middleware.

Controllers often handle their own expected errors with try/catch. error.middleware.js handles parsing errors and errors forwarded through Express.

**controllers/ performs requested actions**

| File | Main functions and decisions |
| --- | --- |
| auth.controller.js | register, verifyOtp, resendOtp, login, logout. Restricts registration to college email, hashes passwords, verifies OTPs and issues/revokes login tokens. |
| passwordReset.controller.js | forgotPassword and resetPassword. Sends a separate reset OTP and consumes it in a transaction while changing the password and revoking sessions. |
| user.controller.js | getProfile, updateProfile, getSolvedProblems, changePassword. Handles the logged-in student's account and solved history. |
| problem.controller.js | createProblem, getProblems, getProblem, updateProblem, deleteProblem. Controls drafts/publication, visibility and whether a definition may change. |
| testCase.controller.js | createTestCase, getTestCases, updateTestCase, deleteTestCase. Validates hidden data and restricts access and changes to eligible problems. |
| contest.controller.js | createContest, getContests, getContest, updateContest, deleteContest, joinContest, getContestProblem, getLeaderboard. Enforces schedules, publication, registration and scoring. |
| submission.controller.js | runCode, getRun, submitCode, getSubmissions, getSubmission, retrySubmission. Checks input/access/timing, saves queued work and exposes owned results. |

A controller follows a familiar pattern: validate the request, check access and current state, read/write models, then return a response.

Business rules belong here or in the worker's judging logic. Examples: a student must join before submitting to a contest; only an internal-error submission can be retried using its original source.

**utils/ contains reusable operations**

| File | Responsibility |
| --- | --- |
| sendOtp.js | Generates a six-digit verification code, saves its HMAC hash with expiry/cooldown and sends the code through SMTP. |
| executionQueue.js | Creates the BullMQ queue, sets shared worker concurrency and adds submission/custom-run jobs identified by record ID and version. |
| providerLimit.js | Uses an atomic Redis operation to share the compiler request budget across workers. Returns a delay when the budget is exhausted. |
| executeCode.js | Maps our language names to OnlineCompiler.io compiler IDs, sends code/input and converts the response into a consistent result format. |
| judgeResults.js | Compares execution output against expected output and checks errors/time/memory. Returns a verdict without making network or database calls. |
| gradeSubmission.js | Executes hidden tests one at a time, saves progress, stops at the first failing test and saves the final verdict. Acceptance and first-solve persistence share a transaction. |
| realtime.js | Publishes safe submission/run updates, contest and leaderboard notifications, and user-disconnection requests. Uses the local Socket.IO server or a Redis emitter. |

executeCode answers "what did this program produce?" judgeResults answers "does that result pass this test?" gradeSubmission coordinates those operations for a complete submission.

**workers/ processes background jobs**

execution.worker.js contains three main functions:

- processExecution claims a queued record, marks it running, then runs custom input or grades hidden tests. It handles delays, retryable errors and final internal errors.
- recoverPendingJobs scans unfinished MongoDB records. Missing queue jobs are recreated; records whose queue job has already ended without a final database result become internal errors.
- createWorker starts a BullMQ worker with concurrency, connection handling and retry backoff.

worker.js starts the process. workers/execution.worker.js implements its job behavior.

MongoDB saves the source and progress. Queue job data contains the record ID and version. This lets the worker reload the latest record and lets recovery rebuild a missing queue entry.

**tests/ checks behavior**

| File | Coverage |
| --- | --- |
| auth.test.js | Registration, OTPs, verification transactions, login, logout and mail behavior with mocks. |
| auth.middleware.test.js | Missing, malformed, expired and revoked tokens, plus verified-user access. |
| passwordReset.test.js | Reset OTP expiry, attempt limits, concurrent requests, consumption and password-change transactions. |
| user.test.js | Profile fields, solved history, password validation and session revocation. |
| problem.test.js | Problem and hidden-test rules, publication, visibility and validation. |
| contest.test.js | Contest schedules, publication, joining, problem access and leaderboard rules. |
| submission.test.js | Submission/run validation, queueing, ownership, contest receipt time and retry rules. |
| judgeResults.test.js | Correct output, whitespace rules, resource limits, runtime/compile errors and invalid results. |
| executeCode.test.js | Compiler request/response handling, timeouts and safe failures with mocked network calls. |
| worker.test.js | Claims, saved progress, retries, duplicate solves, stale workers and queue recovery with mocks. |
| socket.test.js | Authentication, private rooms, contest subscriptions, concurrent clients and adapter/emitter behavior. |
| routes.test.js | Local HTTP requests through Express routes and middleware with mocked database calls. |
| db.test.js | Database startup initialization with mocked database operations. |
| queue.integration.test.js | Opt-in real MongoDB/Redis test with 20 jobs and two workers, using simulated compiler results. |
| backend.integration.test.js | Opt-in real HTTP/MongoDB/Redis/compiler/socket flow, including contest scoring and account flows with captured email. |
| compiler.integration.test.js | Opt-in live executions for all five languages and a syntax-error verdict. |

npm test runs the default suite. Live integration tests require explicit environment flags; README.md contains their commands. Default tests may open local HTTP/WebSocket connections, but do not need the configured hosted services.

**Trace 1: opening your profile**

1. The frontend sends GET /api/users/me with its Bearer token.
2. index.js matches /api/users and passes control to user.routes.js.
3. router.use(requireAuth) runs auth.middleware.js.
4. Authentication verifies the token, loads User and sets req.user.
5. The /me route calls getProfile in user.controller.js.
6. The controller counts this user's SolvedProblem records and builds a safe profile response.
7. res.status(200).json(...) sends the result to the frontend.

Follow these four files in order: index.js, routes/user.routes.js, middleware/auth.middleware.js, controllers/user.controller.js. Then inspect models/user.model.js and models/solvedProblem.model.js.

**Trace 2: registration and login**

1. POST /api/auth/register passes through authentication/account rate limits.
2. register validates college email and profile data, hashes the password and creates an unverified student when needed.
3. sendOtp stores a hashed OTP and sends its plain six-digit code to the student's email.
4. POST /api/auth/verify-otp sends the registration details and OTP.
5. verifyOtp reserves an attempt, checks the OTP hash and validates the final profile.
6. A MongoDB transaction consumes that OTP and activates the account together. A failed transaction does not leave a consumed OTP with an unverified account.
7. POST /api/auth/login compares the password hash and requires email verification.
8. Login returns a one-hour JWT plus safe profile fields.
9. Protected requests use that token. Logout/password changes increment tokenVersion, invalidating older tokens.

Passwords are hashed with bcrypt. OTPs use a keyed HMAC hash. These serve different purposes and are separate implementations in this project.

**Trace 3: an admin publishes a problem**

1. POST /api/problems goes through requireAuth, requireAdmin and adminWrite.
2. createProblem saves a draft.
3. POST /api/problems/:problemId/tests adds hidden input/output pairs.
4. PATCH /api/problems/:id publishes the draft with public or contest visibility.
5. Publication checks its hidden tests. Published definitions are fixed to keep later judging consistent.

The admin lock causes competing admin transactions to coordinate. Responses are buffered until the transaction succeeds, so the frontend is not told a change succeeded before it commits.

**Trace 4: submitting an answer**

1. POST /api/submissions reaches submission.routes.js. It records server receipt time after the JSON body has been parsed.
2. Authentication identifies the student. The execution limiter checks their request count.
3. submitCode validates language/source, loads the problem and checks access.
4. For a contest, it checks that the contest is published, contains this problem, the user joined before receipt, and startTime <= receivedAt < endTime.
5. It validates the test set and saves a queued Submission in MongoDB.
6. executionQueue adds a job referencing that submission ID and queueVersion.
7. The API returns HTTP 202 with the queued submission. This means the work was accepted for processing.
8. processExecution claims the record and marks it running.
9. gradeSubmission checks compiler capacity, calls executeCode for one hidden input, and passes the result to judgeResults.
10. After each passed test, it saves progress. At the first failed test it stops and saves that verdict.
11. If all tests pass, acceptance and the unique SolvedProblem record are saved in one transaction.
12. realtime publishes the result. Accepted contest submissions also produce a leaderboard notification.

Common status transitions:

queued -> running -> accepted

queued -> running -> wrong_answer / compilation_error / runtime_error / time_limit_exceeded / memory_limit_exceeded

running -> queued -> running during retries or capacity delays

running -> internal_error when execution cannot be completed

Custom Run uses CodeRun, the user's supplied input and executeCode. It does not judge hidden tests or increase solved counts.

**Trace 5: real-time contests**

1. The student logs in through HTTP.
2. The frontend connects Socket.IO using that token.
3. socket.js authenticates the connection and adds it to user:<userId>.
4. The student joins a contest through its HTTP join endpoint.
5. The frontend emits contest:join with contestId and an acknowledgement callback.
6. socket.js verifies registration and visibility before joining contest:<contestId>.
7. The worker publishes a safe submission:updated event to the owner's user room.
8. For an accepted contest submission it also publishes leaderboard:updated to the contest room.
9. Clients receiving that notification fetch GET /api/contests/:id/leaderboard.
10. The controller calculates standings from accepted submissions, counting each problem once per participant.

Redis carries the worker's event to API servers. Their Socket.IO adapters deliver it to matching connected clients. Redis also lets a logout request on one API instance disconnect that user's sockets on another.

Leaderboard updates are notifications to fetch standings; they do not contain the complete table.

The server enforces contest deadlines through timestamps. It does not need a scheduled job to change status to "running" or "ended". The frontend can display a countdown using serverNow, startTime and endTime.

Socket events are best effort. On reconnect, the frontend must fetch current state and rejoin contest rooms.

**The fields that need a little extra explanation**

| Concept | Why it exists |
| --- | --- |
| tokenVersion | A login carries the current version. Increasing the user's stored version invalidates older logins. |
| queueVersion | Manual retries create a new queue version. An old job cannot act on the new retry. |
| processingToken | Identifies the worker's current claim. Updates include it in their filter, preventing an older worker from overwriting a newer claim. |
| judgeProgress | Records which hidden tests already passed so infrastructure retries can resume. |
| Transaction | Groups database changes so they commit together or roll back together, such as acceptance and the solved record. |
| upsert | Updates an existing matching record or inserts one when missing. Used with unique indexes for joins and first solves. |
| TTL index | Lets MongoDB eventually remove expired OTPs and custom runs. Controllers also check expiry because cleanup is not immediate. |
| await | Waits for an operation's result before this async function continues. Other requests can continue while it waits on I/O. |

**Suggested study order**

1. Trace the profile request and learn req, res, next, routes and models.
2. Study registration, OTP verification, login and tokenVersion.
3. Follow admin draft creation, hidden tests and publication.
4. Study custom Run before hidden-test submission judging.
5. Trace submitCode, executionQueue, the worker and the three judging utilities.
6. Study contest membership, timing and leaderboard aggregation.
7. Study Socket.IO rooms and Redis delivery.
8. Read the corresponding test file after each feature.

For every function, answer: who calls it, what inputs does it receive, what does it validate, which data does it change, and what happens when it fails?
