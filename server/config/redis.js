import Redis from 'ioredis';
import { config } from './env.js';
export let redis;
export function queueConnection(worker = false) {
  const connection = new Redis(config.redis, { maxRetriesPerRequest: worker ? null : 2 });
  connection.on('error', (error) => console.error('Queue Redis:', error.message));
  return connection;
}
export async function connectRedis() {
  redis = new Redis(config.redis, { maxRetriesPerRequest: 2, lazyConnect: true });
  redis.on('error', (error) => console.error('Redis:', error.message));
  await redis.connect();
}
