# CodeFAMT frontend

React + Vite client for the college coding platform. Includes account registration and recovery, profiles, practice problems and code execution, submission history, contests, administration, and student rankings.

## Run locally

Start the API and execution worker together in one terminal:

```powershell
cd server
npm run dev
```

Start the client in another terminal:

```powershell
cd client
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards API and socket traffic to http://localhost:6767. The server's `npm run dev` starts the execution worker automatically for Run and Submit.

## Pages and behavior

- Overview, problems, solved history, submissions, contests, and leaderboard require sign-in.
- Administration requires the backend admin role. New problem, new contest, and editing open accessible modal dialogs. Escape, the close button, or the backdrop dismisses a dialog; dismissal is blocked while saving. Saved problem drafts stay open to add hidden tests.
- The leaderboard uses `GET /api/users/leaderboard`. Combine department, year, and public-problem filters; changing filters resets pagination. Overall rankings count unique public problems solved, with equal totals sharing a rank. A specific problem ranks its solvers by first acceptance. The backend requires MongoDB 5.0+.
- Inter is bundled locally. Shared styles use 28px bold page headings, 14–15px text and controls, and 13px secondary table labels. Coding content keeps a monospace font.
- Browser login uses a persistent HttpOnly cookie valid for 30 days, including after a browser restart. Only a non-secret session marker is stored in sessionStorage. Expired or revoked sessions return to sign-in. Logout and password changes invalidate sessions. Production requires HTTPS, and the frontend/API must share a site for SameSite=Lax cookies. Passwords and OTPs stay in React memory.
- Socket updates remain active without a connection-status badge in the header.

## Checks

```powershell
npm test
npm run build
```

Frontend tests exercise account flows, execution and submission tracking, admin dialogs and payloads, and leaderboard filters/pagination using mocked API responses. Backend leaderboard tests include an opt-in isolated MongoDB fixture; see the server README.

## Deployment

Serve the frontend with a reverse proxy for `/api` and `/socket.io`, or set `VITE_API_URL` and, if needed, `VITE_SOCKET_URL` before building. Configure the server's `CLIENT_ORIGIN`. Configure the frontend host to serve index.html for routes such as /leaderboard.

Never place database, compiler, JWT, Redis, or SMTP secrets in frontend environment variables.
