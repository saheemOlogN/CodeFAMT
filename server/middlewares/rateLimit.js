import { redis } from '../config/redis.js';
import { digest } from '../services/sessionService.js';
export function rateLimit(prefix, limit, seconds, identity = (req) => req.ip) {
  return async (req, res, next) => {
    const key = `limit:${prefix}:${digest(String(identity(req)))}`;
    const count = await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
      1,
      key,
      seconds,
    );
    if (count > limit)
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    next();
  };
}
