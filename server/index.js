import { app } from './app.js';
import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { connectRedis } from './config/redis.js';
import { startQueue } from './services/queueService.js';

try {
  await connectDatabase();
  await connectRedis();
  await startQueue();
  app.listen(config.port, '127.0.0.1', () =>
    console.log('CodeFAMT API: http://127.0.0.1:' + config.port),
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
