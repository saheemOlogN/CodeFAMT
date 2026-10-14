# CodeFAMT

A MERN coding platform for FAMT students. React and Monaco on the frontend; Express, MongoDB, Redis, and BullMQ on the backend. Code execution uses OnlineCompiler.io.

## Structure

```text
server/
  index.js                 Starts the API and connects services
  app.js                   Express setup
  config/                  Environment, MongoDB, Redis
  routes/                  URLs and middleware only
  controllers/             Request handlers by feature
  models/                  One Mongoose model per file
  middlewares/             Authentication, admin access, rate limits, errors
  services/                Compiler, mail, sessions, queue, problem access
  validators/              Request schemas
  utils/                   Contest scoring and HTTP errors
  workers/judgeWorker.js   Background submission judging
client/
  App.jsx                  Navigation and routes
  pages/                   Problems, editor, contests, community, admin
  components/              Shared UI and editable test-case fields
  context/                 Session state
  api.js                   HTTP requests
  styles.css               Minimal responsive dark/light UI
shared/catalog.js          Topic names, language IDs, editor templates
```

Routes call named controller functions. Controllers validate input and use models or small services. The code uses plain JavaScript and standard Express middleware; there are no repository classes or controller factories.

## Run locally

Use Node.js 22.12+ and npm. The project has been tested with Node 24.

```powershell
npm install
```

If `.env` does not exist, copy `.env.example` to `.env`. Do not overwrite an existing `.env`: the local compiler key is stored there. Neither `.env` nor its secrets belong in Git or in frontend `VITE_` variables.

Configure MongoDB, Redis, SMTP, a random `AUTH_SECRET` of at least 32 characters, and your college email in the comma-separated `ADMIN_EMAILS` setting. Generate a secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If Docker is installed, the included development services can be started with:

```powershell
docker compose up -d
```

MongoDB listens on `127.0.0.1:27017`; Redis on `127.0.0.1:6379`. Mailpit captures local SMTP messages on port 1025; read them at http://127.0.0.1:8025. Mailpit does not deliver to real college inboxes. Real delivery requires a configured SMTP provider.

```powershell
npm run dev
```

In a second terminal:

```powershell
npm run worker
```

Open http://127.0.0.1:5173. The API runs on port 4000. `APP_ORIGIN` must match the browser's origin exactly.

For the frontend alone, use `npm run dev:client`. When the API is unavailable, the UI shows an error and a Retry action. It never substitutes sample problems or fake rankings.

## Problems and administration

**All problems are created by an administrator and stored in MongoDB.** There is no bundled problem list, seed command, or offline problem fallback. An empty database produces an empty library. Existing database records are not automatically deleted by source changes.

1. Add your `@famt.ac.in` address to `ADMIN_EMAILS` and sign in using the email OTP.
2. Open Admin and enter the problem title, URL slug, topic, difficulty, statement, input/output format, and constraints.
3. Add public examples and private test cases using the input/output fields. Include the examples in the hidden suite if they should count in judging.
4. Publish to make a problem available in practice, or leave it as a draft for a contest.
5. Schedule a future contest using 1–6 unused draft problems. Assign points; the duration is always 60 minutes.

OTP codes expire after ten minutes, allow five attempts, and have a resend cooldown. Sessions use HttpOnly cookies and Redis expiry. Only the exact `famt.ac.in` email domain is accepted.

Scheduled/live contest problems and problems with pending submissions cannot be edited. Upcoming questions remain private; registered participants can open them once the contest starts. After a contest ends, admins can publish its problems to the practice library.

## OnlineCompiler integration

The adapter is `server/services/compilerService.js`. It uses the [documented synchronous REST endpoint](https://onlinecompiler.io/docs) with a raw API key in the Authorization header. There is no browser-side provider key or callback endpoint.

Supported editor choices are Python (`python-3.14`), C++ (`g++-15`), Java (`openjdk-25`), and TypeScript (`typescript-deno`). Each language was checked with a live stdin/stdout smoke test. Java programs use `public class Main`; TypeScript runs on Deno.

The provider enforces a 30-second execution timeout and truncates stdout at 999 characters. This app limits expected outputs to 998 characters and rejects outputs at the truncation boundary. Use short-output problems. A killed process receives a resource-limit verdict when the response cannot distinguish memory exhaustion from a timeout. Compiler/runtime diagnostics are visible for Run; hidden-test diagnostics are not returned by Submit.

The queue caps judging at four concurrent submissions across worker processes, matching the provider's documented synchronous concurrency limit. A shared Redis request-rate budget adds pacing. Each test case is a separate provider execution; infrastructure failures retry before becoming System Error. Other applications sharing the same provider key also consume its capacity.

## Contest rules

- Full problem points only when every hidden test passes.
- Rank by total points, then the sum of elapsed seconds to each first accepted submission.
- Exact ties share a rank. Registered students with no solves are included.
- Wrong attempts have no penalty.
- The server records request receipt time; judging may finish after the contest deadline.
- Rankings refresh every ten seconds. Each weekly contest is scheduled explicitly by an admin.

Programs read stdin and write stdout. They are complete programs, not function-only LeetCode submissions. Comparison ignores trailing spaces on each line and trailing blank lines, and normalizes CRLF. Interactive problems and custom answer checkers are not supported.

MongoDB is authoritative for submissions and results. The worker recovers pending database records after a queue outage. Redis also holds OTPs, sessions, and rate limits.

## Checks and formatting

```powershell
npm test
npm run build
npm run format
```

Tests cover request access, email validation, contest timing/ranking, hidden-field projections, compiler response parsing, truncation handling, and the provider request contract. The live compiler checks are separate from the automated tests. Full OTP/database/queue integration still requires running MongoDB, Redis, and SMTP services.

## Deployment

Run `npm run build`, then supervise `npm start` and `npm run worker` separately. Set `NODE_ENV=production` and an HTTPS `APP_ORIGIN`. Express serves the built frontend and listens on loopback; place a reverse proxy on the same host. Configure trusted proxy addresses explicitly before relying on client-IP limits. Use managed credentials, backups, monitoring, and test the expected contest burst before launch.

The Compose file is for local development. Monaco loads from its CDN; system fonts are used. The problem library currently returns up to 500 problems, contest listings 100, recent submission history 50, and the community board 50. Add pagination and cached/materialized rankings as the dataset grows.
