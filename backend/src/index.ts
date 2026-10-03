import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth';
import teamRoutes from './routes/teams';
import workItemRoutes from './routes/workItems';
import notificationRoutes from './routes/notifications';
import searchRoutes from './routes/search';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security & utility middleware ────────────────────────────────────────────

app.use(helmet());

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(compression());

// ─── Rate limiting ────────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(limiter);

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/work-items', workItemRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use(
  (
    err: Error & { status?: number; details?: unknown },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[global error handler]', err);
    const status = err.status ?? 500;
    const response: Record<string, unknown> = { error: err.message || 'Internal server error' };
    if (err.details) {
      response.details = err.details;
    }
    res.status(status).json(response);
  }
);

// ─── Start server (skip when imported by tests) ───────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Newtonite backend running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
  });
}

export default app;
