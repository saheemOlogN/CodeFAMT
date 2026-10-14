import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadUser } from './middlewares/authMiddleware.js';
import { checkOrigin } from './middlewares/originMiddleware.js';
import { errorHandler } from './middlewares/errorHandler.js';
import api from './routes/index.js';

export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  req.receivedAt = new Date();
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      },
    },
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', checkOrigin);
app.use('/api', loadUser);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
const dist = path.resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);
