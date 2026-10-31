# Deployment review — 31 October 2026

## Decision

Ready to proceed to a staging deployment, not yet verified for a live college contest. Source checks and a frontend build cannot establish production reliability or student capacity.

## Fixed in this review

- Removed 586 tracked server/node_modules files from the Git index without deleting the local installation. npm ci installs the locked dependencies in CI and Docker. Existing historical commits still contain these files; history was not rewritten.
- Updated transitive body-parser from 2.3.0 to 2.4.0 to fix the high-severity compressed-request denial-of-service advisory GHSA-27r3-jxmh-p828.
- Added a CI repository check rejecting tracked dependency/build directories, environment files other than templates, logs, and private-key filenames. This is a filename safeguard, not a full secret-content scanner.
- Added production Docker image compilation to CI. This check will run after the changes are pushed; no CI result is claimed here.
- Added the public /intuition page with the college-platform motivation and developer/technical-admin links.

## Checks performed

Reviewed Docker/Compose packaging, production environment validation, same-origin routing, cookie authentication and origin enforcement, shared rate limiting, transaction-capable MongoDB startup, queue limits, Redis persistence/noeviction, health checks and deployment instructions. Also ran the isolated contest, submission, worker, authorization and other backend suites.

- Backend: 212 passed, 2 opt-in checks skipped. HTTP/socket and integration test files were excluded; the app was not started.
- Frontend: all 45 tests passed; production build succeeded.
- Lint: no errors; existing React hooks/fast-refresh and unused-variable warnings remain.
- npm security audit: zero known server production vulnerabilities after the fix; zero frontend/build dependency vulnerabilities at review time.
- Repository hygiene check and whitespace checks passed. No tracked environment credential files or PEM/key files appeared in the checked paths/history. This does not certify the complete history free of secrets.
- Docker is unavailable on this machine. No image build, Compose startup, staging deployment, browser visual check or load test was performed locally. The editor remains an approximately 725 KB uncompressed on-demand chunk.

## Before inviting students

Follow DEPLOYMENT.md using a staging database and separate Redis namespace. Confirm Docker build/start, HTTPS and both health endpoints; actual verification/reset emails; browser login persistence and revocation; real compiler results for correct, wrong, invalid and boundary solutions; contest start/end eligibility and duplicate scoring; worker restart/recovery; and backups with a tested restore. Run the expected student load before a real contest.

The default compiler budget is 30 requests per minute shared across workers. Each example or hidden testcase uses one request; a ten-test accepted submission costs ten requests. This is a material capacity limit and is not increased by adding API/worker replicas. The Problems listing still loads metadata for client-side filtering. The supplied single-host deployment also has no host redundancy or configured external monitoring/backup service.

## Publishing these changes

The cleanup removes node_modules from the next Git tree after commit/push; it does not shrink old Git history. Keep package-lock.json tracked. Do not force-push or rewrite shared history just to remove historical dependency files.
