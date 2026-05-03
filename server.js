require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const logger = require('./config/logger');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const agentsRoutes = require('./routes/agents');
const contactRoutes = require('./routes/contact');
const advertisingRoutes = require('./routes/advertising');
const analyticsRoutes = require('./routes/analytics');
const savedPropertiesRoutes = require('./routes/saved-properties');
const adminRoutes = require('./routes/admin');
const whatsappRoutes = require('./routes/whatsapp');
const mortgageRoutes = require('./routes/mortgage');
const aiRoutes = require('./routes/ai');
const aiCoreRoutes = require('./routes/ai-core');
const adminAiAgentsRoutes = require('./routes/admin-agents');
const propertySeekerRoutes = require('./routes/property-seeker');
const studentRoutes = require('./routes/student');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { runMigrations } = require('./scripts/migrate');
const {
  isProtectedPath,
  roleCanAccessProtectedPath,
  renderProtectedLoginShell,
  sanitizePublicHtml
} = require('./services/publicHtmlSanitizer');

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
      const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(origin || ''));
      const isMakaUgOrigin = /^https?:\/\/([^/]+\.)?makaug\.com$/i.test(String(origin || ''));
      if (!origin || !corsOrigins.length || corsOrigins.includes(origin) || isLocalOrigin || isMakaUgOrigin) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true
  })
);

app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.json({ limit: '15mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path === '/analytics/config',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/advertising', advertisingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/saved-properties', savedPropertiesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/mortgage-rates', mortgageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai-core', aiCoreRoutes);
app.use('/api/admin/ai-agents', adminAiAgentsRoutes);
app.use('/api/property-seeker', propertySeekerRoutes);
app.use('/api/student', studentRoutes);

// Never expose local/private operator tools on public host.
app.use('/private-local', (_req, res) => {
  return res.status(404).send('Not found');
});

app.get('/config.js', (_req, res) => {
  const publicConfig = {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    apiBase: process.env.PUBLIC_API_BASE || '',
    adsenseClient: process.env.GOOGLE_ADSENSE_CLIENT || '',
    adsenseSlots: {
      default: process.env.GOOGLE_ADSENSE_SLOT_DEFAULT || ''
    }
  };

  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  return res.send([
    `window.MAKAUG_CONFIG = ${JSON.stringify(publicConfig)};`,
    `window.MAKAUG_GOOGLE_MAPS_API_KEY = ${JSON.stringify(publicConfig.googleMapsApiKey)};`,
    `window.MAKAUG_API_BASE = window.MAKAUG_API_BASE || ${JSON.stringify(publicConfig.apiBase)};`,
    `window.MAKAUG_ADSENSE_CLIENT = window.MAKAUG_ADSENSE_CLIENT || ${JSON.stringify(publicConfig.adsenseClient)};`,
    `window.MAKAUG_ADSENSE_SLOTS = window.MAKAUG_ADSENSE_SLOTS || ${JSON.stringify(publicConfig.adsenseSlots)};`
  ].join('\n'));
});

const staticRoot = __dirname;
const indexPath = path.join(staticRoot, 'index.html');

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      acc[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
      return acc;
    }, {});
}

function authFromCookie(req) {
  const token = parseCookies(req.headers.cookie || '').makaug_auth_token;
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function sendPublicIndex(req, res, next) {
  if (req.path.startsWith('/api/')) return next();
  if (isProtectedPath(req.path)) {
    const auth = authFromCookie(req);
    res.set('X-Robots-Tag', 'noindex, noarchive');
    res.set('X-MakaUg-Protected-Route', '1');
    if (!auth) {
      return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || req.path)}`);
    }
    if (!roleCanAccessProtectedPath(auth, req.path)) {
      return res.status(403).send(renderProtectedLoginShell('/login?access=denied', {
        title: 'Access denied',
        message: 'This MakaUg area belongs to a different account type. Sign in with the right account to continue.'
      }));
    }
    try {
      const html = fs.readFileSync(indexPath, 'utf8');
      res.type('html');
      res.set('Cache-Control', 'no-store');
      return res.send(html);
    } catch (error) {
      return next(error);
    }
  }
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    res.type('html');
    res.set('Cache-Control', 'no-store');
    res.set('X-MakaUg-Public-Sanitized', '1');
    return res.send(sanitizePublicHtml(html, { pathname: req.path }));
  } catch (error) {
    return next(error);
  }
}

function shouldServeIndex(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (req.path.startsWith('/api/') || req.path === '/config.js' || req.path.startsWith('/private-local')) return false;
  if (req.path === '/' || req.path === '/index.html') return true;
  return !path.extname(req.path);
}

app.use((req, res, next) => {
  if (!shouldServeIndex(req)) return next();
  return sendPublicIndex(req, res, next);
});

app.use(express.static(staticRoot, {
  index: false,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.(html?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return sendPublicIndex(req, res, next);
});

app.use(notFound);
app.use(errorHandler);

const port = parseInt(process.env.PORT || '8080', 10);

async function start() {
  if (process.env.DATABASE_URL && process.env.RUN_MIGRATIONS_ON_START !== 'false') {
    await runMigrations();
  } else if (!process.env.DATABASE_URL) {
    logger.warn('Skipping startup migrations because DATABASE_URL is not set');
  }

  app.listen(port, () => {
    logger.info(`MakaUg backend running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  logger.error('Startup failed', error);
  process.exit(1);
});
