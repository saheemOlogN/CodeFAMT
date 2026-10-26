# Deploying CodeFAMT

The supplied setup runs one HTTPS gateway, one API, one judge worker and persistent Redis on a Linux host. MongoDB is external and must be a replica set (for example Atlas). The frontend, API and WebSocket endpoint share a domain so the existing 30-day HttpOnly session cookie works without cross-site cookie exceptions.

## First deployment

1. Install Docker Engine and the Compose plugin on the host. Point the domain's DNS records at that host. Open inbound TCP 80/443; keep MongoDB access restricted to the host's outbound IP. Do not expose Redis, the API port or the worker health port publicly.
2. Clone the repository and copy the root `.env.example` to `.env`. Set `DOMAIN` to the actual hostname (without `https://`).
3. Copy `server/.env.example` to `server/.env.production`. Fill in MongoDB, compiler and SMTP credentials. Set `CLIENT_ORIGIN=https://your-hostname`, with no trailing slash. Generate separate random JWT/OTP secrets, at least 32 characters each. Compose overrides NODE_ENV, Redis URL, API port and trusted proxy count. Keep these files private and out of Git. Leave frontend API/socket build variables unset for this same-origin deployment.
4. Use the existing database containing your verified admin, or establish a verified account and promote only that account through a trusted database administration session. There are no default admin credentials. Do not run the test-content reset utility against student data.
5. Run `docker compose config --quiet`, then `docker compose build` and `docker compose up -d`. Caddy obtains and renews the HTTPS certificate. `docker compose ps` should show healthy API, worker and Redis containers after startup.
6. Check `/health/live` and `/health/ready` over HTTPS. Readiness is 503 if MongoDB/Redis is unavailable or no worker has sent a heartbeat for 45 seconds. Configure an external monitor and alert recipient for this endpoint; Compose marks unhealthy containers but does not itself restart a process merely because it is unhealthy.
7. Before inviting students, perform the staging checklist below. These runtime checks have deliberately not been performed as part of the latest static review.

Production startup rejects missing credentials, short signing secrets, invalid origins/ports, standalone MongoDB and Redis eviction policies other than `noeviction`. API responses are not cached. Browser routes fall back to the frontend entry point; unknown API routes return JSON 404s. Only the gateway publishes host ports. `TRUST_PROXY=1` assumes exactly this private, single-hop gateway; change it deliberately if the network topology changes.

## Staging checklist

- Verify actual OTP and password-reset email delivery, not just SMTP authentication. Check sender-domain configuration with your email provider.
- Sign in, refresh, close/reopen the browser, then test logout and password reset revocation.
- Create a draft contest, attach problems, import JSON tests, save and publish before the start. Confirm unregistered students cannot read its problems early.
- Validate every enabled language's hidden driver with a known correct solution, wrong answer, compilation error and boundary cases. Publication validates structure and test size, not semantic correctness or reference solutions.
- Check submissions just before start, at start, just before end and at end. The server receipt time decides eligibility; delayed judging can update standings after the contest ends.
- Confirm duplicate accepted submissions award points only once, and that practice access opens after the contest ends.
- Restart a worker with queued jobs and confirm recovery. Test a Redis interruption, compiler throttling and browser socket reconnection. Monitor queue depth and oldest waiting submission age.
- Load-test the expected number of concurrent students before a real event. No capacity claim follows from unit tests or a successful build.

## Judge capacity and operations

`JUDGE_CONCURRENCY` defaults to 2 and `COMPILER_RUNS_PER_MINUTE` to 30. Every hidden testcase uses a compiler request, so ten-test accepted submissions consume ten requests each. Custom runs and retries consume additional requests. Raising worker count cannot bypass the shared provider budget; increase limits only when your compiler plan permits it. The current design recompiles per testcase and uses provider-reported time/memory to judge against problem limits; it does not configure a custom sandbox per problem.

Redis uses AOF persistence and a 256 MB no-eviction budget. Monitor memory and disk usage and size these for your workload. MongoDB retains submissions and recovery state, but is not a replacement for Redis persistence or backups. API and worker processes stop gracefully with a 30-second deadline; unfinished claims are recovered by the queue after restart. Synchronize host clocks (NTP), particularly if moving to multiple machines.

## Backups, updates and rollback

- Enable scheduled MongoDB backups with a retention policy suitable for the institution. Save a backup before release or data migration and rehearse a restore to a separate database. Back up Redis and Caddy volumes using a consistent host/volume snapshot procedure. Store backups off the application host with restricted access.
- Never use `docker compose down -v` during an upgrade; it removes persistent volumes. Do not store backups or secrets in Docker images or Git.
- Tag the image with the release commit and retain the previous image before deploying. Build and test in CI, schedule changes outside live contests, then replace API/worker containers together. Check readiness and logs before reopening traffic.
- Roll back to the retained image only if the previous version is compatible with current data. Do not restore an old database over new student submissions without an explicit recovery decision.
- Monitor failed jobs, compiler quota, API errors, worker heartbeats, disk and database capacity. The repository supplies probes and CI, not a hosted alerting service or a backup subscription.

The Problems page still fetches metadata across all pages for client-side filtering. Server-side search/pagination and a larger-scale judge design are follow-up work before growing far beyond a small pilot.
