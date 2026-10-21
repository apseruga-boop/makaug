'use strict';

// One structured line for a catch-all 404. Query strings are dropped and
// emails, phone numbers and tokens left in the path are masked. IPs, cookies
// and bodies are never read. A scanner flood keeps at most NOT_FOUND_LOG_LIMIT
// lines per minute; the rest are counted and reported once when the window ends.

const logger = require('../config/logger');

const NOT_FOUND_LOG_LIMIT = 30;
const NOT_FOUND_LOG_WINDOW_MS = 60 * 1000;
const USER_AGENT_LOG_MAX = 200;
const PATH_LOG_MAX = 500;
const REFERER_LOG_MAX = 300;

const BOT_USER_AGENT = /bot|crawl|spider|slurp|curl\/|wget\/|python-requests|go-http-client|headless|scrapy|semrush|ahrefs|petalbot|bytespider|gptbot|claudebot|facebookexternalhit|whatsapp\/|telegrambot|slackbot|discordbot|embedly|linkedinbot|twitterbot|applebot|yandex|baiduspider|duckduckbot|lighthouse|pagespeed|uptimerobot|nikto|sqlmap|nmap|masscan|zgrab|censys|shodan|scanner/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function stripControls(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function maskSensitivePath(value) {
  return String(value || '')
    .replace(EMAIL, '[email]')
    .replace(JWT, '[token]')
    .replace(/(^|\/)(?:sk|pk|rk|tok|key|secret|token)[_-][A-Za-z0-9_-]{8,}(?=\/|$)/gi, '$1[token]')
    .replace(/(^|\/)\+?\d{10,15}(?=\/|$)/g, '$1[phone]')
    .replace(/(^|\/)[0-9a-f]{32,}(?=\/|$)/gi, '$1[token]')
    .replace(/(^|\/)[A-Za-z0-9_-]{40,}(?=\/|$)/g, '$1[token]');
}

function sanitizeNotFoundPath(input) {
  let value = stripControls(input).trim();
  if (!value) return '/';
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname || '/';
    } catch {
      // Keep the raw string and strip the query below.
    }
  }
  const cutQuery = (text) => {
    const query = text.indexOf('?');
    const hash = text.indexOf('#');
    const end = [query, hash].filter((index) => index >= 0).sort((a, b) => a - b)[0];
    return end === undefined ? text : text.slice(0, end);
  };
  value = maskSensitivePath(cutQuery(safeDecode(cutQuery(value))));
  if (!value.startsWith('/')) value = `/${value}`;
  if (value.length > PATH_LOG_MAX) value = `${value.slice(0, PATH_LOG_MAX)}…`;
  return value || '/';
}

function sanitizeReferer(input) {
  const raw = stripControls(input).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const path = sanitizeNotFoundPath(url.pathname || '/');
    const referer = `${url.origin}${path}`;
    return referer.length > REFERER_LOG_MAX ? `${referer.slice(0, REFERER_LOG_MAX)}…` : referer;
  } catch {
    return '';
  }
}

function header(req, name) {
  if (req && typeof req.get === 'function') {
    const value = req.get(name);
    if (value) return String(value);
  }
  const headers = req && req.headers ? req.headers : {};
  const found = headers[name] || headers[String(name || '').toLowerCase()] || '';
  return String(found || '');
}

function cleanMethod(method) {
  return String(method || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10);
}

function truncateText(value, max) {
  const text = stripControls(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function isBotUserAgent(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return false;
  return BOT_USER_AGENT.test(ua);
}

function buildNotFoundLogEntry(req = {}) {
  const userAgent = header(req, 'user-agent');
  return {
    event: 'http_404',
    method: cleanMethod(req.method),
    path: sanitizeNotFoundPath(req.path || req.originalUrl || req.url || '/'),
    user_agent: truncateText(userAgent, USER_AGENT_LOG_MAX),
    referer: sanitizeReferer(header(req, 'referer')),
    is_bot: isBotUserAgent(userAgent)
  };
}

function createNotFoundAccessLogger({
  limit = NOT_FOUND_LOG_LIMIT,
  windowMs = NOT_FOUND_LOG_WINDOW_MS,
  now = () => Date.now(),
  write = (line) => logger.info(line)
} = {}) {
  let windowStart = 0;
  let logged = 0;
  let suppressed = 0;
  let summaryTimer = null;

  function clearSummaryTimer() {
    if (!summaryTimer) return;
    clearTimeout(summaryTimer);
    summaryTimer = null;
  }

  function emitSuppressed() {
    if (suppressed <= 0) return;
    const count = suppressed;
    suppressed = 0;
    write(JSON.stringify({
      event: 'http_404_suppressed',
      suppressed: count,
      window_seconds: Math.round(windowMs / 1000)
    }));
  }

  // The summary still goes out if the flood stops before the next 404.
  function armSummaryTimer() {
    if (summaryTimer) return;
    const delay = Math.max(0, windowStart + windowMs - now());
    summaryTimer = setTimeout(() => {
      summaryTimer = null;
      if (!windowStart || now() - windowStart < windowMs) return;
      emitSuppressed();
      windowStart = 0;
      logged = 0;
    }, delay);
    if (typeof summaryTimer.unref === 'function') summaryTimer.unref();
  }

  function logNotFound(req) {
    try {
      const at = now();
      if (!windowStart || at - windowStart >= windowMs) {
        clearSummaryTimer();
        emitSuppressed();
        windowStart = at;
        logged = 0;
        suppressed = 0;
      }
      if (logged < limit) {
        logged += 1;
        write(JSON.stringify(buildNotFoundLogEntry(req)));
        return true;
      }
      suppressed += 1;
      armSummaryTimer();
      return false;
    } catch {
      return false;
    }
  }

  return { logNotFound };
}

const defaultLogger = createNotFoundAccessLogger();

module.exports = {
  NOT_FOUND_LOG_LIMIT,
  NOT_FOUND_LOG_WINDOW_MS,
  USER_AGENT_LOG_MAX,
  sanitizeNotFoundPath,
  sanitizeReferer,
  isBotUserAgent,
  buildNotFoundLogEntry,
  createNotFoundAccessLogger,
  logNotFound: (req) => defaultLogger.logNotFound(req)
};
