function validateEnvironment(env = process.env) {
    if (env.NODE_ENV !== 'production') return;
    const required = ['MONGODB_URI', 'REDIS_URL', 'JWT_SECRET', 'OTP_SECRET', 'ONLINECOMPILER_API_KEY', 'CLIENT_ORIGIN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    for (const key of required) if (!env[key]?.trim()) throw new Error(`Missing required setting: ${key}`);
    for (const key of ['JWT_SECRET', 'OTP_SECRET']) if (env[key].length < 32) throw new Error(`${key} must contain at least 32 characters`);
    const origin = new URL(env.CLIENT_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.CLIENT_ORIGIN) throw new Error('CLIENT_ORIGIN must be an HTTPS origin without a trailing slash');
    for (const key of ['PORT', 'SMTP_PORT', 'WORKER_HEALTH_PORT']) {
        if (env[key] !== undefined && (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 65535)) throw new Error(`${key} must be a valid port`);
    }
    if (env.TRUST_PROXY && !/^\d+$/.test(env.TRUST_PROXY)) throw new Error('TRUST_PROXY must be an explicit proxy hop count');
}
module.exports = { validateEnvironment };
