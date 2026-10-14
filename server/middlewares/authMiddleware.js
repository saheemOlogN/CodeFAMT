import { config } from '../config/env.js';
import { redis } from '../config/redis.js';
import { User } from '../models/User.js';
import { digest } from '../services/sessionService.js';
export async function loadUser(req, res, next) {
  const token = req.cookies.session;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const id = await redis.get(`session:${digest(token)}`);
    if (id) req.user = await User.findById(id);
  }
  next();
}
export function authenticated(req, res, next) {
  if (!req.user)
    return res.status(401).json({ error: 'Sign in with your college email to continue.' });
  next();
}
export function admin(req, res, next) {
  if (!req.user || !config.admins.includes(req.user.email))
    return res.status(403).json({ error: 'Admin access required.' });
  next();
}
