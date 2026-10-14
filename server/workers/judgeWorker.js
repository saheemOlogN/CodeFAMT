import { Worker } from 'bullmq';
import { connectDatabase } from '../config/database.js';
import { redis, queueConnection, connectRedis } from '../config/redis.js';
import { enqueue, judgeQueue, startQueue } from '../services/queueService.js';
import { Submission, Problem } from '../models/index.js';
import { normalizeOutput } from '../utils/contest.js';
import { execute } from '../services/compilerService.js';
import mongoose from 'mongoose';

await connectDatabase();
await connectRedis();
await startQueue();
if (!process.env.COMPILER_API_KEY)
  throw new Error('COMPILER_API_KEY is required to start the judge worker.');
const worker = new Worker(
  'judge',
  async (job) => {
    const submission = await Submission.findById(job.data.submissionId).select('+source +stdin');
    if (!submission || !['Queued', 'Judging'].includes(submission.status)) return;
    await Submission.updateOne({ _id: submission._id }, { status: 'Judging' });
    const problem = await Problem.findById(submission.problem).select('+testCases').lean();
    if (!problem) throw new Error('Problem missing during judging.');
    const cases = submission.kind === 'run' ? [{ input: submission.stdin }] : problem.testCases;
    if (!cases.length) throw new Error('No test cases configured.');
    let verdict = 'Accepted',
      passed = 0,
      runtime = 0,
      output = '',
      error = '';
    for (const test of cases) {
      const result = await execute({
        source: submission.source,
        language: submission.language,
        input: test.input,
      });
      runtime = Math.max(runtime, result.runtime || 0);
      if (submission.kind === 'run') {
        output = result.output || '';
        error = result.error || '';
      }
      if (result.verdict !== 'Accepted') {
        verdict = result.verdict;
        break;
      }
      if (
        submission.kind === 'submit' &&
        normalizeOutput(result.output) !== normalizeOutput(test.output)
      ) {
        verdict = 'Wrong Answer';
        break;
      }
      passed++;
    }
    // Never persist hidden-test stdout/stderr in student-visible result fields.
    await Submission.updateOne(
      { _id: submission._id },
      {
        status: submission.kind === 'run' && verdict === 'Accepted' ? 'Executed' : verdict,
        passed,
        total: cases.length,
        runtime,
        output,
        error,
      },
    );
  },
  {
    connection: queueConnection(true),
    concurrency: Math.max(1, Number(process.env.JUDGE_CONCURRENCY || 2)),
  },
);
worker.on('error', (error) => console.error('Worker:', error.message));
worker.on('failed', (job, error) => {
  console.error('Judge failed:', error.message);
  if (job && job.attemptsMade >= (job.opts.attempts || 1))
    Submission.updateOne(
      { _id: job.data.submissionId, status: { $in: ['Queued', 'Judging'] } },
      { status: 'System Error', error: 'Judging service unavailable. Please resubmit later.' },
    ).catch(console.error);
});
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    const pending = await Submission.find({
      status: { $in: ['Queued', 'Judging'] },
      updatedAt: { $lt: new Date(Date.now() - 30000) },
    })
      .select('_id')
      .limit(100);
    for (const submission of pending) await enqueue(submission);
  } catch (error) {
    console.error('Outbox:', error.message);
  } finally {
    sweeping = false;
  }
}
const timer = setInterval(sweep, 15000);
console.log('CodeFAMT judge worker is ready.');
async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await judgeQueue.close();
  await redis.quit();
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
