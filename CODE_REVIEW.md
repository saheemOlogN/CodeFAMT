# Code review — 27 October 2026

Scope: source review of authentication, authorization, contest publication/access/deadlines, submission snapshots/retries, worker claims/recovery, score aggregation, test import, roadmap ownership, frontend state and deployment wiring. No app server, live database, email or compiler integration was started for this review.

## Corrections

- Contest publication now validates every problem's hidden-test collection, including the 100-test limit, byte limits, missing fields and NUL characters. Previously it only checked that each problem had some test record.
- The Java example puts its main entry class before Solution for compatibility with source-file launchers.
- Editor/admin/submission loading is split to reduce the initial frontend payload.
- Production serves the SPA and API from the same origin, applies basic response headers and disables API caching.
- Production validates required settings, transaction-capable MongoDB and Redis noeviction. Start commands allow platform-injected environment variables without requiring a local .env file.
- Added independent API/worker health checks, per-worker Redis heartbeats and bounded shutdown. Added HTTPS Compose deployment and CI checks.

## Consistency rules retained

- Admin publication and problem/test mutations use a shared transactional lock. Published schedules and judging data are immutable through normal routes.
- Contest eligibility uses the server receipt time and checks registration, contest membership and the exclusive end deadline.
- The execution snapshot preserves the submitted driver/source. Queue versions and processing claims prevent old workers from overwriting newer results.
- Acceptance and the unique user/problem solve record commit together. Contest scores group by problem, so duplicate accepted submissions do not award duplicate points.
- Practice exposure requires a published contest to have ended. Hidden tests/drivers are excluded from student problem responses.
- Roadmap progress is scoped to the authenticated account and follows stable topic IDs across edits/reordering.
- Cookie writes enforce the allowed origin. Logout/password changes increment the session version and revoke socket access.

## Limits of this review

Static review and isolated tests cannot establish that an application is bug-free. Deployment credentials, HTTPS issuance, email delivery, provider behavior, network failures, production data and expected student concurrency need the staging checks in DEPLOYMENT.md. Reference-solution validation is still an author responsibility. No published Git commits are rewritten; the existing remote history is preserved and the outstanding work is organized into focused local commits.

## Verification

- 81 server JavaScript files passed syntax checking without execution.
- 209 isolated backend tests passed; two opt-in database checks were skipped. HTTP/socket and live integration test files were excluded for this review.
- All 45 frontend checks passed across the suite and the targeted workspace rerun. The initial sandboxed worker launch timed out; a single-thread runner completed. The workspace rerun verifies the final page-level lazy-loading implementation.
- Production build passed. The initial JS bundle is approximately 370 KB uncompressed (115 KB gzip), down from approximately 1.14 MB. The editor route remains a larger on-demand chunk.
- Lint completed without errors and still reports existing hook/fast-refresh warnings.
- Docker is not installed in this environment, so image/Compose startup has not been validated here. No production secrets, database records or deployed services were changed by this review.
