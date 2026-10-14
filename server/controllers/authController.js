import crypto from 'node:crypto';
import { z } from 'zod';
import { redis } from '../config/redis.js';
import { User } from '../models/User.js';
import { emailSchema } from '../validators/index.js';
import { digest, cookieOptions, publicUser } from '../services/sessionService.js';
import { sendOtpEmail } from '../services/emailService.js';

export async function getSession(req, res) {
  return res.json({ user: req.user ? publicUser(req.user) : null });
}

export async function requestOtp(req, res) {
  const { email } = z.object({ email: emailSchema }).parse(req.body);
  const key = digest(email);
  if (!(await redis.set(`otp-cooldown:${key}`, '1', 'EX', 60, 'NX')))
    return res.status(429).json({ error: 'Wait 60 seconds before requesting another code.' });
  const code = crypto.randomInt(100000, 1000000).toString();
  await redis
    .multi()
    .hset(`otp:${key}`, { code: digest(`${email}:${code}`), attempts: '0' })
    .expire(`otp:${key}`, 600)
    .exec();
  try {
    await sendOtpEmail(email, code);
  } catch {
    await redis.del(`otp:${key}`, `otp-cooldown:${key}`);
    return res.status(503).json({ error: 'Email could not be sent. Please try again later.' });
  }
  res.json({ message: 'Code sent. Check your college inbox.', expiresIn: 600 });
}

export async function verifyOtp(req, res) {
  const { email, code } = z
    .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
    .parse(req.body);
  const valid = await redis.eval(
    `
    if redis.call('EXISTS',KEYS[1])==0 then return 0 end
    local attempts=redis.call('HINCRBY',KEYS[1],'attempts',1)
    if attempts>5 then redis.call('DEL',KEYS[1]); return 0 end
    if redis.call('HGET',KEYS[1],'code')==ARGV[1] then redis.call('DEL',KEYS[1]); return 1 end
    if attempts==5 then redis.call('DEL',KEYS[1]) end
    return 0`,
    1,
    `otp:${digest(email)}`,
    digest(`${email}:${code}`),
  );
  if (!valid)
    return res
      .status(400)
      .json({ error: 'Invalid or expired code. Request a new code if needed.' });
  const user = await User.findOneAndUpdate(
    { email },
    { $setOnInsert: { name: email.split('@')[0] } },
    { upsert: true, new: true },
  );
  if (req.cookies.session) await redis.del(`session:${digest(req.cookies.session)}`);
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(`session:${digest(token)}`, String(user._id), 'EX', 7 * 86400);
  res.cookie('session', token, cookieOptions()).json({ user: publicUser(user) });
}

export async function logout(req, res) {
  if (req.cookies.session) await redis.del(`session:${digest(req.cookies.session)}`);
  res.clearCookie('session', cookieOptions()).json({ ok: true });
}
