const mongoose = require('mongoose');
const redisConfig = require('../config/redis');
const { randomUUID } = require('node:crypto');
const key = () => `${process.env.REDIS_PREFIX || 'codefamt'}:workers:heartbeat`;

async function readiness(requireWorker = true) {
    if (mongoose.connection.readyState !== 1) return false;
    let timer;
    try {
        return await Promise.race([
            (async () => {
                const redis = redisConfig.getRedis();
                if (await redis.ping() !== 'PONG') return false;
                return !requireWorker || Number(await redis.zcount(key(), Date.now() - 45000, '+inf')) > 0;
            })(),
            new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); }),
        ]);
    } catch { return false; }
    finally { clearTimeout(timer); }
}

async function startHeartbeat(worker) {
    const id = randomUUID();
    let pending = false;
    let stopped = false;
    async function beat() {
        if (pending || stopped) return;
        pending = true;
        try {
            if (!worker.isRunning() || !await readiness(false) || stopped) return;
            const redis = redisConfig.getRedis();
            await redis.zadd(key(), Date.now(), id);
            await redis.zremrangebyscore(key(), '-inf', Date.now() - 45000);
            await redis.expire(key(), 60);
        } catch { console.error('Worker heartbeat unavailable'); }
        finally { pending = false; }
    }
    await beat();
    const timer = setInterval(beat, 10000);
    timer.unref();
    return async () => { stopped = true; clearInterval(timer); await redisConfig.getRedis().zrem(key(), id).catch(() => {}); };
}
module.exports = { readiness, startHeartbeat };
