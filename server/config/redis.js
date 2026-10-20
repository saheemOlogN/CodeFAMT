const Redis = require("ioredis");

let client;

function createRedisConnection(options = {}) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
    const connection = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 10000,
        retryStrategy: attempt => Math.min(attempt * 500, 5000),
        ...options,
    });
    connection.on("error", () => {});
    return connection;
}

function getRedis() {
    if (!client) client = createRedisConnection();
    return client;
}

async function closeRedis() {
    if (client) {
        client.disconnect();
        client = null;
    }
}

module.exports = { createRedisConnection, getRedis, closeRedis };
