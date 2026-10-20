const { getRedis } = require("../config/redis");

async function reserveProviderRun() {
    const limit = Number(process.env.COMPILER_RUNS_PER_MINUTE || 30);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid compiler request limit");
    const key = `${process.env.REDIS_PREFIX || "codefamt"}:compiler:rate`;
    const wait = Number(await getRedis().eval(
        "local n = tonumber(redis.call('GET', KEYS[1]) or '0'); " +
        "if n >= tonumber(ARGV[1]) then return math.max(redis.call('PTTL', KEYS[1]), 1) end; " +
        "n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end; return 0",
        1, key, limit
    ));
    if (wait > 0) {
        const error = new Error("Waiting for compiler capacity");
        error.delayMs = wait + 100;
        throw error;
    }
}

module.exports = { reserveProviderRun };
