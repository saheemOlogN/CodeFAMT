import { Queue } from 'bullmq';
import { queueConnection } from '../config/redis.js';
export let judgeQueue;
export async function startQueue() {
  judgeQueue = new Queue('judge', {
    connection: queueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
    },
  });
  // OnlineCompiler allows four synchronous requests across all workers.
  await judgeQueue.setGlobalConcurrency(4);
}
export async function enqueue(submission) {
  await judgeQueue.add(
    'evaluate',
    { submissionId: String(submission._id) },
    { jobId: String(submission._id) },
  );
}
