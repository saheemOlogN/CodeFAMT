const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const redis = require('../config/redis');
const { readiness } = require('../utils/health');
const { validateEnvironment } = require('../config/environment');

const valid = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://example/db', REDIS_URL: 'redis://example',
    CLIENT_ORIGIN: 'https://codefamt.example.com', JWT_SECRET: 'j'.repeat(32), OTP_SECRET: 'o'.repeat(32),
    ONLINECOMPILER_API_KEY: 'test', SMTP_HOST: 'mail.example.com', SMTP_PORT: '587', SMTP_USER: 'test', SMTP_PASS: 'test', SMTP_FROM: 'test@example.com', PORT: '6767', TRUST_PROXY: '1' };

test('production fails early for missing secrets, bad origins and invalid ports', () => {
    assert.doesNotThrow(() => validateEnvironment(valid));
    for (const change of [{ JWT_SECRET: '' }, { OTP_SECRET: 'short' }, { CLIENT_ORIGIN: 'http://example.com' },
        { CLIENT_ORIGIN: 'https://example.com/' }, { SMTP_PORT: '0' }, { PORT: 'NaN' }, { TRUST_PROXY: 'true' }]) {
        assert.throws(() => validateEnvironment({ ...valid, ...change }));
    }
});

test('API readiness requires the database, Redis and a recent worker heartbeat', async t => {
    const previous = mongoose.connection.readyState;
    t.after(() => { mongoose.connection.readyState = previous; });
    mongoose.connection.readyState = 0;
    assert.equal(await readiness(), false);
    mongoose.connection.readyState = 1;
    let workers = 0;
    t.mock.method(redis, 'getRedis', () => ({ ping: async () => 'PONG', zcount: async (key, since) => {
        assert.ok(key.endsWith(':workers:heartbeat'));
        assert.ok(Date.now() - since >= 45000);
        return workers;
    } }));
    assert.equal(await readiness(), false);
    workers = 1;
    assert.equal(await readiness(), true);
    assert.equal(await readiness(false), true);
    t.mock.method(redis, 'getRedis', () => ({ ping: async () => { throw new Error('Offline'); } }));
    assert.equal(await readiness(), false);
});
