require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const logger = require('./config/logger');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const agentsRoutes = require('./routes/agents');
const contactRoutes = require('./routes/contact');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const whatsappRoutes = require('./routes/whatsapp');
const mortgageRoutes = require('./routes/mortgage');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
// Required on Render so rate limiting uses the forwarded client IP correctly.
app.set('trust proxy', 1);

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !corsOrigins.length || corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/mortgage-rates', mortgageRoutes);

const staticRoot = __dirname;
app.use(express.static(staticRoot, { extensions: ['html'] }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(staticRoot, 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

const port = parseInt(process.env.PORT || '8080', 10);

app.listen(port, () => {
  logger.info(`MakaUg backend running on http://localhost:${port}`);
});
