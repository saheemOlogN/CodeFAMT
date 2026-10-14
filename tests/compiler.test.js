import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExecutionResult, runCode } from '../server/services/compilerService.js';
import { config } from '../server/config/env.js';
const success = {
  status: 'success',
  exit_code: 0,
  signal: null,
  output: '42\n',
  error: '',
  time: '0.0248',
};
test('OnlineCompiler output and timing are normalized', () => {
  assert.deepEqual(parseExecutionResult(success), {
    verdict: 'Accepted',
    output: '42\n',
    error: '',
    runtime: 25,
  });
});
test('runtime errors, timeout, and resource limits do not pass', () => {
  assert.equal(
    parseExecutionResult({ ...success, status: 'error', exit_code: 1 }).verdict,
    'Runtime Error',
  );
  assert.equal(
    parseExecutionResult({ ...success, status: 'error', exit_code: 0 }).verdict,
    'Runtime Error',
  );
  assert.equal(parseExecutionResult({ ...success, exit_code: 124 }).verdict, 'Time Limit Exceeded');
  assert.equal(
    parseExecutionResult({ ...success, exit_code: 137, signal: 9 }).verdict,
    'Resource Limit Exceeded',
  );
});
test('potentially truncated output is never accepted', () => {
  assert.equal(parseExecutionResult({ ...success, output: 'x'.repeat(998) }).verdict, 'Accepted');
  assert.equal(
    parseExecutionResult({ ...success, output: 'x'.repeat(999) }).verdict,
    'Output Limit Exceeded',
  );
});
test('malformed and asynchronous provider responses fail closed', () => {
  for (const result of [
    null,
    {},
    { status: 'queued', id: 42 },
    { ...success, exit_code: '0' },
    { ...success, output: null },
  ])
    assert.throws(() => parseExecutionResult(result));
});
test('REST adapter uses the sync endpoint, raw Authorization key, and provider fields', async (t) => {
  const previousKey = config.compilerKey;
  config.compilerKey = 'test-key';
  t.after(() => {
    config.compilerKey = previousKey;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.onlinecompiler.io/api/run-code-sync/');
    assert.equal(options.headers.Authorization, 'test-key');
    assert.deepEqual(JSON.parse(options.body), {
      compiler: 'python-3.14',
      code: 'print(42)',
      input: '',
    });
    return new Response(JSON.stringify(success), { status: 200 });
  });
  assert.equal(
    (await runCode({ source: 'print(42)', language: 'python-3.14', input: '' })).verdict,
    'Accepted',
  );
});
