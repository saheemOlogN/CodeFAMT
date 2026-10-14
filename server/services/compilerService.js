import { redis } from '../config/redis.js';
import { config } from '../config/env.js';

async function waitForSlot() {
  const limit = Math.max(1, Number(process.env.COMPILER_REQUESTS_PER_SECOND || 2));
  while (true) {
    const [count, remaining] = await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],1000) end; return {n,redis.call('PTTL',KEYS[1])}",
      1,
      'compiler:rate',
    );
    if (count <= limit) return;
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, remaining)));
  }
}

export async function execute(program) {
  await waitForSlot();
  return runCode(program);
}

export async function runCode({ source, language, input }) {
  if (!config.compilerKey) throw new Error('OnlineCompiler API key is missing.');
  const response = await fetch(`${config.compilerUrl}/api/run-code-sync/`, {
    method: 'POST',
    signal: AbortSignal.timeout(40000),
    headers: { Authorization: config.compilerKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ compiler: language, code: source, input }),
  });
  if (!response.ok) throw new Error(`OnlineCompiler returned HTTP ${response.status}.`);
  return parseExecutionResult(await response.json());
}

export function parseExecutionResult(result) {
  if (
    !result ||
    !['success', 'error'].includes(result.status) ||
    !Number.isInteger(result.exit_code) ||
    typeof result.output !== 'string' ||
    typeof result.error !== 'string'
  ) {
    throw new Error('Unexpected OnlineCompiler response.');
  }
  const runtime = Number.isFinite(Number(result.time))
    ? Math.max(0, Math.round(Number(result.time) * 1000))
    : 0;
  const output = result.output;
  const error = result.error;
  let verdict = 'Accepted';
  if (result.exit_code === 124) verdict = 'Time Limit Exceeded';
  else if (result.exit_code === 137 || result.signal === 9) verdict = 'Resource Limit Exceeded';
  else if (result.status !== 'success' || result.exit_code !== 0 || result.signal)
    verdict = 'Runtime Error';
  // The provider truncates output at 999 characters. Never accept a possibly truncated result.
  else if (output.length >= 999) verdict = 'Output Limit Exceeded';
  return { verdict, output, error, runtime };
}
