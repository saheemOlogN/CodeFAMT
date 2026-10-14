import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server/app.js';
import { config } from '../server/config/env.js';
let server, base;
before(async () => {
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
test('health endpoint responds and hides Express signature', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.has('x-powered-by'), false);
  assert.deepEqual(await response.json(), { ok: true });
});
test('anonymous session is null', async () => {
  const response = await fetch(`${base}/api/auth/me`);
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('cross-origin mutations are blocked', async () => {
  const response = await fetch(`${base}/api/auth/otp`, {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@famt.ac.in' }),
  });
  assert.equal(response.status, 403);
});
test('submissions require authentication before queue access', async () => {
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { origin: config.origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 401);
});
test('admin writes require authentication', async () => {
  const response = await fetch(`${base}/api/admin/problems`, {
    method: 'POST',
    headers: { origin: config.origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 401);
});
test('submission history is private', async () => {
  assert.equal((await fetch(`${base}/api/submissions`)).status, 401);
  assert.equal((await fetch(`${base}/api/submissions/${'a'.repeat(24)}`)).status, 401);
});
test('malformed JSON returns a controlled error', async () => {
  const response = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { origin: config.origin, 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid JSON request.');
});
test('unknown API route returns JSON 404', async () => {
  const response = await fetch(`${base}/api/missing`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'API route not found.');
});
