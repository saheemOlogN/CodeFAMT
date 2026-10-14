import { config } from '../config/env.js';
export function checkOrigin(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.origin)
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
}
