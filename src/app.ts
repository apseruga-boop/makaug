import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env';
import healthRoutes from './routes/healthRoutes';
import whatsappRoutes from './routes/whatsappRoutes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: env.rateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      }
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/api', healthRoutes);
  app.use('/api/whatsapp', whatsappRoutes);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  return app;
}
