import 'dotenv/config';

export const config = {
  production: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 4000),
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
  mongo: process.env.MONGODB_URI,
  redis: process.env.REDIS_URL,
  secret: process.env.AUTH_SECRET,
  compilerUrl: (process.env.COMPILER_API_URL || 'https://api.onlinecompiler.io').replace(/\/$/, ''),
  compilerKey: process.env.COMPILER_API_KEY,
  admins: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
};

export function requireConfig() {
  for (const key of ['MONGODB_URI', 'REDIS_URL', 'AUTH_SECRET']) {
    if (!process.env[key])
      throw new Error(`Missing ${key}. Copy .env.example to .env and configure services.`);
  }
  if (config.secret.length < 32)
    throw new Error('AUTH_SECRET must contain at least 32 characters.');
}
