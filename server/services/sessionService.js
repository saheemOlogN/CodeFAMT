import crypto from 'node:crypto';
import { config } from '../config/env.js';
export const digest = (value) =>
  crypto.createHmac('sha256', config.secret).update(value).digest('hex');
export const cookieOptions = () => ({
  httpOnly: true,
  secure: config.production,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 86400000,
});
export const publicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  admin: config.admins.includes(user.email),
});
