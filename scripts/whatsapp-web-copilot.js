#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dns = require('dns');

const PROJECT_ROOT = path.resolve(__dirname, '..');

try {
  process.chdir(PROJECT_ROOT);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(new Date().toISOString(), '[whatsapp-web-copilot]', `failed to enter project root: ${error.message}`);
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function readTextFileWithRetry(filePath, label, attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      const message = String(error?.message || error || '');
      const retryable = error?.code === 'EAGAIN'
        || error?.errno === -11
        || message.includes('Unknown system error -11');
      if (!retryable || attempt >= attempts) {
        console.error(new Date().toISOString(), '[whatsapp-web-copilot]', `failed to read ${label}: ${message}`);
        return null;
      }
      sleepSync(Math.min(2000, 250 * attempt));
    }
  }
  return null;
}

function loadProjectEnv() {
  const candidates = [
    String(process.env.MAKAUG_WHATSAPP_ENV_FILE || '').trim(),
    '/private/tmp/makaug-whatsapp.env',
    path.join(PROJECT_ROOT, '.env')
  ].filter(Boolean);
  let source = '';
  for (const envPath of candidates) {
    source = readTextFileWithRetry(envPath, envPath);
    if (source) break;
  }
  if (!source) return;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadProjectEnv();

function requireWithReadRetry(moduleName, attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return require(moduleName);
    } catch (error) {
      const message = String(error?.message || error || '');
      const retryable = error?.code === 'EAGAIN'
        || error?.errno === -11
        || message.includes('Unknown system error -11');
      if (!retryable || attempt >= attempts) throw error;
      // macOS can occasionally return -11 while launchd starts the bridge and
      // Node reads large dependency files. A short sync retry prevents a crash loop.
      console.error(new Date().toISOString(), '[whatsapp-web-copilot]', `dependency read retry ${attempt}/${attempts} for ${moduleName}: ${message}`);
      sleepSync(Math.min(3000, 500 * attempt));
    }
  }
  return require(moduleName);
}

function resolvePlaywrightCoreModule() {
  const candidates = [
    String(process.env.WHATSAPP_WEB_COPILOT_PLAYWRIGHT_CORE_PATH || '').trim(),
    '/private/tmp/makaug-playwright-runtime/node_modules/playwright-core'
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return 'playwright-core';
}

const { chromium } = requireWithReadRetry(resolvePlaywrightCoreModule());
const { isIgnoredWhatsappSystemChat } = requireWithReadRetry('../services/whatsappWebChatFilter');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const BASE_URL = String(
  process.env.WHATSAPP_WEB_COPILOT_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.APP_BASE_URL
    || 'http://localhost:8080'
).replace(/\/+$/, '');
const BRIDGE_TOKEN = String(process.env.WHATSAPP_WEB_BRIDGE_TOKEN || '').trim();
const CLIENT_ID = String(process.env.WHATSAPP_WEB_COPILOT_CLIENT_ID || `${os.hostname()}-whatsapp-web`).trim();
const OPERATOR_NAME = String(process.env.WHATSAPP_WEB_COPILOT_OPERATOR_NAME || os.userInfo().username || '').trim();
const CHROME_PATH = String(
  process.env.WHATSAPP_WEB_COPILOT_CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
).trim();
const CDP_URL = String(process.env.WHATSAPP_WEB_COPILOT_CDP_URL || '').trim();
const PROFILE_DIR = path.resolve(
  process.cwd(),
  String(process.env.WHATSAPP_WEB_COPILOT_PROFILE_DIR || '.whatsapp-web-copilot-profile')
);
const configuredPollMs = Number(process.env.WHATSAPP_WEB_COPILOT_POLL_MS || 50);
const POLL_MS = Math.min(150, Math.max(40, Number.isFinite(configuredPollMs) ? configuredPollMs : 75));
const configuredLoginPollMs = Number(process.env.WHATSAPP_WEB_COPILOT_LOGIN_POLL_MS || 2500);
const LOGIN_POLL_MS = Math.min(
  10000,
  Math.max(1000, Number.isFinite(configuredLoginPollMs) ? configuredLoginPollMs : 2500)
);
const HEARTBEAT_MS = Math.max(10000, Number(process.env.WHATSAPP_WEB_COPILOT_HEARTBEAT_MS || 30000));
const HEADLESS_BROWSER = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.WHATSAPP_WEB_COPILOT_HEADLESS || '').trim().toLowerCase()
);
const LOGIN_SCREENSHOT_ENABLED = !['0', 'false', 'no', 'off'].includes(
  String(process.env.WHATSAPP_WEB_COPILOT_LOGIN_SCREENSHOT || 'true').trim().toLowerCase()
);
const LOGIN_METHOD = String(process.env.WHATSAPP_WEB_COPILOT_LOGIN_METHOD || 'auto').trim().toLowerCase();
const PAIRING_PHONE_NUMBER = String(
  process.env.WHATSAPP_WEB_COPILOT_PAIRING_PHONE
    || process.env.WHATSAPP_WEB_COPILOT_PHONE_NUMBER
    || ''
).replace(/[^\d+]/g, '').trim();
const BROWSER_USER_AGENT = String(
  process.env.WHATSAPP_WEB_COPILOT_USER_AGENT
    || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
).trim();
const MAX_CONSECUTIVE_LOOP_ERRORS = Math.max(2, Number(process.env.WHATSAPP_WEB_COPILOT_MAX_LOOP_ERRORS || 5));
const configuredRecentSweepMs = Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_MS || 60);
const RECENT_CHAT_SWEEP_MS = Math.min(300, Math.max(60, Number.isFinite(configuredRecentSweepMs) ? configuredRecentSweepMs : 120));
const RECENT_CHAT_SWEEP_LIMIT = Math.min(12, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_LIMIT || 8)));
const RECENT_CHAT_SWEEP_OPEN_LIMIT = Math.min(5, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_OPEN_LIMIT || 5)));
const RECENT_CHAT_FAST_LANE_LIMIT = Math.min(3, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_FAST_LANE_LIMIT || 3)));
const configuredRecentRowCacheMs = Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_ROW_CACHE_MS || 1200);
const RECENT_CHAT_ROW_CACHE_MS = Math.min(
  15000,
  Math.max(1000, Number.isFinite(configuredRecentRowCacheMs) ? configuredRecentRowCacheMs : 4000)
);
const OUTBOX_CLAIM_LIMIT = Math.min(25, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_CLAIM_LIMIT || 25)));
const OUTBOX_SENDS_PER_LOOP = Math.min(8, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_SENDS_PER_LOOP || 5)));
const API_RETRY_ATTEMPTS = Math.min(8, Math.max(3, Number(process.env.WHATSAPP_WEB_COPILOT_API_RETRY_ATTEMPTS || 5)));
const configuredSendConfirmMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_CONFIRM_MS || 300);
const SEND_CONFIRM_MS = Math.min(2000, Math.max(250, Number.isFinite(configuredSendConfirmMs) ? configuredSendConfirmMs : 550));
const configuredComposerClearMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_COMPOSER_CLEAR_MS || 80);
const SEND_COMPOSER_CLEAR_MS = Math.min(1200, Math.max(80, Number.isFinite(configuredComposerClearMs) ? configuredComposerClearMs : 220));
const configuredSendConfirmAfterClearMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_CONFIRM_AFTER_CLEAR_MS || 700);
const SEND_CONFIRM_AFTER_CLEAR_MS = Math.min(
  1200,
  Math.max(50, Number.isFinite(configuredSendConfirmAfterClearMs) ? configuredSendConfirmAfterClearMs : 125)
);
const configuredSendRetryConfirmMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_RETRY_CONFIRM_MS || 350);
const SEND_RETRY_CONFIRM_MS = Math.min(
  2000,
  Math.max(300, Number.isFinite(configuredSendRetryConfirmMs) ? configuredSendRetryConfirmMs : 750)
);
const TRUST_SEND_ON_COMPOSER_CLEAR = !['0', 'false', 'no', 'off'].includes(
  HEADLESS_BROWSER
    ? String(process.env.WHATSAPP_WEB_COPILOT_TRUST_SEND_ON_COMPOSER_CLEAR || 'true').trim().toLowerCase()
    : String(process.env.WHATSAPP_WEB_COPILOT_TRUST_SEND_ON_COMPOSER_CLEAR || 'false').trim().toLowerCase()
);
const configuredRecentlySentReplyTtlMs = Number(process.env.WHATSAPP_WEB_COPILOT_RECENTLY_SENT_REPLY_TTL_MS || 15000);
const RECENTLY_SENT_REPLY_TTL_MS = Math.min(
  30000,
  Math.max(5000, Number.isFinite(configuredRecentlySentReplyTtlMs) ? configuredRecentlySentReplyTtlMs : 15000)
);
const configuredProfileLockRetryMs = Number(process.env.WHATSAPP_WEB_COPILOT_PROFILE_LOCK_RETRY_MS || 10000);
const PROFILE_LOCK_RETRY_MS = Math.min(
  60000,
  Math.max(1000, Number.isFinite(configuredProfileLockRetryMs) ? configuredProfileLockRetryMs : 10000)
);
const configuredProfileLockMaxWaitMs = Number(process.env.WHATSAPP_WEB_COPILOT_PROFILE_LOCK_MAX_WAIT_MS || 900000);
const PROFILE_LOCK_MAX_WAIT_MS = Math.min(
  1800000,
  Math.max(30000, Number.isFinite(configuredProfileLockMaxWaitMs) ? configuredProfileLockMaxWaitMs : 900000)
);
const CLEAR_STALE_PROFILE_LOCKS = !['0', 'false', 'no', 'off'].includes(
  String(process.env.WHATSAPP_WEB_COPILOT_CLEAR_STALE_PROFILE_LOCKS || 'true').trim().toLowerCase()
);
const configuredProfileLockStaleClearMs = Number(process.env.WHATSAPP_WEB_COPILOT_PROFILE_LOCK_STALE_CLEAR_MS || 120000);
const PROFILE_LOCK_STALE_CLEAR_MS = Math.min(
  900000,
  Math.max(60000, Number.isFinite(configuredProfileLockStaleClearMs) ? configuredProfileLockStaleClearMs : 120000)
);

function chromiumProfileLockFiles() {
  return [
    'SingletonLock',
    'SingletonSocket',
    'SingletonCookie'
  ].map((fileName) => path.join(PROFILE_DIR, fileName));
}

function resolveChromeExecutablePath() {
  const candidates = [
    CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_error) {
      // Try the next candidate.
    }
  }

  try {
    const playwrightPath = chromium.executablePath();
    if (playwrightPath && fs.existsSync(playwrightPath)) return playwrightPath;
  } catch (_error) {
    // Fall through to the configured path so the launch error remains explicit.
  }

  return CHROME_PATH;
}

const VOICE_AUDIO_MAX_BYTES = 8_000_000;
const LISTING_IMAGE_PREVIEW_MAX_DIMENSION = 1280;
const LISTING_IMAGE_PREVIEW_QUALITY = 0.78;
const LISTING_IMAGE_PREVIEW_MAX_BYTES = 1_500_000;
const OUTBOUND_PROPERTY_IMAGE_MAX_BYTES = 15_000_000;
const seenBrowserMessageIds = new Set();
const seenCallEventKeys = new Map();
const recentlySentReplyKeys = new Map();
const recentChatRowKeys = new Map();
let activeInboundRecipientHint = '';
const COMPOSER_SELECTORS = [
  'footer [data-testid="conversation-compose-box-input"][contenteditable="true"]',
  'footer div[role="textbox"][contenteditable="true"]',
  'footer div[aria-label^="Type a message"][contenteditable="true"]',
  'footer div[contenteditable="true"][data-tab]',
  'footer div[contenteditable="true"]'
];
const SEND_BUTTON_SELECTORS = [
  '[data-testid="compose-btn-send"]',
  'footer button[aria-label*="Send"]',
  'footer span[data-icon="send"]',
  'span[data-icon="send"]'
];
const ATTACH_BUTTON_SELECTORS = [
  'footer button[aria-label*="Attach"]',
  'footer button[title*="Attach"]',
  'footer span[data-icon="plus-rounded"]',
  'footer span[data-icon="clip"]',
  'span[data-icon="plus-rounded"]',
  'span[data-icon="clip"]'
];
const OUTBOUND_IMAGE_INPUT_SELECTORS = [
  'input[type="file"][accept*="image"]',
  'input[type="file"][accept*="video"]'
];
const MEDIA_CAPTION_SELECTORS = [
  '[data-testid="media-caption-input-container"] [contenteditable="true"]',
  '[role="dialog"] div[role="textbox"][contenteditable="true"]',
  'div[aria-label*="caption" i][contenteditable="true"]'
];
const MEDIA_SEND_BUTTON_SELECTORS = [
  '[data-testid="media-send"]',
  '[role="dialog"] button[aria-label*="Send"]',
  '[role="dialog"] span[data-icon="send"]',
  'span[data-icon="send"]'
];

if (!BRIDGE_TOKEN) {
  console.error('Missing WHATSAPP_WEB_BRIDGE_TOKEN in environment.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), '[whatsapp-web-copilot]', ...args);
}

function isClosedBrowserError(error) {
  return /target page, context or browser has been closed|browser has been closed|context has been closed|page has been closed|session closed|target closed/i
    .test(String(error?.message || error || ''));
}

function hasChromiumProfileLockFiles() {
  return chromiumProfileLockFiles().some((filePath) => {
    try {
      fs.lstatSync(filePath);
      return true;
    } catch (_error) {
      return false;
    }
  });
}

function isChromiumProfileLockError(error) {
  const message = [
    error?.message,
    error?.stack,
    error?.cause?.message,
    String(error || '')
  ].filter(Boolean).join('\n');
  return /profile appears to be in use|process_singleton|singletonlock|user data directory is already in use|chrome profile is in use|locked the profile/i
    .test(message)
    || (isClosedBrowserError(error) && hasChromiumProfileLockFiles());
}

function clearChromiumProfileLockFiles() {
  let cleared = 0;
  for (const filePath of chromiumProfileLockFiles()) {
    try {
      fs.lstatSync(filePath);
      fs.rmSync(filePath, { force: true, recursive: false });
      cleared += 1;
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      log(`could not clear stale Chrome profile lock ${path.basename(filePath)}: ${error.message || error}`);
    }
  }
  return cleared;
}

async function launchPersistentContextWithProfileRetry(executablePath, options) {
  const startedAt = Date.now();
  let attempt = 0;
  let staleLocksCleared = false;
  while (true) {
    attempt += 1;
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, options);
    } catch (error) {
      if (!isChromiumProfileLockError(error)) throw error;
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= PROFILE_LOCK_MAX_WAIT_MS) {
        throw new Error(`WhatsApp Web profile is still locked after ${Math.round(waitedMs / 1000)}s: ${error.message || error}`);
      }
      if (
        CLEAR_STALE_PROFILE_LOCKS
        && !staleLocksCleared
        && waitedMs >= PROFILE_LOCK_STALE_CLEAR_MS
        && hasChromiumProfileLockFiles()
      ) {
        const cleared = clearChromiumProfileLockFiles();
        staleLocksCleared = true;
        log(`cleared ${cleared} stale Chrome profile lock file${cleared === 1 ? '' : 's'} after waiting ${Math.round(waitedMs / 1000)}s.`);
        await sleep(1000);
        continue;
      }
      log(`WhatsApp Web profile is locked by another Chromium process; waiting ${Math.round(PROFILE_LOCK_RETRY_MS / 1000)}s before launch retry ${attempt + 1}.`);
      await sleep(PROFILE_LOCK_RETRY_MS);
    }
  }
}

function normalizeChatKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 9) return digits;
  return raw.replace(/\s+/g, ' ').slice(0, 160);
}

function createMessageId(chatKey, text, timestampLabel = '', mediaType = 'text', nonce = '') {
  return `webbridge:${crypto.createHash('sha1').update(JSON.stringify({
    chatKey: normalizeChatKey(chatKey),
    text: String(text || '').trim(),
    timestampLabel: String(timestampLabel || '').trim(),
    mediaType: String(mediaType || '').trim().toLowerCase(),
    nonce: String(nonce || '').trim()
  })).digest('hex')}`;
}

function browserMessageKeyFor(snapshot = {}, row = {}) {
  const chatKey = normalizeChatKey(snapshot.chatKey || row.title);
  const mediaType = snapshot.mediaType || 'text';
  const text = isTimestampOnly(snapshot.text) && String(mediaType).includes('location')
    ? '[shared location]'
    : String(snapshot.text || row.preview || '').trim();
  const stableTextKey = mediaType === 'text'
    ? text
    : (snapshot.mediaFingerprint || `[${mediaType}:${snapshot.mediaCount || 1}]`);
  return `${chatKey}:${snapshot.messageId || snapshot.timestampLabel || stableTextKey}:${mediaType}`.slice(0, 260);
}

function rememberBrowserMessageKey(browserMessageKey) {
  if (!browserMessageKey) return;
  seenBrowserMessageIds.add(browserMessageKey);
  if (seenBrowserMessageIds.size > 1000) {
    const first = seenBrowserMessageIds.values().next().value;
    if (first) seenBrowserMessageIds.delete(first);
  }
}

function recentChatRowKey(row = {}) {
  const chatKey = normalizeChatKey(row.title || '');
  const preview = String(row.preview || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const timestampLabel = String(row.timestampLabel || '').trim();
  const unreadState = row.unread ? 'unread' : 'read';
  const rowType = row.callLog ? 'call' : 'message';
  return `${chatKey}:${timestampLabel}:${unreadState}:${rowType}:${preview}`.slice(0, 500);
}

function pruneRecentChatRowKeys(now = Date.now(), ttlMs = RECENT_CHAT_ROW_CACHE_MS) {
  for (const [rowKey, seenAt] of recentChatRowKeys.entries()) {
    if (now - seenAt > ttlMs) recentChatRowKeys.delete(rowKey);
  }
  while (recentChatRowKeys.size > 300) {
    const first = recentChatRowKeys.keys().next().value;
    if (!first) break;
    recentChatRowKeys.delete(first);
  }
}

function shouldSkipRecentChatRow(rowKey, ttlMs = RECENT_CHAT_ROW_CACHE_MS) {
  if (!rowKey) return false;
  const now = Date.now();
  pruneRecentChatRowKeys(now, ttlMs);
  const seenAt = recentChatRowKeys.get(rowKey);
  return Number.isFinite(seenAt) && now - seenAt < ttlMs;
}

function rememberRecentChatRow(rowKey) {
  if (!rowKey) return;
  recentChatRowKeys.set(rowKey, Date.now());
  pruneRecentChatRowKeys();
}

function rememberCallEventKey(callEventKey, ttlMs = 10 * 60 * 1000) {
  if (!callEventKey) return false;
  const now = Date.now();
  for (const [storedKey, seenAt] of seenCallEventKeys.entries()) {
    if (now - seenAt > ttlMs) seenCallEventKeys.delete(storedKey);
  }
  if (seenCallEventKeys.has(callEventKey)) return false;
  seenCallEventKeys.set(callEventKey, now);
  return true;
}

function outboxReplyDedupeKey(item = {}) {
  const recipient = normalizeChatKey(item.recipient || '');
  const text = normalizeReplyText(item.text || '').slice(0, 1000).toLowerCase();
  const key = item.metadata?.reply_dedupe_key || '';
  return `${recipient}:${key || text}`;
}

function hasRecentlySentReply(item = {}, ttlMs = RECENTLY_SENT_REPLY_TTL_MS) {
  const key = outboxReplyDedupeKey(item);
  if (!key.trim()) return false;
  const now = Date.now();
  for (const [storedKey, sentAt] of recentlySentReplyKeys.entries()) {
    if (now - sentAt > ttlMs) recentlySentReplyKeys.delete(storedKey);
  }
  const lastSentAt = recentlySentReplyKeys.get(key);
  return !!lastSentAt && now - lastSentAt <= ttlMs;
}

function rememberRecentlySentReply(item = {}) {
  const key = outboxReplyDedupeKey(item);
  if (key.trim()) recentlySentReplyKeys.set(key, Date.now());
}

function isTimestampOnly(value) {
  return /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(String(value || '').trim());
}

function normalizeReplyText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hostedRuntimeMetadata() {
  const renderSignals = {
    render_service_id: process.env.RENDER_SERVICE_ID || '',
    render_service_name: process.env.RENDER_SERVICE_NAME || '',
    render_instance_id: process.env.RENDER_INSTANCE_ID || '',
    render_external_hostname: process.env.RENDER_EXTERNAL_HOSTNAME || ''
  };
  const hosted = String(process.env.WHATSAPP_WEB_COPILOT_HOSTED || '').trim().toLowerCase() === 'true'
    || PROFILE_DIR.startsWith('/var/data')
    || Object.values(renderSignals).some(Boolean);

  return {
    hosted,
    production: process.env.NODE_ENV === 'production',
    runtime: hosted ? 'render_worker' : 'local_browser',
    deploy_target: hosted ? 'render' : 'local',
    node_version: process.version.replace(/^v/, ''),
    ...Object.fromEntries(Object.entries(renderSignals).filter(([, value]) => Boolean(value)))
  };
}

async function apiRequest(endpoint, { method = 'GET', body } = {}) {
  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= API_RETRY_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-whatsapp-web-bridge-token': BRIDGE_TOKEN
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === API_RETRY_ATTEMPTS) {
        break;
      }

      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const backoffMs = retryAfter > 0
        ? Math.min(10_000, retryAfter * 1000)
        : Math.min(3000, 150 * attempt + Math.floor(Math.random() * 150));
      log(`API ${method} ${endpoint} returned HTTP ${response.status}; retrying in ${backoffMs}ms (${attempt}/${API_RETRY_ATTEMPTS})`);
      await sleep(backoffMs);
    } catch (error) {
      lastError = error;
      if (attempt === API_RETRY_ATTEMPTS) throw error;
      const backoffMs = Math.min(3000, 150 * attempt + Math.floor(Math.random() * 150));
      log(`API ${method} ${endpoint} failed: ${error.message || error}; retrying in ${backoffMs}ms (${attempt}/${API_RETRY_ATTEMPTS})`);
      await sleep(backoffMs);
    }
  }

  if (!response) {
    throw lastError || new Error(`No response from ${endpoint}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload || {};
}

async function sendHeartbeat(extra = {}) {
  try {
    const normalizedExtra = extra && typeof extra === 'object' ? extra : {};
    const { metadata, ...rest } = normalizedExtra;
    await apiRequest('/api/whatsapp/web-bridge/heartbeat', {
      method: 'POST',
      body: {
        client_id: CLIENT_ID,
        operator_name: OPERATOR_NAME || null,
        browser_name: 'Google Chrome',
        profile_dir: PROFILE_DIR,
        ...rest,
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          ...hostedRuntimeMetadata()
        }
      }
    });
  } catch (error) {
    log('heartbeat failed:', error.message || error);
  }
}

async function captureLoginScreenshotDataUrl(page) {
  if (!LOGIN_SCREENSHOT_ENABLED || !page || page.isClosed()) return '';
  try {
    const buffer = await page.screenshot({ type: 'jpeg', quality: 35, fullPage: false });
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch (error) {
    log('login screenshot capture failed:', error.message || error);
    return '';
  }
}

async function refreshWhatsappLoginQrIfNeeded(page) {
  if (!page || page.isClosed()) return { refreshed: false };

  try {
    const result = await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 12 && rect.height > 12;
      };
      const clickCenter = (el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            view: window
          }));
        }
      };
      const bodyText = normalize(document.body?.innerText || '');
      const hasReloadPrompt = bodyText.includes('select to reload qr code')
        || bodyText.includes('reload qr code')
        || bodyText.includes('reload qr');
      if (!hasReloadPrompt) return { refreshed: false, reason: 'no_reload_prompt' };

      const candidates = Array.from(document.querySelectorAll('button, [role="button"], [tabindex], div, span'))
        .filter(isVisible)
        .map((el) => ({
          el,
          label: normalize([
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.textContent
          ].filter(Boolean).join(' '))
        }));
      const target = candidates.find(({ label }) => label.includes('reload qr code') || label.includes('reload qr'))
        || candidates.find(({ label }) => label.includes('select to reload'));
      const clickable = target?.el?.closest('button, [role="button"], [tabindex]') || target?.el;
      if (!clickable || !isVisible(clickable)) return { refreshed: false, reason: 'reload_target_missing' };

      clickCenter(clickable);
      return { refreshed: true, reason: 'clicked_reload_qr' };
    });

    if (result?.refreshed) {
      log('refreshed WhatsApp login QR code before heartbeat screenshot.');
      await page.waitForTimeout(2500);
    }
    return result || { refreshed: false, reason: 'unknown' };
  } catch (error) {
    log(`failed to refresh WhatsApp login QR code: ${error?.message || error}`);
    return { refreshed: false, reason: 'refresh_error' };
  }
}

function maskPhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return `${digits.slice(0, Math.min(4, digits.length))}...${digits.slice(-4)}`;
}

async function clickWhatsappPhoneLoginLink(page) {
  const locators = [
    page.getByRole('link', { name: /log in with phone number/i }).first(),
    page.getByRole('button', { name: /log in with phone number/i }).first(),
    page.getByText(/log in with phone number/i).first(),
    page.locator('a, button, [role="button"], [tabindex]').filter({ hasText: /log in with phone number/i }).first()
  ];

  for (const locator of locators) {
    if (await clickVisibleLocator(locator, 1200)) {
      await page.waitForTimeout(2500);
      return true;
    }
  }

  return false;
}

async function submitWhatsappPhonePairingWithPlaywright(page) {
  const codeScreenState = await page.evaluate(() => {
    const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const codeVisible = /\b[A-Z0-9]\s+[A-Z0-9]\s+[A-Z0-9]\s+[A-Z0-9]\s*-\s*[A-Z0-9]\s+[A-Z0-9]\s+[A-Z0-9]\s+[A-Z0-9]\b/i.test(text)
      || /\b[A-Z0-9]{4}\s*-\s*[A-Z0-9]{4}\b/i.test(text);
    return {
      codeScreen: lower.includes('enter code on phone') || lower.includes('linking whatsapp account'),
      codeVisible
    };
  }).catch(() => ({ codeScreen: false, codeVisible: false }));

  if (codeScreenState.codeScreen) {
    if (codeScreenState.codeVisible) {
      return { attempted: true, state: 'pairing_code_visible', reason: null };
    }
    const editClicked = await clickVisibleLocator(page.getByText(/^edit$/i).first(), 1200)
      || await clickVisibleLocator(page.locator('a, button, [role="button"], [tabindex]').filter({ hasText: /^edit$/i }).first(), 1200);
    if (!editClicked) {
      return { attempted: true, state: 'pairing_code_loading', reason: 'edit_link_missing' };
    }
    await page.waitForTimeout(1800);
  }

  try {
    await page.getByText(/enter phone number/i).first().waitFor({ state: 'visible', timeout: 1800 });
  } catch (_error) {
    return { attempted: false, reason: 'phone_form_not_visible' };
  }

  const digits = PAIRING_PHONE_NUMBER.replace(/\D/g, '');
  const visibleInputs = page.locator('input:visible');
  const inputCount = await visibleInputs.count().catch(() => 0);
  if (!inputCount) return { attempted: true, state: 'phone_form_visible', reason: 'phone_input_missing' };

  const phoneInput = visibleInputs.nth(inputCount - 1);
  try {
    await phoneInput.click({ timeout: 1200 });
    await phoneInput.fill(PAIRING_PHONE_NUMBER, { timeout: 1500 });
    let currentValue = await phoneInput.inputValue({ timeout: 800 }).catch(() => '');
    if (!currentValue.replace(/\D/g, '').endsWith(digits.slice(-8))) {
      await phoneInput.click({ timeout: 1200 });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.type(PAIRING_PHONE_NUMBER, { delay: 20 });
      currentValue = await phoneInput.inputValue({ timeout: 800 }).catch(() => '');
    }

    if (!currentValue.replace(/\D/g, '').endsWith(digits.slice(-8))) {
      return {
        attempted: true,
        state: 'phone_form_visible',
        reason: 'phone_fill_did_not_stick'
      };
    }
  } catch (error) {
    return {
      attempted: true,
      state: 'phone_form_visible',
      reason: `phone_fill_error:${String(error?.message || error).slice(0, 80)}`
    };
  }

  const nextLocators = [
    page.getByRole('button', { name: /^next$/i }).first(),
    page.getByText(/^next$/i).first(),
    page.locator('button, [role="button"], [tabindex]').filter({ hasText: /^next$/i }).first()
  ];
  for (const locator of nextLocators) {
    if (await clickVisibleLocator(locator, 1500)) {
      await page.waitForTimeout(5000);
      return { attempted: true, state: 'submitted_phone_number', reason: null };
    }
  }

  return { attempted: true, state: 'phone_number_filled', reason: 'next_button_missing' };
}

async function startWhatsappPhonePairingIfConfigured(page) {
  if (!page || page.isClosed()) return { attempted: false, reason: 'page_unavailable' };
  if (!PAIRING_PHONE_NUMBER) return { attempted: false, reason: 'phone_pairing_not_configured' };
  if (LOGIN_METHOD === 'qr' || LOGIN_METHOD === 'qr_only') return { attempted: false, reason: 'qr_login_forced' };

  try {
    const clickedPhoneLogin = await clickWhatsappPhoneLoginLink(page);
    if (clickedPhoneLogin) {
      log('clicked WhatsApp "Log in with phone number" link with Playwright locator.');
    }
    const playwrightPairing = await submitWhatsappPhonePairingWithPlaywright(page);
    if (playwrightPairing.attempted) {
      log(`submitted WhatsApp phone pairing with Playwright (${playwrightPairing.state || playwrightPairing.reason || 'unknown'}).`);
    }

    const result = await page.evaluate(async ({ phone, clickedPhoneLogin, playwrightPairing }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const normalizedLower = (value) => normalize(value).toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 12 && rect.height > 12;
      };
      const clickCenter = (el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            view: window
          }));
        }
      };
      const visibleControls = () => Array.from(document.querySelectorAll('button, [role="button"], [tabindex], a, div, span'))
        .filter(isVisible)
        .map((el) => ({
          el,
          label: normalizedLower([
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.textContent
          ].filter(Boolean).join(' '))
        }));
      const visibleInputs = () => Array.from(document.querySelectorAll('input, [role="textbox"], [contenteditable="true"]'))
        .filter(isVisible);
      const inspectPairingState = () => {
        const text = normalizedLower(document.body?.innerText || '');
        const inputLabels = visibleInputs().map((input) => normalizedLower([
          input.getAttribute('aria-label'),
          input.getAttribute('placeholder'),
          input.getAttribute('title'),
          input.textContent
        ].filter(Boolean).join(' ')));
        const hasPhoneInput = inputLabels.some((label) => label.includes('phone'));
        const codeVisible = (text.includes('enter this code') || text.includes('enter code') || text.includes('code on your phone'))
          && (text.includes('linked devices') || text.includes('on your phone') || text.includes('your phone'));
        const phoneFormVisible = text.includes('enter phone number')
          || text.includes('confirm your phone number')
          || text.includes('select your country')
          || hasPhoneInput;
        return { text, codeVisible, phoneFormVisible };
      };
      const setValue = (input, value) => {
        input.focus();
        if (input.matches?.('[contenteditable="true"]')) {
          input.textContent = '';
          document.execCommand?.('insertText', false, value);
        } else {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      let state = inspectPairingState();
      if (state.codeVisible) return { attempted: true, state: 'pairing_code_visible' };
      if (playwrightPairing?.attempted) {
        return {
          attempted: true,
          state: state.phoneFormVisible
            ? (playwrightPairing.state || 'phone_form_visible')
            : (playwrightPairing.state || 'submitted_phone_number'),
          reason: playwrightPairing.reason || null,
          playwright_pairing: playwrightPairing
        };
      }

      if (!state.phoneFormVisible) {
        if (clickedPhoneLogin) {
          return { attempted: true, state: 'phone_login_clicked', reason: 'phone_form_not_visible_after_click' };
        }
        const phoneLogin = visibleControls().find(({ label }) => (
          label.includes('log in with phone number')
          || label.includes('link with phone number')
          || label === 'phone number'
        ));
        const clickable = phoneLogin?.el?.closest('button, [role="button"], a, [tabindex]') || phoneLogin?.el;
        if (!clickable || !isVisible(clickable)) return { attempted: false, reason: 'phone_login_link_missing' };
        clickCenter(clickable);
        await sleep(1800);
        state = inspectPairingState();
      }

      if (state.codeVisible) return { attempted: true, state: 'pairing_code_visible' };
      if (!state.phoneFormVisible) return { attempted: true, state: 'phone_login_clicked', reason: 'phone_form_not_visible' };

      const inputs = visibleInputs();
      const phoneInput = inputs.find((input) => normalizedLower([
        input.getAttribute('aria-label'),
        input.getAttribute('placeholder'),
        input.getAttribute('title')
      ].filter(Boolean).join(' ')).includes('phone')) || inputs.find((input) => {
        const tag = normalizedLower(input.tagName);
        const type = normalizedLower(input.getAttribute('type') || 'text');
        return tag === 'input' && !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(type);
      });
      if (!phoneInput) return { attempted: true, state: 'phone_form_visible', reason: 'phone_input_missing' };

      setValue(phoneInput, phone.replace(/^\+/, ''));
      await sleep(300);

      const next = visibleControls().find(({ label }) => (
        label === 'next'
        || label.includes('next')
        || label.includes('continue')
      ));
      const nextClickable = next?.el?.closest('button, [role="button"], a, [tabindex]') || next?.el;
      if (!nextClickable || !isVisible(nextClickable)) {
        return { attempted: true, state: 'phone_number_filled', reason: 'next_button_missing' };
      }

      clickCenter(nextClickable);
      await sleep(5000);
      state = inspectPairingState();
      return {
        attempted: true,
        state: state.codeVisible ? 'pairing_code_visible' : (state.phoneFormVisible ? 'phone_form_visible' : 'submitted_phone_number')
      };
    }, { phone: PAIRING_PHONE_NUMBER, clickedPhoneLogin, playwrightPairing });

    if (result?.attempted) {
      log(`attempted WhatsApp phone-number pairing (${result.state || result.reason || 'unknown'}).`);
    }
    return {
      attempted: !!result?.attempted,
      state: result?.state || null,
      reason: result?.reason || null,
      playwright_pairing: result?.playwright_pairing || null,
      phone_masked: maskPhoneNumber(PAIRING_PHONE_NUMBER)
    };
  } catch (error) {
    log(`failed to start WhatsApp phone-number pairing: ${error?.message || error}`);
    return {
      attempted: true,
      reason: 'phone_pairing_error',
      phone_masked: maskPhoneNumber(PAIRING_PHONE_NUMBER)
    };
  }
}

async function detectWhatsappReady(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const bodyText = normalize(document.body?.innerText || '');
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8;
    };
    const exists = (selector) => {
      try {
        return !!document.querySelector(selector);
      } catch (_error) {
        return false;
      }
    };
    const existsVisible = (selector) => {
      try {
        return Array.from(document.querySelectorAll(selector)).some(isVisible);
      } catch (_error) {
        return false;
      }
    };
    const hasComposer = existsVisible('footer div[role="textbox"][contenteditable="true"], footer div[contenteditable="true"]');
    const hasChatListBySelector = [
      '#pane-side',
      '#side',
      '[aria-label*="Chat list"]',
      '[aria-label*="chat list"]',
      '[data-testid="chat-list"]',
      '[data-testid="chat-list-search"]',
      '[data-testid="cell-frame-container"]',
      'div[role="grid"]',
      'div[role="list"]',
      'div[role="listitem"]'
    ].some(existsVisible);
    const hasChatRows = Array.from(document.querySelectorAll('[data-testid="cell-frame-container"], div[role="listitem"], div[role="row"], [role="gridcell"]'))
      .some(isVisible);
    const hasSidebarLikeText = bodyText.includes('message notifications are off')
      || (bodyText.includes('all') && bodyText.includes('unread') && bodyText.includes('favorites') && bodyText.includes('groups'))
      || bodyText.includes('search or start new chat')
      || bodyText.includes('search or start a new chat')
      || bodyText.includes('search or start a chat')
      || bodyText.includes('search or start');
    const hasChatList = hasChatListBySelector || hasChatRows || hasSidebarLikeText;
    const hasSearchBox = Array.from(document.querySelectorAll('input, textarea, [role="textbox"], [contenteditable="true"], [aria-label], [title]'))
      .some((el) => {
        if (!isVisible(el)) return false;
        const text = [
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('title'),
          el.textContent
        ].map(normalize).join(' ');
        return text.includes('search');
      });
    const hasLoggedInShell = bodyText.includes('search or start new chat')
      || bodyText.includes('search or start a new chat')
      || bodyText.includes('search or start a chat')
      || bodyText.includes('search or start')
      || bodyText.includes('new chat')
      || bodyText.includes('message notifications are off')
      || bodyText.includes('archived')
      || (bodyText.includes('all') && bodyText.includes('unread') && bodyText.includes('favorites') && bodyText.includes('groups'));
    const loginPrompt = bodyText.includes('scan the qr code')
      || bodyText.includes('scan to log in')
      || bodyText.includes('scan the qr')
      || bodyText.includes('use whatsapp on your phone to link a device')
      || (bodyText.includes('link to your account') && (bodyText.includes('scan') || bodyText.includes('qr code')))
      || bodyText.includes('log in with phone number');
    const phonePairingPrompt = bodyText.includes('enter code on phone')
      || bodyText.includes('linking whatsapp account')
      || bodyText.includes('link with phone number instead');
    const databaseError = bodyText.includes('a database error occurred')
      || bodyText.includes('database error occurred')
      || bodyText.includes('your browser storage is full')
      || bodyText.includes('please clear browser storage');
    const openElsewhere = bodyText.includes('whatsapp is open in another window')
      || bodyText.includes('use whatsapp in this window')
      || bodyText.includes('click "use here"')
      || bodyText.includes('click “use here”');
    const readySignals = hasComposer || hasChatList || hasSearchBox || hasLoggedInShell;
    const waitingForLogin = (loginPrompt || phonePairingPrompt || databaseError) && !readySignals;
    return {
      waitingForLogin,
      ready: readySignals && !waitingForLogin,
      hasComposer,
      hasChatList,
      hasSearchBox,
      hasLoggedInShell,
      loginPrompt,
      phonePairingPrompt,
      databaseError,
      openElsewhere
    };
  });
}

function summarizeWhatsappReadyState(readyState = {}) {
  const flags = [
    readyState.hasComposer ? 'composer' : '',
    readyState.hasChatList ? 'chat_list' : '',
    readyState.hasSearchBox ? 'search_box' : '',
    readyState.hasLoggedInShell ? 'logged_in_shell' : '',
    readyState.loginPrompt ? 'login_prompt' : '',
    readyState.databaseError ? 'database_error' : '',
    readyState.openElsewhere ? 'open_elsewhere' : ''
  ].filter(Boolean).join(',');
  return `signals=${flags || 'none'}`;
}

async function detectAndDeclineIncomingCall(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 10 && rect.height > 10;
    };
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const header = document.querySelector('header');
    const headerTitle = header?.querySelector('span[title]')?.getAttribute('title')
      || Array.from(header?.querySelectorAll('[dir="auto"]') || []).map((el) => normalize(el.textContent)).find(Boolean)
      || '';
    const candidates = Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(isVisible)
      .map((button) => {
        const label = normalize([
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
          button.getAttribute('data-testid'),
          button.getAttribute('data-icon'),
          button.innerText,
          button.textContent
        ].filter(Boolean).join(' '));
        return { button, label };
      });
    const decline = candidates.find(({ label }) => (
      /\b(decline|reject|ignore|end call|hang up|hangup|dismiss)\b/i.test(label)
      || /call-(?:end|reject|decline)/i.test(label)
    ));
    if (!decline) return { detected: false };

    const root = decline.button.closest('[role="dialog"], [aria-modal="true"], [data-testid*="call" i]')
      || decline.button.closest('div')
      || document.body;
    const rootText = normalize(root.innerText || root.textContent || '');
    const bodyText = normalize(document.body?.innerText || '');
    const callText = rootText || bodyText;
    const callDetected = /\b(incoming|calling|call|video call|voice call)\b/i.test(callText + ' ' + decline.label);
    if (!callDetected) return { detected: false };

    const nameCandidates = Array.from(root.querySelectorAll('span[title], [dir="auto"], h1, h2, h3'))
      .map((el) => normalize(el.getAttribute('title') || el.textContent))
      .filter((text) => text && !/\b(decline|accept|call|video|voice|ringing)\b/i.test(text));
    const callerName = nameCandidates[0] || headerTitle || '';
    const phoneDigits = (callerName || headerTitle || callText).replace(/\D/g, '');
    const chatKey = phoneDigits.length >= 9 ? phoneDigits : (headerTitle || callerName);
    const callType = /video/i.test(callText + ' ' + decline.label) ? 'video' : 'voice';
    decline.button.click();

    return {
      detected: true,
      declined: true,
      chatKey,
      callerName,
      callType,
      label: decline.label,
      rawText: callText.slice(0, 500),
      eventId: `web-call-${Date.now()}-${Math.random().toString(16).slice(2)}`
    };
  }).catch((error) => ({
    detected: false,
    error: error.message || String(error)
  }));
}

async function scanChatRows(page, { unreadOnly = true, limit = 20 } = {}) {
  return page.evaluate((options) => {
    const unreadOnlyRows = options?.unreadOnly !== false;
    const maxRows = Math.max(1, Math.min(50, Number(options?.limit || 20)));
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const hasCallLogText = (value = '') => {
      const combined = String(value || '').replace(/\s+/g, ' ').trim();
      return (
        /\b(?:voice|video)\s+call\b/i.test(combined)
        && /\b(?:no answer|missed|unanswered|declined|rejected|not answered|call back)\b/i.test(combined)
      ) || /\bmissed\s+(?:voice|video)\s+call\b/i.test(combined);
    };
    const selectorGroups = [
      '#pane-side [data-testid="cell-frame-container"]',
      '#pane-side div[role="listitem"]',
      '#pane-side div[role="row"]',
      '[aria-label*="Chat list" i] [data-testid="cell-frame-container"]',
      '[aria-label*="Chat list" i] div[role="listitem"]',
      '[aria-label*="Chat list" i] div[role="row"]',
      'div[role="grid"] div[role="row"]',
      '[data-testid="cell-frame-container"]',
      'div[role="listitem"]'
    ];
    let rows = [];
    let rowSelector = '';
    for (const selector of selectorGroups) {
      rows = Array.from(document.querySelectorAll(selector));
      if (rows.length) {
        rowSelector = selector;
        break;
      }
    }

    return rows.map((row, index) => {
      const rowText = row.innerText || '';
      const rowLines = rowText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const title = row.querySelector('span[title]')?.getAttribute('title')
        || Array.from(row.querySelectorAll('[dir="auto"]')).map((el) => (el.textContent || '').trim()).find(Boolean)
        || rowLines[0]
        || '';
      const ariaLabel = row.getAttribute('aria-label') || '';
      const unread = !!row.querySelector('[aria-label*="unread"], [data-testid*="unread"], [data-icon*="unread"]')
        || /unread/i.test(ariaLabel);
      const timestampLabel = rowLines.find((line) => /^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(line)) || '';
      const preview = rowLines
        .filter((line) => line !== title && line !== timestampLabel)
        .filter((line) => !/^\d+\s*(?:unread messages?|unread)$/i.test(line))
        .filter((line) => !/^unread$/i.test(line))
        .slice(0, 4)
        .join(' ')
        .trim();
      const callLog = hasCallLogText(`${preview} ${ariaLabel}`);
      return {
        index,
        selector: rowSelector,
        title,
        preview: normalize(preview),
        unread,
        timestampLabel,
        callLog
      };
    }).filter((row) => row.title && (!unreadOnlyRows || row.unread)).slice(0, maxRows);
  }, { unreadOnly, limit });
}

async function scanUnreadChats(page) {
  return scanChatRows(page, { unreadOnly: true, limit: 25 });
}

async function clickVisibleLocator(locator, timeoutMs = 900) {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    await locator.click({ timeout: timeoutMs });
    return true;
  } catch (_error) {
    return false;
  }
}

async function openChatRow(page, row = {}) {
  const selectors = [
    row.selector,
    '#pane-side [data-testid="cell-frame-container"]',
    '#pane-side div[role="listitem"]',
    '#pane-side div[role="row"]',
    '[aria-label*="Chat list" i] [data-testid="cell-frame-container"]',
    '[aria-label*="Chat list" i] div[role="listitem"]',
    '[aria-label*="Chat list" i] div[role="row"]',
    'div[role="grid"] div[role="row"]',
    '[data-testid="cell-frame-container"]',
    'div[role="listitem"]'
  ].filter(Boolean);
  const openedInPage = await page.evaluate(({ selectors: rowSelectors, title, index }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8;
    };
    const clickCenter = (el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window
        }));
      }
    };
    const wantedTitle = normalize(title);
    for (const selector of rowSelectors) {
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      } catch (_error) {
        matches = [];
      }
      if (!matches.length) continue;
      const exact = wantedTitle
        ? matches.find((candidate) => normalize(candidate.innerText || candidate.textContent || '').includes(wantedTitle))
        : null;
      const candidate = exact || matches[index] || matches[0];
      if (!candidate) continue;
      clickCenter(candidate);
      return true;
    }
    return false;
  }, {
    selectors,
    title: row.title || '',
    index: Math.max(0, Number(row.index || 0))
  }).catch(() => false);
  if (openedInPage) {
    await page.waitForTimeout(160);
    return true;
  }

  const index = Math.max(0, Number(row.index || 0));
  for (const selector of selectors) {
    const rows = page.locator(selector);
    const rowCount = await rows.count().catch(() => 0);
    if (rowCount > index) {
      const locator = rows.nth(index);
      const clicked = await clickVisibleLocator(locator, 700);
      if (!clicked) continue;
      await page.waitForTimeout(120);
      return true;
    }
  }
  return false;
}

async function openChatByIndex(page, index) {
  return openChatRow(page, { index });
}

function unreadPreviewSnapshot(row = {}, source = 'unread_preview_fallback') {
  const text = normalizeReplyText(row.preview || '');
  if (!row.unread || !row.title || !text) return null;
  if (/^(?:photo|image|video|voice message|sticker|gif|\+\d+)$/i.test(text)) return null;
  return {
    chatKey: row.title,
    contactName: row.title,
    text,
    timestampLabel: row.timestampLabel || new Date().toISOString(),
    messageId: `row-preview:${createMessageId(row.title, text, row.timestampLabel, 'text', source)}`,
    direction: 'in',
    mediaType: 'text',
    mediaUrl: '',
    mediaCount: 0,
    mediaFingerprint: [
      'unread-row-preview-fallback',
      row.title,
      row.timestampLabel || '',
      text
    ].join('|').slice(0, 500)
  };
}

async function getActiveChatSnapshot(page) {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    const headerTitle = header?.querySelector('span[title]')?.getAttribute('title')
      || Array.from(header?.querySelectorAll('[dir="auto"]') || []).map((el) => (el.textContent || '').trim()).find(Boolean)
      || '';
    const phoneLike = (value) => {
      const digits = String(value || '').replace(/\D/g, '');
      return digits.length >= 7 ? digits : '';
    };
    const phoneFromMessageDataId = (value) => {
      const text = String(value || '');
      const match = text.match(/(?:^|[_:-])(\d{9,16})@(?:c\.us|s\.whatsapp\.net)\b/i)
        || text.match(/\b(\d{9,16})@(?:c\.us|s\.whatsapp\.net)\b/i);
      return match?.[1] || '';
    };
    const dataIdForNode = (node) => node?.closest?.('[data-id]')?.getAttribute('data-id')
      || node?.getAttribute?.('data-id')
      || '';
    const modernMessageRootForNode = (node) => node?.closest?.('[data-testid^="conv-msg-"]')
      || (node?.matches?.('[data-testid^="conv-msg-"]') ? node : null);
    const canonicalMessageRootForNode = (node) => modernMessageRootForNode(node)
      || node?.closest?.('[data-id], .message-in, .message-out')
      || node;
    const messageIdForNode = (node) => {
      const root = canonicalMessageRootForNode(node);
      return root?.getAttribute?.('data-id')
        || root?.getAttribute?.('data-testid')
        || dataIdForNode(node)
        || '';
    };
    const phoneFromNode = (node) => phoneFromMessageDataId(dataIdForNode(node));
    const directionFromDataId = (value) => {
      const text = String(value || '');
      if (/^true_/.test(text)) return 'out';
      if (/^false_/.test(text)) return 'in';
      return '';
    };
    const isLikelyOutgoingSender = (value) => /^(?:you|me|makaug(?:\.com)?)$/i.test(String(value || '').trim());
    const isTimestampOnlyText = (value) => /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(String(value || '').trim());
    const cleanRenderedMessageText = (value, mediaType = 'text') => {
      const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const withoutTime = lines.filter((line) => !isTimestampOnlyText(line));
      if (mediaType === 'image' && withoutTime.every((line) => /^\+\d+$/.test(line))) return '';
      return withoutTime.join('\n').trim();
    };
    const parseCoords = (value) => {
      const raw = String(value || '');
      const decoded = (() => {
        try { return decodeURIComponent(raw); } catch (_error) { return raw; }
      })();
      const candidates = [
        decoded.match(/[?&](?:q|query|center|markers)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i),
        decoded.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i),
        decoded.match(/\b(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})\b/)
      ].filter(Boolean);
      if (!candidates.length) return null;
      const lat = Number(candidates[0][1]);
      const lng = Number(candidates[0][2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    };
    const extractSharedLocation = (root) => {
      const values = [
        ...Array.from(root.querySelectorAll('a')).map((a) => a.href || ''),
        ...Array.from(root.querySelectorAll('img')).map((img) => `${img.src || ''} ${img.alt || ''}`)
      ];
      for (const value of values) {
        const coords = parseCoords(value);
        if (coords) return coords;
      }
      return null;
    };
    const hasVoiceNote = (root, text = '') => {
      if (!root) return false;
      if (root.querySelector('audio, source[type^="audio/"]')) return true;
      const voiceControl = root.querySelector([
        '[aria-label*="voice" i]',
        '[aria-label*="audio" i]',
        '[aria-label*="Play voice" i]',
        '[aria-label*="Play" i]',
        '[data-icon*="audio" i]',
        '[data-icon*="ptt" i]',
        '[data-testid*="audio" i]'
      ].join(','));
      if (voiceControl) return true;
      return /\b0:\d{2}\b/.test(String(text || '')) && !!root.querySelector('canvas, svg, button');
    };
    const hasCallLog = (root, text = '') => {
      if (!root) return false;
      const labels = Array.from(root.querySelectorAll('[aria-label], [data-icon], [data-testid], [title]'))
        .map((el) => [
          el.getAttribute('aria-label'),
          el.getAttribute('data-icon'),
          el.getAttribute('data-testid'),
          el.getAttribute('title')
        ].filter(Boolean).join(' '))
        .join(' ');
      const combined = `${text || ''} ${labels}`.replace(/\s+/g, ' ').trim();
      return (
        /\b(?:voice|video)\s+call\b/i.test(combined)
        && /\b(?:no answer|missed|unanswered|declined|rejected|not answered|call back)\b/i.test(combined)
      ) || /\bmissed\s+(?:voice|video)\s+call\b/i.test(combined);
    };
    const callLogContainerFor = (node) => {
      let current = node;
      let best = null;
      for (let depth = 0; current && current !== document.body && depth < 10; depth += 1) {
        const text = current.innerText || current.textContent || '';
        if (hasCallLog(current, text)) best = current;
        if (best && current.matches?.('.message-in, .message-out, [data-id], [data-testid^="conv-msg-"], [role="row"]')) return current;
        current = current.parentElement;
      }
      return best;
    };
    const chatRoot = document.querySelector('#main')
      || document.querySelector('[data-testid="conversation-panel-wrapper"]')
      || document.body;
    const directionForNode = (node, senderLabel = '') => {
      const root = canonicalMessageRootForNode(node);
      if (root?.closest?.('.message-out')) return 'out';
      if (root?.closest?.('.message-in')) return 'in';
      const dataDirection = directionFromDataId(messageIdForNode(root));
      if (dataDirection) return dataDirection;
      const container = root?.querySelector?.('[data-testid="msg-container"]')
        || (root?.matches?.('[data-testid="msg-container"]') ? root : null)
        || root;
      const rootRect = chatRoot.getBoundingClientRect();
      const rect = container?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rootRect.width > 0) {
        const messageCenter = rect.left + rect.width / 2;
        const panelCenter = rootRect.left + rootRect.width / 2;
        return messageCenter < panelCenter ? 'in' : 'out';
      }
      return senderLabel ? (isLikelyOutgoingSender(senderLabel) ? 'out' : 'in') : 'unknown';
    };

    const copyNodes = Array.from(chatRoot.querySelectorAll('div.copyable-text[data-pre-plain-text]'));
    const modernMessageNodes = Array.from(chatRoot.querySelectorAll('[data-testid^="conv-msg-"]'));
    const mediaOnlyNodes = Array.from(chatRoot.querySelectorAll('[data-id], [data-testid^="conv-msg-"]')).filter((el) => {
      if (el.querySelector('div.copyable-text[data-pre-plain-text]')) return false;
      const text = el.innerText || el.textContent || '';
      return !!el.querySelector('img, video, audio') || hasVoiceNote(el, text) || hasCallLog(el, text);
    });
    const callLogNodes = Array.from(chatRoot.querySelectorAll('div, span, [role="button"], [aria-label], [title], [data-icon], [data-testid]'))
      .map(callLogContainerFor)
      .filter(Boolean)
      .filter((el, idx, arr) => arr.indexOf(el) === idx)
      .filter((el) => hasCallLog(el, el.innerText || el.textContent || ''));
    const nodes = [...copyNodes, ...modernMessageNodes, ...mediaOnlyNodes, ...callLogNodes]
      .map(canonicalMessageRootForNode)
      .filter((el, idx, arr) => arr.indexOf(el) === idx)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const last = nodes[nodes.length - 1];
    if (!last) {
      return {
        chatKey: headerTitle,
        contactName: headerTitle,
        text: '',
        timestampLabel: '',
        messageId: '',
        mediaType: 'text'
      };
    }

    const copyNode = last.matches('div.copyable-text[data-pre-plain-text]')
      ? last
      : last.querySelector('div.copyable-text[data-pre-plain-text]');
    const pre = copyNode?.getAttribute('data-pre-plain-text') || '';
    let fallbackChatKey = '';
    let fallbackContactName = '';
    for (const node of copyNodes) {
      if (node === last || (node.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      const nodePre = node.getAttribute('data-pre-plain-text') || '';
      const nodeSender = nodePre
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/:\s*$/, '')
        .trim();
      const nodeDirection = directionForNode(node, nodeSender);
      const nodeDigits = phoneLike(nodeSender) || (nodeDirection === 'in' ? phoneFromNode(node) : '');
      if (nodeDigits && nodeDirection !== 'out') {
        fallbackChatKey = nodeDigits;
        fallbackContactName = nodeSender;
      }
    }
    const renderedText = (last.innerText || last.textContent || '').trim();
    const timestampLabel = (pre.match(/^\[(.*?)\]/) || [])[1]
      || (renderedText.match(/(?:^|\n)(\d{1,2}:\d{2}\s*(?:AM|PM)?)(?:\n|$)/i) || [])[1]
      || '';
    const senderLabel = pre
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/:\s*$/, '')
      .trim();
    const messageId = messageIdForNode(last);
    const dataIdDigits = phoneFromMessageDataId(messageId);
    const dataIdDirection = directionFromDataId(messageId);
    const senderDigits = phoneLike(senderLabel);
    const headerDigits = phoneLike(headerTitle);
    const direction = directionForNode(last, senderLabel) || dataIdDirection;
    const resolvedChatKey = senderDigits || headerDigits || dataIdDigits || fallbackChatKey || headerTitle || senderLabel;
    const contactName = senderDigits || dataIdDigits
      ? headerTitle
      : (headerDigits ? senderLabel : (fallbackContactName || headerTitle || senderLabel));
    const text = renderedText;
    const mediaFingerprint = [
      nodes.indexOf(last),
      ...Array.from(last.querySelectorAll('img, video, a')).map((el) => (
        el.getAttribute('src')
        || el.getAttribute('href')
        || el.getAttribute('alt')
        || el.getAttribute('aria-label')
        || ''
      ))
    ].filter(Boolean).join('|').slice(0, 500);
    const nonEmojiImages = Array.from(last.querySelectorAll('img')).filter((img) => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      return !src.startsWith('data:image/gif') && !img.className.includes('emoji') && !alt.match(/^\p{Emoji}+$/u);
    });
    const highResolutionImages = nonEmojiImages.filter((img) => img.naturalWidth >= 160 && img.naturalHeight >= 120);
    const hasNonEmojiImage = highResolutionImages.length > 0 || nonEmojiImages.length > 0;
    const extraImageMatch = text.match(/\+(\d+)/);
    const mediaCount = hasNonEmojiImage
      ? Math.max(1, highResolutionImages.length, extraImageMatch ? Number(extraImageMatch[1]) + 2 : 1)
      : 0;
    const sharedLocation = extractSharedLocation(last);
    const voiceNote = hasVoiceNote(last, text);
    const callLog = hasCallLog(last, text);
    const mediaType = sharedLocation
      ? 'location'
      : hasNonEmojiImage && isTimestampOnlyText(text) && !!sharedLocation
        ? 'location_preview'
      : callLog
        ? 'call'
      : voiceNote
        ? 'voice'
      : last.querySelector('img')
      ? 'image'
      : last.querySelector('video')
          ? 'media'
          : 'text';
    const cleanText = cleanRenderedMessageText(text, mediaType);

    return {
      chatKey: resolvedChatKey,
      contactName,
      text: cleanText || (mediaType === 'call' ? '[missed call]' : mediaType === 'image' ? '[image]' : mediaType === 'voice' ? '[voice note]' : mediaType === 'media' ? '[media]' : ''),
      timestampLabel,
      messageId,
      direction,
      mediaType,
      mediaUrl: mediaType === 'text' || mediaType === 'call' ? '' : `whatsapp-web://${messageId || crypto.randomUUID()}`,
      sharedLocation,
      mediaCount,
      mediaFingerprint
    };
  });
}

async function getRecentIncomingSnapshots(page, limit = 20) {
  return page.evaluate((maxItems) => {
    const header = document.querySelector('header');
    const headerTitle = header?.querySelector('span[title]')?.getAttribute('title')
      || Array.from(header?.querySelectorAll('[dir="auto"]') || []).map((el) => (el.textContent || '').trim()).find(Boolean)
      || '';
    const phoneLike = (value) => {
      const digits = String(value || '').replace(/\D/g, '');
      return digits.length >= 7 ? digits : '';
    };
    const phoneFromMessageDataId = (value) => {
      const text = String(value || '');
      const match = text.match(/(?:^|[_:-])(\d{9,16})@(?:c\.us|s\.whatsapp\.net)\b/i)
        || text.match(/\b(\d{9,16})@(?:c\.us|s\.whatsapp\.net)\b/i);
      return match?.[1] || '';
    };
    const dataIdForNode = (node) => node?.closest?.('[data-id]')?.getAttribute('data-id')
      || node?.getAttribute?.('data-id')
      || '';
    const modernMessageRootForNode = (node) => node?.closest?.('[data-testid^="conv-msg-"]')
      || (node?.matches?.('[data-testid^="conv-msg-"]') ? node : null);
    const canonicalMessageRootForNode = (node) => modernMessageRootForNode(node)
      || node?.closest?.('[data-id], .message-in, .message-out')
      || node;
    const messageIdForNode = (node) => {
      const root = canonicalMessageRootForNode(node);
      return root?.getAttribute?.('data-id')
        || root?.getAttribute?.('data-testid')
        || dataIdForNode(node)
        || '';
    };
    const directionFromDataId = (value) => {
      const text = String(value || '');
      if (/^true_/.test(text)) return 'out';
      if (/^false_/.test(text)) return 'in';
      return '';
    };
    const isLikelyOutgoingSender = (value) => /^(?:you|me|makaug(?:\.com)?)$/i.test(String(value || '').trim());
    const isTimestampOnlyText = (value) => /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(String(value || '').trim());
    const cleanRenderedMessageText = (value, mediaType = 'text') => {
      const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const withoutTime = lines.filter((line) => !isTimestampOnlyText(line));
      if (mediaType === 'image' && withoutTime.every((line) => /^\+\d+$/.test(line))) return '';
      return withoutTime.join('\n').trim();
    };
    const parseCoords = (value) => {
      const raw = String(value || '');
      const decoded = (() => {
        try { return decodeURIComponent(raw); } catch (_error) { return raw; }
      })();
      const candidates = [
        decoded.match(/[?&](?:q|query|center|markers)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i),
        decoded.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i),
        decoded.match(/\b(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})\b/)
      ].filter(Boolean);
      if (!candidates.length) return null;
      const lat = Number(candidates[0][1]);
      const lng = Number(candidates[0][2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    };
    const extractSharedLocation = (root) => {
      const values = [
        ...Array.from(root.querySelectorAll('a')).map((a) => a.href || ''),
        ...Array.from(root.querySelectorAll('img')).map((img) => `${img.src || ''} ${img.alt || ''}`)
      ];
      for (const value of values) {
        const coords = parseCoords(value);
        if (coords) return coords;
      }
      return null;
    };
    const hasVoiceNote = (root, text = '') => {
      if (!root) return false;
      if (root.querySelector('audio, source[type^="audio/"]')) return true;
      const voiceControl = root.querySelector([
        '[aria-label*="voice" i]',
        '[aria-label*="audio" i]',
        '[aria-label*="Play voice" i]',
        '[aria-label*="Play" i]',
        '[data-icon*="audio" i]',
        '[data-icon*="ptt" i]',
        '[data-testid*="audio" i]'
      ].join(','));
      if (voiceControl) return true;
      return /\b0:\d{2}\b/.test(String(text || '')) && !!root.querySelector('canvas, svg, button');
    };
    const hasCallLog = (root, text = '') => {
      if (!root) return false;
      const labels = Array.from(root.querySelectorAll('[aria-label], [data-icon], [data-testid], [title]'))
        .map((el) => [
          el.getAttribute('aria-label'),
          el.getAttribute('data-icon'),
          el.getAttribute('data-testid'),
          el.getAttribute('title')
        ].filter(Boolean).join(' '))
        .join(' ');
      const combined = `${text || ''} ${labels}`.replace(/\s+/g, ' ').trim();
      return (
        /\b(?:voice|video)\s+call\b/i.test(combined)
        && /\b(?:no answer|missed|unanswered|declined|rejected|not answered|call back)\b/i.test(combined)
      ) || /\bmissed\s+(?:voice|video)\s+call\b/i.test(combined);
    };
    const callLogContainerFor = (node) => {
      let current = node;
      let best = null;
      for (let depth = 0; current && current !== document.body && depth < 10; depth += 1) {
        const text = current.innerText || current.textContent || '';
        if (hasCallLog(current, text)) best = current;
        if (best && current.matches?.('.message-in, .message-out, [data-id], [data-testid^="conv-msg-"], [role="row"]')) return current;
        current = current.parentElement;
      }
      return best;
    };
    const chatRoot = document.querySelector('#main')
      || document.querySelector('[data-testid="conversation-panel-wrapper"]')
      || document.body;
    const directionForNode = (node, senderLabel = '') => {
      const root = canonicalMessageRootForNode(node);
      if (root?.closest?.('.message-out')) return 'out';
      if (root?.closest?.('.message-in')) return 'in';
      const dataDirection = directionFromDataId(messageIdForNode(root));
      if (dataDirection) return dataDirection;
      const container = root?.querySelector?.('[data-testid="msg-container"]')
        || (root?.matches?.('[data-testid="msg-container"]') ? root : null)
        || root;
      const rootRect = chatRoot.getBoundingClientRect();
      const rect = container?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rootRect.width > 0) {
        const messageCenter = rect.left + rect.width / 2;
        const panelCenter = rootRect.left + rootRect.width / 2;
        return messageCenter < panelCenter ? 'in' : 'out';
      }
      return senderLabel ? (isLikelyOutgoingSender(senderLabel) ? 'out' : 'in') : 'unknown';
    };

    const copyNodes = Array.from(chatRoot.querySelectorAll('div.copyable-text[data-pre-plain-text]'));
    const modernMessageNodes = Array.from(chatRoot.querySelectorAll('[data-testid^="conv-msg-"]'));
    const mediaOnlyNodes = Array.from(chatRoot.querySelectorAll('[data-id], [data-testid^="conv-msg-"]')).filter((el) => {
      if (el.querySelector('div.copyable-text[data-pre-plain-text]')) return false;
      const text = el.innerText || el.textContent || '';
      return !!el.querySelector('img, video, audio') || hasVoiceNote(el, text) || hasCallLog(el, text);
    });
    const callLogNodes = Array.from(chatRoot.querySelectorAll('div, span, [role="button"], [aria-label], [title], [data-icon], [data-testid]'))
      .map(callLogContainerFor)
      .filter(Boolean)
      .filter((el, idx, arr) => arr.indexOf(el) === idx)
      .filter((el) => hasCallLog(el, el.innerText || el.textContent || ''));
    const nodes = [...copyNodes, ...modernMessageNodes, ...mediaOnlyNodes, ...callLogNodes]
      .map(canonicalMessageRootForNode)
      .filter((el, idx, arr) => arr.indexOf(el) === idx)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const snapshots = [];
    let lastInboundChatKey = '';
    let lastInboundContactName = '';
    nodes.forEach((node) => {
        const copyNode = node.matches('div.copyable-text[data-pre-plain-text]')
          ? node
          : node.querySelector('div.copyable-text[data-pre-plain-text]');
        const pre = copyNode?.getAttribute('data-pre-plain-text') || '';
        const renderedText = (node.innerText || node.textContent || '').trim();
        const timestampLabel = (pre.match(/^\[(.*?)\]/) || [])[1]
          || (renderedText.match(/(?:^|\n)(\d{1,2}:\d{2}\s*(?:AM|PM)?)(?:\n|$)/i) || [])[1]
          || '';
        const senderLabel = pre
          .replace(/^\[[^\]]+\]\s*/, '')
          .replace(/:\s*$/, '')
          .trim();
        const messageId = messageIdForNode(node);
        const dataIdDirection = directionFromDataId(messageId);
        const direction = directionForNode(node, senderLabel) || dataIdDirection;
        const rawText = renderedText;
        const mediaFingerprint = [
          nodes.indexOf(node),
          ...Array.from(node.querySelectorAll('img, video, a')).map((el) => (
            el.getAttribute('src')
            || el.getAttribute('href')
            || el.getAttribute('alt')
            || el.getAttribute('aria-label')
            || ''
          ))
        ].filter(Boolean).join('|').slice(0, 500);
        const nonEmojiImages = Array.from(node.querySelectorAll('img')).filter((img) => {
          const src = img.getAttribute('src') || '';
          const alt = img.getAttribute('alt') || '';
          return !src.startsWith('data:image/gif') && !img.className.includes('emoji') && !alt.match(/^\p{Emoji}+$/u);
        });
        const highResolutionImages = nonEmojiImages.filter((img) => img.naturalWidth >= 160 && img.naturalHeight >= 120);
        const hasNonEmojiImage = highResolutionImages.length > 0 || nonEmojiImages.length > 0;
        const extraImageMatch = rawText.match(/\+(\d+)/);
        const mediaCount = hasNonEmojiImage
          ? Math.max(1, highResolutionImages.length, extraImageMatch ? Number(extraImageMatch[1]) + 2 : 1)
          : 0;
        const sharedLocation = extractSharedLocation(node);
        const voiceNote = hasVoiceNote(node, rawText);
        const callLog = hasCallLog(node, rawText);
        const mediaType = sharedLocation
          ? 'location'
          : hasNonEmojiImage && isTimestampOnlyText(rawText) && !!sharedLocation
            ? 'location_preview'
          : callLog
          ? 'call'
          : voiceNote
          ? 'voice'
          : node.querySelector('video')
            ? 'media'
            : node.querySelector('img')
              ? 'image'
              : 'text';
        const cleanText = cleanRenderedMessageText(rawText, mediaType);
        const text = cleanText || (mediaType === 'image'
          ? '[image]'
          : mediaType === 'call'
            ? '[missed call]'
          : mediaType === 'voice'
            ? '[voice note]'
            : mediaType === 'media'
              ? '[media]'
              : '');
        const senderDigits = phoneLike(senderLabel);
        const headerDigits = phoneLike(headerTitle);
        const dataIdDigits = phoneFromMessageDataId(messageId);
        const resolvedChatKey = senderDigits || headerDigits || dataIdDigits || lastInboundChatKey || headerTitle || senderLabel;
        const contactName = senderDigits || dataIdDigits
          ? headerTitle
          : (headerDigits ? senderLabel : (lastInboundContactName || headerTitle || senderLabel));
        const inferredDirection = senderDigits ? 'in' : direction;
        if ((senderDigits || dataIdDigits) && inferredDirection === 'in') {
          lastInboundChatKey = senderDigits || dataIdDigits;
          lastInboundContactName = senderLabel;
        }
        snapshots.push({
          chatKey: resolvedChatKey,
          contactName,
          text,
          timestampLabel,
          messageId,
          direction: inferredDirection,
          mediaType,
          mediaUrl: mediaType === 'text' ? '' : `whatsapp-web://${messageId || crypto.randomUUID()}`,
          sharedLocation,
          mediaCount,
          mediaFingerprint
        });
      });
    return snapshots
      .slice(-Math.max(1, maxItems))
      .filter((item) => item.chatKey && item.text && (
        item.mediaType === 'call'
        || item.mediaType === 'call_log'
        || item.direction === 'in'
        || (item.direction === 'unknown' && item.mediaType && item.mediaType !== 'text')
      ));
  }, limit);
}

async function hydrateVoiceSnapshot(page, snapshot) {
  if (!snapshot || snapshot.mediaType !== 'voice' || snapshot.voiceAudioDataUrl) return snapshot;
  const messageId = String(snapshot.messageId || '').trim();
  if (!messageId) return snapshot;

  try {
    const audio = await page.evaluate(async (targetMessageId) => {
      const nodes = Array.from(document.querySelectorAll('[data-id], [data-testid^="conv-msg-"]'));
      const root = nodes.find((el) => (
        el.getAttribute('data-id') === targetMessageId
        || el.getAttribute('data-testid') === targetMessageId
      ));
      if (!root) return null;
      let audioEl = root.querySelector('audio');
      let sourceEl = root.querySelector('audio source, source[type^="audio/"]');
      let src = audioEl?.currentSrc || audioEl?.src || sourceEl?.src || '';
      if (!src) {
        const playButton = root.querySelector([
          'button[aria-label*="Play" i]',
          '[role="button"][aria-label*="Play" i]',
          'button[aria-label*="voice" i]',
          '[role="button"][aria-label*="voice" i]'
        ].join(','));
        if (playButton) {
          playButton.click();
          await new Promise((resolve) => setTimeout(resolve, 650));
          audioEl = root.querySelector('audio');
          sourceEl = root.querySelector('audio source, source[type^="audio/"]');
          src = audioEl?.currentSrc || audioEl?.src || sourceEl?.src || '';
          if (audioEl && typeof audioEl.pause === 'function') audioEl.pause();
        }
      }
      if (!src) return null;

      const response = await fetch(src);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.size || blob.size > VOICE_AUDIO_MAX_BYTES) {
        return { skipped: true, reason: `audio_size_${blob.size || 0}` };
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('file_reader_failed'));
        reader.readAsDataURL(blob);
      });

      return {
        dataUrl,
        mimeType: blob.type || audioEl?.type || 'audio/ogg',
        bytes: blob.size
      };
    }, messageId);

    if (audio?.dataUrl) {
      return {
        ...snapshot,
        voiceAudioDataUrl: audio.dataUrl,
        voiceAudioMimeType: audio.mimeType || 'audio/ogg',
        voiceAudioBytes: audio.bytes || 0
      };
    }
    if (audio?.skipped) {
      log(`voice audio DOM fetch skipped for ${normalizeChatKey(snapshot.chatKey)}: ${audio.reason || 'audio_unavailable'}`);
      return {
        ...snapshot,
        voiceAudioSkipped: audio.reason || 'audio_unavailable'
      };
    }

    const capturedAudio = await captureVoiceAudioFromNetwork(page, messageId);
    if (capturedAudio?.dataUrl) {
      log(`captured WhatsApp voice audio for ${normalizeChatKey(snapshot.chatKey)} (${capturedAudio.bytes || 0} bytes)`);
      return {
        ...snapshot,
        voiceAudioDataUrl: capturedAudio.dataUrl,
        voiceAudioMimeType: capturedAudio.mimeType || 'audio/ogg',
        voiceAudioBytes: capturedAudio.bytes || 0
      };
    }
    if (capturedAudio?.skipped) {
      log(`voice audio capture skipped for ${normalizeChatKey(snapshot.chatKey)}: ${capturedAudio.reason || 'audio_unavailable'}`);
      return {
        ...snapshot,
        voiceAudioSkipped: capturedAudio.reason || 'audio_unavailable'
      };
    }
  } catch (error) {
    return {
      ...snapshot,
      voiceAudioError: error.message || String(error)
    };
  }

  return snapshot;
}

async function hydrateImageSnapshot(page, snapshot) {
  if (!snapshot || snapshot.mediaType !== 'image' || snapshot.imagePreviews?.length) return snapshot;
  const messageId = String(snapshot.messageId || '').trim();
  if (!messageId) return snapshot;

  try {
    const previews = await page.evaluate(async ({
      targetMessageId,
      maxDimension,
      quality,
      maxBytes
    }) => {
      const nodes = Array.from(document.querySelectorAll('[data-id], [data-testid^="conv-msg-"]'));
      const root = nodes.find((el) => (
        el.getAttribute('data-id') === targetMessageId
        || el.getAttribute('data-testid') === targetMessageId
      ));
      if (!root) return [];

      const imageCandidates = Array.from(root.querySelectorAll('img')).filter((img) => {
        const rect = img.getBoundingClientRect();
        const className = String(img.className || '').toLowerCase();
        const alt = String(img.alt || '').toLowerCase();
        if (className.includes('emoji') || alt.includes('emoji') || alt.includes('avatar')) return false;
        return img.naturalWidth >= 160 && img.naturalHeight >= 120
          && rect.width >= 24 && rect.height >= 24;
      });
      const uniqueImageCandidates = Array.from(new Map(imageCandidates.map((img) => {
        const key = img.currentSrc || img.src || `${img.naturalWidth}x${img.naturalHeight}:${img.alt || ''}`;
        return [key, img];
      })).values());
      const visibleImages = uniqueImageCandidates.slice(0, 5);

      const encodeImage = async (sourceImage) => {
        if (!sourceImage.complete) {
          await new Promise((resolve) => {
            const finish = () => resolve();
            sourceImage.addEventListener('load', finish, { once: true });
            sourceImage.addEventListener('error', finish, { once: true });
            setTimeout(finish, 1200);
          });
        }

        const sourceWidth = sourceImage.naturalWidth || Math.round(sourceImage.getBoundingClientRect().width);
        const sourceHeight = sourceImage.naturalHeight || Math.round(sourceImage.getBoundingClientRect().height);
        if (!sourceWidth || !sourceHeight) return null;
        const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return null;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(sourceImage, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const bytes = Math.floor((dataUrl.length * 3) / 4);
        if (!dataUrl || bytes > maxBytes) return null;

        const hashCanvas = document.createElement('canvas');
        hashCanvas.width = 9;
        hashCanvas.height = 8;
        const hashContext = hashCanvas.getContext('2d', { willReadFrequently: true });
        if (!hashContext) return { dataUrl, mimeType: 'image/jpeg', bytes, perceptualHash: '' };
        hashContext.drawImage(sourceImage, 0, 0, 9, 8);
        const pixels = hashContext.getImageData(0, 0, 9, 8).data;
        let bits = '';
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x < 8; x += 1) {
            const left = (y * 9 + x) * 4;
            const right = left + 4;
            const leftGray = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
            const rightGray = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
            bits += leftGray > rightGray ? '1' : '0';
          }
        }
        let perceptualHash = '';
        for (let index = 0; index < bits.length; index += 4) {
          perceptualHash += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
        }
        return { dataUrl, mimeType: 'image/jpeg', bytes, perceptualHash };
      };

      const results = [];
      for (const img of visibleImages) {
        try {
          const encoded = await encodeImage(img);
          if (encoded?.dataUrl) results.push(encoded);
        } catch (_error) {
          // A tainted or unavailable thumbnail is skipped and fails closed server-side.
        }
      }
      return results;
    }, {
      targetMessageId: messageId,
      maxDimension: LISTING_IMAGE_PREVIEW_MAX_DIMENSION,
      quality: LISTING_IMAGE_PREVIEW_QUALITY,
      maxBytes: LISTING_IMAGE_PREVIEW_MAX_BYTES
    });

    if (Array.isArray(previews) && previews.length) {
      const imagePreviews = previews.map((item) => ({
        dataUrl: item.dataUrl,
        mimeType: item.mimeType || 'image/jpeg',
        bytes: Number(item.bytes || 0),
        sha256: crypto.createHash('sha256').update(String(item.dataUrl || '')).digest('hex'),
        perceptualHash: String(item.perceptualHash || '').toLowerCase()
      }));
      return {
        ...snapshot,
        imagePreviews,
        mediaCount: imagePreviews.length
      };
    }
    return { ...snapshot, imagePreviewError: 'image_preview_unavailable' };
  } catch (error) {
    return {
      ...snapshot,
      imagePreviewError: error.message || String(error)
    };
  }
}

async function hydrateMediaSnapshot(page, snapshot) {
  const voiceHydrated = await hydrateVoiceSnapshot(page, snapshot);
  return hydrateImageSnapshot(page, voiceHydrated);
}

function isLikelyVoiceAudioResponse(response) {
  const headers = response.headers();
  const contentType = String(headers['content-type'] || '').toLowerCase();
  const url = String(response.url() || '').toLowerCase();
  if (contentType.startsWith('audio/')) return true;
  if (/\b(ogg|opus|webm)\b/.test(contentType)) return true;

  const isWhatsAppMediaUrl = /(?:mmg\.whatsapp\.net|media|ptt|voice|audio)/i.test(url);
  const isBinary = contentType.includes('application/octet-stream') || contentType.includes('binary/octet-stream');
  return isWhatsAppMediaUrl && isBinary;
}

function audioMimeTypeFromResponse(response) {
  const contentType = String(response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType.startsWith('audio/')) return contentType;
  const url = String(response.url() || '').toLowerCase();
  if (contentType.includes('webm') || url.includes('webm')) return 'audio/webm';
  if (contentType.includes('mpeg') || url.includes('mp3')) return 'audio/mpeg';
  return 'audio/ogg';
}

async function clickVoicePlayButton(page, messageId) {
  return page.evaluate((targetMessageId) => {
    const nodes = Array.from(document.querySelectorAll('[data-id]'));
    const root = nodes.find((el) => el.getAttribute('data-id') === targetMessageId);
    if (!root) return false;
    const button = root.querySelector([
      'button[aria-label*="Play voice message" i]',
      '[role="button"][aria-label*="Play voice message" i]',
      'button[aria-label*="Play" i]',
      '[role="button"][aria-label*="Play" i]',
      'button[aria-label*="voice" i]',
      '[role="button"][aria-label*="voice" i]'
    ].join(','));
    if (!button) return false;
    button.click();
    return true;
  }, messageId);
}

async function pauseVoicePlayback(page, messageId) {
  await page.evaluate((targetMessageId) => {
    const nodes = Array.from(document.querySelectorAll('[data-id]'));
    const root = nodes.find((el) => el.getAttribute('data-id') === targetMessageId);
    const button = root?.querySelector([
      'button[aria-label*="Pause voice message" i]',
      '[role="button"][aria-label*="Pause voice message" i]',
      'button[aria-label*="Pause" i]',
      '[role="button"][aria-label*="Pause" i]'
    ].join(','));
    if (button) button.click();
  }, messageId).catch(() => {});
}

async function captureVoiceAudioFromNetwork(page, messageId) {
  const responsePromise = page.waitForResponse(
    (response) => response.ok() && isLikelyVoiceAudioResponse(response),
    { timeout: 5500 }
  ).catch(() => null);

  const clicked = await clickVoicePlayButton(page, messageId).catch(() => false);
  if (!clicked) return { skipped: true, reason: 'voice_play_button_not_found' };

  const response = await responsePromise;
  await pauseVoicePlayback(page, messageId);
  if (!response) return { skipped: true, reason: 'voice_audio_network_response_missing' };

  const buffer = await response.body().catch(() => null);
  if (!buffer?.length) return { skipped: true, reason: 'voice_audio_body_missing' };
  if (buffer.length > VOICE_AUDIO_MAX_BYTES) {
    return { skipped: true, reason: `audio_size_${buffer.length}` };
  }

  const mimeType = audioMimeTypeFromResponse(response);
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mimeType,
    bytes: buffer.length
  };
}

async function ingestCallSnapshot({ snapshot, row = {}, source = 'call_card', chatKey, text }) {
  const normalizedChatKey = normalizeChatKey(chatKey || snapshot.chatKey || row.title);
  const normalizedText = String(text || snapshot.text || row.preview || '[missed call]').trim() || '[missed call]';
  if (!normalizedChatKey) return { processed: 0, skipped: 'missing_chat_for_call' };

  const browserMessageKey = snapshot.browserMessageKey || browserMessageKeyFor(snapshot, row);
  if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) {
    return { processed: 0, duplicate: true };
  }
  rememberBrowserMessageKey(browserMessageKey);

  const callId = createMessageId(
    normalizedChatKey,
    normalizedText,
    snapshot.timestampLabel,
    'call',
    snapshot.messageId || snapshot.mediaFingerprint || ''
  );
  const isVideoCall = /\bvideo\s+call\b/i.test(normalizedText);
  const status = /\b(?:no answer|missed|unanswered|declined|rejected|not answered)\b/i.test(normalizedText)
    ? 'missed'
    : 'call_log';

  try {
    const result = await apiRequest('/api/whatsapp/web-bridge/call', {
      method: 'POST',
      body: {
        client_id: CLIENT_ID,
        operator_name: OPERATOR_NAME || null,
        phone: normalizedChatKey,
        contact_name: snapshot.contactName || row.title || '',
        call_id: callId,
        call_type: isVideoCall ? 'video' : 'voice',
        status,
        declined: false,
        metadata: {
          chat_title: snapshot.chatKey || row.title || '',
          raw_text: normalizedText,
          source,
          detected_from: 'whatsapp_call_log_card',
          media_fingerprint: snapshot.mediaFingerprint || '',
          message_id: snapshot.messageId || ''
        }
      }
    });
    if (!result.duplicate) {
      log(`ingested missed call card from ${normalizedChatKey}; queued_reply=${result.data?.queued_reply ? 'yes' : 'no'}`);
    }
    return {
      processed: result.duplicate ? 0 : 1,
      duplicate: !!result.duplicate,
      queuedReply: !!result.data?.queued_reply,
      chatKey: normalizedChatKey
    };
  } catch (error) {
    log('failed to ingest call card:', normalizedChatKey, error.message || error);
    return { processed: 0, error };
  }
}

async function ingestCallPreviewRow({ row = {}, source = 'chat_list_call_preview' } = {}) {
  if (!row?.callLog) return { processed: 0, skipped: 'row_not_call_log' };
  const preview = String(row.preview || 'Missed WhatsApp call').trim();
  const snapshot = {
    chatKey: row.title,
    contactName: row.title,
    text: preview || '[missed call]',
    timestampLabel: row.timestampLabel || '',
    messageId: '',
    direction: 'unknown',
    mediaType: 'call',
    mediaUrl: '',
    mediaFingerprint: [
      'chat-list-call-preview',
      row.index,
      row.title,
      preview,
      row.timestampLabel || ''
    ].join('|').slice(0, 500)
  };
  return ingestCallSnapshot({ snapshot, row, source, chatKey: row.title, text: snapshot.text });
}

async function ingestSnapshot({ snapshot, row = {}, source = 'unread_scan' }) {
  const chatKey = normalizeChatKey(snapshot.chatKey || row.title);
  const mediaType = snapshot.mediaType || 'text';
  const text = isTimestampOnly(snapshot.text) && String(mediaType).includes('location')
    ? '[shared location]'
    : String(snapshot.text || row.preview || '').trim();

  if (isIgnoredWhatsappSystemChat(chatKey)) {
    log(`ignored WhatsApp system chat during ${source}`);
    return { processed: 0, skipped: 'whatsapp_system_chat' };
  }

  if (mediaType === 'call' || mediaType === 'call_log') {
    return ingestCallSnapshot({ snapshot, row, source, chatKey, text });
  }

  if (!chatKey || (!text && !snapshot.mediaUrl)) return { processed: 0, skipped: 'missing_chat_or_content' };
  if (snapshot.direction === 'out') return { processed: 0, skipped: 'outgoing_message' };
  if (chatKey.replace(/\D/g, '').length >= 9) {
    activeInboundRecipientHint = chatKey;
  }
  if (source === 'active_chat' && mediaType !== 'text' && !snapshot.messageId && !snapshot.mediaFingerprint) {
    return { processed: 0, skipped: 'unstable_active_media_without_message_id' };
  }

  const browserMessageKey = snapshot.browserMessageKey || browserMessageKeyFor(snapshot, row);
  if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) {
    return { processed: 0, duplicate: true };
  }
  rememberBrowserMessageKey(browserMessageKey);

  const messageId = createMessageId(chatKey, text, snapshot.timestampLabel, mediaType, snapshot.messageId || snapshot.mediaFingerprint || '');

  try {
    const result = await apiRequest('/api/whatsapp/web-bridge/inbound', {
      method: 'POST',
      body: {
        client_id: CLIENT_ID,
        operator_name: OPERATOR_NAME || null,
        phone: chatKey,
        body: text,
        message_id: messageId,
        media_url: snapshot.mediaUrl || '',
        media_type: mediaType,
        media_count: snapshot.mediaCount || 0,
        shared_location: snapshot.sharedLocation || null,
        created_at: snapshot.timestampLabel || new Date().toISOString(),
        metadata: {
          chat_title: snapshot.chatKey || row.title,
          contact_name: snapshot.contactName || row.title || '',
          media_count: snapshot.mediaCount || 0,
          voice_audio_data_url: snapshot.voiceAudioDataUrl || '',
          voice_audio_mime_type: snapshot.voiceAudioMimeType || '',
          voice_audio_bytes: snapshot.voiceAudioBytes || 0,
          voice_audio_error: snapshot.voiceAudioError || snapshot.voiceAudioSkipped || '',
          image_previews: Array.isArray(snapshot.imagePreviews)
            ? snapshot.imagePreviews.map((item) => ({
              data_url: item.dataUrl || '',
              mime_type: item.mimeType || 'image/jpeg',
              bytes: Number(item.bytes || 0),
              sha256: item.sha256 || '',
              perceptual_hash: item.perceptualHash || ''
            }))
            : [],
          image_preview_error: snapshot.imagePreviewError || '',
          unread_preview: row.preview || '',
          source
        }
      }
    });
    if (!result.duplicate) {
      log(`ingested ${source} ${mediaType} message from ${chatKey}; queued_reply=${result.data?.queued_reply ? 'yes' : 'no'}`);
    }
    return {
      processed: result.duplicate ? 0 : 1,
      duplicate: !!result.duplicate,
      queuedReply: !!result.data?.queued_reply,
      chatKey
    };
  } catch (error) {
    log('failed to ingest chat:', chatKey, error.message || error);
    return { processed: 0, error };
  }
}

async function ingestUnreadChats(page) {
  const unreadRows = (await scanUnreadChats(page))
    .filter((row) => !isIgnoredWhatsappSystemChat(row.title));
  let processed = 0;

  for (const row of unreadRows) {
    if (row.callLog) {
      const result = await ingestCallPreviewRow({ row, source: 'unread_chat_call_preview' });
      processed += result.processed || 0;
      if (result.queuedReply) {
        await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
      }
      if (result.processed || result.duplicate) continue;
    }

    const opened = await openChatRow(page, row);
    if (!opened) continue;

    const snapshots = await getRecentIncomingSnapshots(page, 1);
    let handledRow = false;
    for (const snapshot of snapshots) {
      const browserMessageKey = browserMessageKeyFor(snapshot, row);
      if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) continue;
      const hydrated = await hydrateMediaSnapshot(page, {
        ...snapshot,
        browserMessageKey
      });
      const result = await ingestSnapshot({ snapshot: hydrated, row, source: 'unread_scan' });
      processed += result.processed || 0;
      handledRow = handledRow || !!(result.processed || result.duplicate || result.queuedReply);
      if (result.queuedReply) {
        await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
      }
    }
    if (!handledRow) {
      const fallback = unreadPreviewSnapshot(row);
      if (fallback) {
        const result = await ingestSnapshot({ snapshot: fallback, row, source: 'unread_preview_fallback' });
        processed += result.processed || 0;
        if (result.queuedReply) {
          await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
        }
      }
    }
  }

  return {
    unreadCount: unreadRows.length,
    processed
  };
}

async function ingestRecentChatsSweep(page, limit = RECENT_CHAT_SWEEP_LIMIT) {
  const rows = await scanChatRows(page, { unreadOnly: false, limit });
  let scanned = 0;
  let openedRows = 0;
  let processed = 0;
  const finish = (shortCircuit = false) => {
    if (processed) {
      log(`recent chat sweep processed ${processed} inbound message${processed === 1 ? '' : 's'}`);
    }
    return {
      scanned,
      processed,
      shortCircuit
    };
  };

  for (const row of rows) {
    scanned += 1;
    if (isIgnoredWhatsappSystemChat(row.title)) continue;
    const rowKey = recentChatRowKey(row);
    if (!row.unread && shouldSkipRecentChatRow(rowKey)) continue;

    if (row.callLog) {
      const result = await ingestCallPreviewRow({ row, source: 'recent_chat_call_preview' });
      processed += result.processed || 0;
      if (result.queuedReply) {
        await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
      }
      if (result.processed || result.queuedReply) {
        rememberRecentChatRow(rowKey);
        return finish(true);
      }
      if (result.duplicate || result.skipped) {
        rememberRecentChatRow(rowKey);
        continue;
      }
    }

    if (openedRows >= RECENT_CHAT_SWEEP_OPEN_LIMIT) break;
    const opened = await openChatRow(page, row);
    if (!opened) continue;
    openedRows += 1;

    const snapshots = await getRecentIncomingSnapshots(page, 1);
    let rowObserved = !snapshots.length;
    let handledRow = false;
    for (const snapshot of snapshots) {
      const browserMessageKey = browserMessageKeyFor(snapshot, row);
      if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) {
        rowObserved = true;
        continue;
      }
      const hydrated = await hydrateMediaSnapshot(page, {
        ...snapshot,
        browserMessageKey
      });
      const result = await ingestSnapshot({ snapshot: hydrated, row, source: 'recent_chat_sweep' });
      rowObserved = true;
      handledRow = handledRow || !!(result.processed || result.duplicate || result.queuedReply);
      processed += result.processed || 0;
      if (result.queuedReply) {
        await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
      }
      if (result.processed || result.queuedReply) {
        rememberRecentChatRow(rowKey);
        return finish(true);
      }
    }
    if (!handledRow && row.unread) {
      const fallback = unreadPreviewSnapshot(row, 'recent_unread_preview_fallback');
      if (fallback) {
        const result = await ingestSnapshot({ snapshot: fallback, row, source: 'recent_unread_preview_fallback' });
        rowObserved = true;
        processed += result.processed || 0;
        if (result.queuedReply) {
          await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
        }
        if (result.processed || result.queuedReply) {
          rememberRecentChatRow(rowKey);
          return finish(true);
        }
      }
    }
    if (rowObserved) {
      rememberRecentChatRow(rowKey);
    }
  }

  return finish(false);
}

async function ingestActiveChat(page) {
  const snapshots = await getRecentIncomingSnapshots(page, 1);
  let processed = 0;
  for (const snapshot of snapshots) {
    const row = { title: snapshot.chatKey, preview: '' };
    const browserMessageKey = browserMessageKeyFor(snapshot, row);
    if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) continue;
    const hydrated = await hydrateMediaSnapshot(page, {
      ...snapshot,
      browserMessageKey
    });
    const result = await ingestSnapshot({
      snapshot: hydrated,
      row,
      source: 'active_chat'
    });
    processed += result.processed || 0;
    if (result.queuedReply) {
      await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
    }
  }
  return processed;
}

async function findReplyComposer(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of COMPOSER_SELECTORS) {
      const locator = page.locator(selector).last();
      if (await locator.count()) {
        const visible = await locator.isVisible().catch(() => true);
        if (visible) return locator;
      }
    }
    await page.waitForTimeout(25);
  }
  return null;
}

async function hasInvalidWhatsappPhoneNotice(page) {
  return page.evaluate(() => /phone number shared via url is invalid|invalid phone number/i
    .test(document.body?.innerText || ''));
}

async function waitForReplyComposer(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasInvalidWhatsappPhoneNotice(page).catch(() => false)) {
      throw new Error('WhatsApp says this recipient phone number is invalid');
    }
    const composer = await findReplyComposer(page, 300);
    if (composer) return composer;
  }
  return null;
}

async function getOutgoingMessageState(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const chatRoot = document.querySelector('#main')
      || document.querySelector('[data-testid="conversation-panel-wrapper"]')
      || document.body;
    const isModernOutgoing = (node) => {
      const root = node.closest?.('[data-testid^="conv-msg-"]') || node;
      const container = root.querySelector?.('[data-testid="msg-container"]')
        || (root.matches?.('[data-testid="msg-container"]') ? root : null)
        || root;
      const panelRect = chatRoot.getBoundingClientRect();
      const rect = container?.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || panelRect.width <= 0) return false;
      return rect.left + rect.width / 2 >= panelRect.left + panelRect.width / 2;
    };
    const nodes = Array.from(chatRoot.querySelectorAll([
      '.message-out',
      '[data-id^="true_"]',
      '[data-testid^="conv-msg-"]',
      '[data-testid="msg-container"]',
      '[role="row"]'
    ].join(','))).filter((node) => {
      const messageNode = node.closest?.('[data-id]') || node;
      const dataId = String(messageNode.getAttribute?.('data-id') || node.getAttribute?.('data-id') || '');
      if (dataId.startsWith('true_')) return true;
      if (node.classList?.contains('message-out') || node.closest?.('.message-out')) return true;
      const aria = String(node.getAttribute?.('aria-label') || '');
      if (/^you[:\s]/i.test(aria)) return true;
      return isModernOutgoing(node);
    });
    const uniqueNodes = Array.from(new Set(nodes.map((node) => (
      node.closest?.('[data-testid^="conv-msg-"]')
      || node.closest?.('[data-id]')
      || node
    ))));
    const texts = uniqueNodes
      .map((node) => normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || ''))
      .filter(Boolean);
    const messageIds = uniqueNodes.map((node, index) => (
      node.getAttribute?.('data-id')
      || node.getAttribute?.('data-testid')
      || `outgoing-${index}-${normalize(node.innerText || node.textContent || '').slice(0, 80)}`
    ));
    return {
      count: uniqueNodes.length,
      lastText: texts[texts.length - 1] || '',
      recentTexts: texts.slice(-10),
      recentMessageIds: messageIds.slice(-10)
    };
  });
}

async function getReplyComposerText(page) {
  return page.evaluate((selectors) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      const match = matches[matches.length - 1];
      if (!match) continue;
      return {
        found: true,
        text: normalize(match.innerText || match.textContent || '')
      };
    }
    return { found: false, text: '' };
  }, COMPOSER_SELECTORS);
}

async function setComposerTextWithDom(page, text) {
  const result = await page.evaluate(({ selectors, message }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || 1) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8;
    };
    const candidates = [];
    for (const selector of selectors) {
      try {
        candidates.push(...Array.from(document.querySelectorAll(selector)).filter(isVisible));
      } catch (_error) {
        // Keep looking with the next selector.
      }
    }
    const target = candidates[candidates.length - 1];
    if (!target) return { ok: false, reason: 'composer_missing', text: '' };

    target.focus();
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (selection && range) {
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand?.('delete', false, null);
    document.execCommand?.('insertText', false, message);

    let current = normalize(target.innerText || target.textContent || '');
    if (!current.includes(normalize(message).slice(0, 120))) {
      target.textContent = message;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: message
      }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      current = normalize(target.innerText || target.textContent || '');
    }

    return {
      ok: !!current && current.includes(normalize(message).slice(0, 120)),
      reason: current ? null : 'text_not_inserted',
      text: current
    };
  }, { selectors: COMPOSER_SELECTORS, message: String(text || '') }).catch((error) => ({
    ok: false,
    reason: error.message || String(error),
    text: ''
  }));

  if (!result.ok) {
    log(`DOM composer fallback failed: ${result.reason || 'unknown'}`);
  }
  return !!result.ok;
}

async function clickWhatsAppSend(page) {
  const clicked = await page.evaluate((selectors) => {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      const match = matches[matches.length - 1];
      if (!match) continue;
      const target = match.closest('button,[role="button"]') || match;
      if (target && !target.disabled) {
        target.click();
        return true;
      }
    }
    return false;
  }, SEND_BUTTON_SELECTORS).catch(() => false);

  if (clicked) return true;

  await page.keyboard.press('Enter');
  return true;
}

async function waitForOutgoingReplyConfirmation(page, expectedText, beforeState = {}, timeoutMs = 1200) {
  const expected = normalizeReplyText(expectedText);
  const expectedPrefix = expected.slice(0, 120);
  const beforeCount = Number(beforeState.count || 0);
  const beforeLastText = normalizeReplyText(beforeState.lastText || '');
  const beforeMessageIds = new Set(Array.isArray(beforeState.recentMessageIds) ? beforeState.recentMessageIds : []);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await getOutgoingMessageState(page).catch(() => ({ count: 0, recentTexts: [] }));
    const recentTexts = Array.isArray(state.recentTexts)
      ? state.recentTexts.map((text) => normalizeReplyText(text)).filter(Boolean)
      : [];
    const hasNewMessageId = Array.isArray(state.recentMessageIds)
      && state.recentMessageIds.some((id) => id && !beforeMessageIds.has(id));
    const addedCount = Math.max(0, Number(state.count || 0) - beforeCount);
    const newTailTexts = addedCount > 0 ? recentTexts.slice(-Math.max(1, addedCount)) : [];
    const matchedNewText = expectedPrefix
      ? newTailTexts.some((text) => text.includes(expectedPrefix))
      : addedCount > 0;
    if (addedCount > 0 && (!expectedPrefix || matchedNewText)) {
      return true;
    }

    const lastText = normalizeReplyText(state.lastText || '');
    if (hasNewMessageId && (!expectedPrefix || (lastText && lastText.includes(expectedPrefix)))) {
      return true;
    }
    if (expectedPrefix && lastText && lastText !== beforeLastText && lastText.includes(expectedPrefix)) {
      return true;
    }

    await page.waitForTimeout(25);
  }

  return false;
}

async function waitForReplyComposerCleared(page, timeoutMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await getReplyComposerText(page).catch(() => ({ found: false, text: '' }));
    if (state.found && !normalizeReplyText(state.text || '')) return true;
    await page.waitForTimeout(25);
  }
  return false;
}

async function waitForPostSendConfirmation(page, text, beforeState, timeoutMs = 2200) {
  if (await waitForOutgoingReplyConfirmation(page, text, beforeState, timeoutMs)) {
    return true;
  }

  const composerCleared = await waitForReplyComposerCleared(page, SEND_COMPOSER_CLEAR_MS);
  if (!composerCleared) return false;

  // Composer-cleared alone is not enough: WhatsApp Web can clear the input
  // before the outgoing bubble appears. Wait briefly for the real outgoing
  // message, then optionally accept the cleared composer as a fast confirmation.
  if (await waitForOutgoingReplyConfirmation(page, text, beforeState, SEND_CONFIRM_AFTER_CLEAR_MS)) {
    return true;
  }

  if (TRUST_SEND_ON_COMPOSER_CLEAR) {
    log('outgoing bubble was not observed quickly; accepting cleared composer as sent');
    return true;
  }

  return false;
}

async function replaceComposerText(page, text, timeoutMs = 1200) {
  const composer = await findReplyComposer(page, timeoutMs);
  if (!composer) return setComposerTextWithDom(page, text);

  let focused = false;
  try {
    await composer.click({ timeout: Math.min(1500, Math.max(500, timeoutMs)) });
    focused = true;
  } catch (error) {
    log(`reply composer click failed; trying DOM composer fallback: ${error.message || error}`);
    if (await setComposerTextWithDom(page, text)) {
      await page.waitForTimeout(10);
      return true;
    }
    await composer.click({ timeout: 700, force: true }).then(() => {
      focused = true;
    }).catch(() => {});
  }

  try {
    await composer.fill(String(text || ''), { timeout: 1500 });
  } catch (_error) {
    if (!focused && await setComposerTextWithDom(page, text)) {
      await page.waitForTimeout(10);
      return true;
    }
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(String(text || ''), { delay: 1 });
  }
  await page.waitForTimeout(10);
  return true;
}

async function openChatForReply(page, recipient) {
  const chatKey = String(recipient || '').trim();
  const phoneDigits = chatKey.replace(/\D/g, '');
  const normalizedRecipient = normalizeChatKey(phoneDigits || chatKey);
  if (activeInboundRecipientHint && activeInboundRecipientHint === normalizedRecipient) {
    const composer = await waitForReplyComposer(page, 450);
    if (composer) return true;
  }
  const activeSnapshot = await getActiveChatSnapshot(page).catch(() => null);
  const activeKey = normalizeChatKey(activeSnapshot?.chatKey || '');
  if (activeKey && activeKey === normalizedRecipient) {
    return !!await waitForReplyComposer(page, 900);
  }
  if (phoneDigits.length >= 9 && activeKey === normalizedRecipient) {
    return !!await waitForReplyComposer(page, 900);
  }

  if (phoneDigits.length >= 9) {
    await page.goto(`https://web.whatsapp.com/send?phone=${encodeURIComponent(phoneDigits)}`, {
      waitUntil: 'domcontentloaded'
    });
    return !!await waitForReplyComposer(page, 8000);
  }

  const searchSelectors = [
    'div[role="textbox"][contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"][title*="Search"]',
    'div[aria-label*="Search"][contenteditable="true"]'
  ];

  for (const selector of searchSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(chatKey, { delay: 20 });
        await page.waitForTimeout(350);

        const exactTitle = page.locator(`span[title="${chatKey.replace(/"/g, '\\"')}"]`).first();
        if (await exactTitle.count()) {
          const clicked = await clickVisibleLocator(exactTitle, 1200);
          if (!clicked) continue;
          return !!await waitForReplyComposer(page, 7000);
        }

        const row = page.locator('[data-testid="cell-frame-container"], div[role="listitem"]').first();
        if (await row.count()) {
          const clicked = await clickVisibleLocator(row, 1200);
          if (!clicked) continue;
          return !!await waitForReplyComposer(page, 7000);
        }
      } catch (_error) {
        // continue to next selector
      }
    }
  }

  return false;
}

async function typeAndSendReply(page, text) {
  const beforeState = await getOutgoingMessageState(page).catch(() => ({ count: 0, recentTexts: [] }));
  if (!await replaceComposerText(page, text, 15000)) {
    throw new Error('Could not find the WhatsApp reply box');
  }

  await clickWhatsAppSend(page);
  const confirmed = await waitForPostSendConfirmation(page, text, beforeState, SEND_CONFIRM_MS);
  if (confirmed) return true;

  let composerState = await getReplyComposerText(page).catch(() => ({ found: false, text: '' }));
  const composerText = normalizeReplyText(composerState.text || '');
  if (composerState.found && !composerText) {
    if (TRUST_SEND_ON_COMPOSER_CLEAR) {
      log('send bubble was not observed after composer cleared; trusting composer-clear send confirmation by override');
      return true;
    }
    log('send bubble was not observed after composer cleared; refusing to mark reply as sent');
    throw new Error('WhatsApp send was not confirmed after composer cleared');
  }

  const expectedPrefix = normalizeReplyText(text).slice(0, 120);
  if (composerText && normalizeReplyText(composerText).includes(expectedPrefix)) {
    await page.keyboard.press('Enter');
    const confirmedAfterEnter = await waitForPostSendConfirmation(page, text, beforeState, SEND_RETRY_CONFIRM_MS);
    if (confirmedAfterEnter) return true;
  }

  composerState = await getReplyComposerText(page).catch(() => ({ found: false, text: '' }));
  if (composerState.found && !normalizeReplyText(composerState.text || '')) {
    if (TRUST_SEND_ON_COMPOSER_CLEAR) {
      log('send bubble was not observed after Enter; trusting composer-clear send confirmation by override');
      return true;
    }
    log('send bubble was not observed after Enter; refusing to mark reply as sent');
    throw new Error('WhatsApp send was not confirmed after Enter');
  }

  if (normalizeReplyText(composerState.text || '').includes(expectedPrefix)) {
    await clickWhatsAppSend(page);
    const confirmedAfterRetry = await waitForPostSendConfirmation(page, text, beforeState, SEND_RETRY_CONFIRM_MS);
    if (confirmedAfterRetry) return true;
  }

  throw new Error('WhatsApp send was not confirmed in the chat');
}

async function fetchOutboundPropertyImage(mediaUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(String(mediaUrl || ''), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
        'User-Agent': BROWSER_USER_AGENT
      }
    });
    if (!response.ok) throw new Error(`Property image returned HTTP ${response.status}`);
    const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) throw new Error(`Property media is not an image (${mimeType || 'unknown type'})`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > OUTBOUND_PROPERTY_IMAGE_MAX_BYTES) throw new Error('Property image is too large for WhatsApp');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > OUTBOUND_PROPERTY_IMAGE_MAX_BYTES) throw new Error('Property image is empty or too large');
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    return { buffer, mimeType, fileName: `makaug-property.${extension}` };
  } finally {
    clearTimeout(timer);
  }
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = matches.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      try {
        await candidate.click({ timeout: 2500 });
        return true;
      } catch (_error) {
        // Try the next visible selector.
      }
    }
  }
  return false;
}

async function findAttachedFileInput(page) {
  for (const selector of OUTBOUND_IMAGE_INPUT_SELECTORS) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    if (count) return matches.nth(count - 1);
  }
  return null;
}

async function setMediaCaption(page, caption) {
  for (const selector of MEDIA_CAPTION_SELECTORS) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = matches.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      await candidate.click({ timeout: 2500 });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
      await page.keyboard.insertText(String(caption || ''));
      return true;
    }
  }
  return false;
}

async function getMediaComposerState(page) {
  return page.evaluate(({ captionSelectors }) => {
    const isVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0
        && rect.width > 8
        && rect.height > 8;
    };
    const captionVisible = captionSelectors.some((selector) => (
      Array.from(document.querySelectorAll(selector)).some(isVisible)
    ));
    const discardDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => (
      isVisible(node)
      && /discard selection/i.test(`${node.getAttribute('aria-label') || ''} ${node.innerText || ''}`)
    ));
    return {
      captionVisible,
      discardDialogVisible: Boolean(discardDialog)
    };
  }, { captionSelectors: MEDIA_CAPTION_SELECTORS }).catch(() => ({
    captionVisible: false,
    discardDialogVisible: false
  }));
}

async function dismissPendingMediaSelection(page) {
  let state = await getMediaComposerState(page);
  if (!state.captionVisible && !state.discardDialogVisible) return true;

  if (state.captionVisible && !state.discardDialogVisible) {
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(150);
    state = await getMediaComposerState(page);
  }

  if (state.discardDialogVisible) {
    const dialog = page.getByRole('dialog', { name: /Discard selection/i }).last();
    const discardButton = dialog.getByRole('button', { name: /Discard|Yes/i }).last();
    if (await discardButton.count().catch(() => 0)) {
      await discardButton.click({ timeout: 2500 }).catch(() => null);
    } else {
      await page.keyboard.press('Enter').catch(() => null);
    }
    await page.waitForTimeout(200);
  }

  state = await getMediaComposerState(page);
  return !state.captionVisible && !state.discardDialogVisible;
}

async function waitForMediaSendConfirmation(page, caption, beforeState, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let composerGoneSamples = 0;
  while (Date.now() < deadline) {
    if (await waitForOutgoingReplyConfirmation(page, caption, beforeState, 250)) return true;
    const state = await getMediaComposerState(page);
    if (!state.captionVisible && !state.discardDialogVisible) {
      composerGoneSamples += 1;
      if (composerGoneSamples >= 3) {
        log('outgoing image bubble was not readable quickly; accepting closed media composer as sent');
        return true;
      }
    } else {
      composerGoneSamples = 0;
    }
    await page.waitForTimeout(100);
  }
  return false;
}

async function typeAndSendImageReply(page, mediaUrl, caption) {
  const media = await fetchOutboundPropertyImage(mediaUrl);
  const beforeState = await getOutgoingMessageState(page).catch(() => ({ count: 0, recentTexts: [] }));

  let fileInput = await findAttachedFileInput(page);
  if (!fileInput) {
    const opened = await clickFirstVisible(page, ATTACH_BUTTON_SELECTORS);
    if (!opened) throw new Error('Could not open the WhatsApp attachment picker');
    await page.waitForTimeout(200);
    fileInput = await findAttachedFileInput(page);
  }
  if (!fileInput) throw new Error('Could not find the WhatsApp image upload control');

  await fileInput.setInputFiles({
    name: media.fileName,
    mimeType: media.mimeType,
    buffer: media.buffer
  });

  const captionReady = await page.waitForFunction((selectors) => selectors.some((selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    return nodes.some((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
    });
  }), MEDIA_CAPTION_SELECTORS, { timeout: 10000 }).then(() => true).catch(() => false);
  if (!captionReady || !await setMediaCaption(page, caption)) {
    await page.keyboard.press('Escape').catch(() => null);
    throw new Error('Could not prepare the WhatsApp image caption');
  }

  if (!await clickFirstVisible(page, MEDIA_SEND_BUTTON_SELECTORS)) {
    throw new Error('Could not find the WhatsApp media send button');
  }
  const confirmed = await waitForMediaSendConfirmation(page, caption, beforeState, Math.max(10000, SEND_CONFIRM_MS));
  if (!confirmed) throw new Error('WhatsApp image send was not confirmed in the chat');
  return true;
}

async function processOutbox(page, { recipient = '', maxSends = OUTBOX_SENDS_PER_LOOP } = {}) {
  const sendLimit = Math.min(
    OUTBOX_CLAIM_LIMIT,
    Math.max(1, Number(maxSends || OUTBOX_SENDS_PER_LOOP))
  );
  const recipientQuery = recipient
    ? `&recipient=${encodeURIComponent(normalizeChatKey(recipient))}`
    : '';
  const response = await apiRequest(`/api/whatsapp/web-bridge/outbox?client_id=${encodeURIComponent(CLIENT_ID)}&limit=${encodeURIComponent(sendLimit)}${recipientQuery}`);
  const items = Array.isArray(response.data) ? response.data : [];
  const activeRecipient = normalizeChatKey(recipient || activeInboundRecipientHint || '');
  const orderedItems = items.sort((a, b) => {
    if (!activeRecipient) return 0;
    const aKey = normalizeChatKey(a.recipient || '');
    const bKey = normalizeChatKey(b.recipient || '');
    if (aKey === activeRecipient && bKey !== activeRecipient) return -1;
    if (bKey === activeRecipient && aKey !== activeRecipient) return 1;
    return 0;
  }).slice(0, sendLimit);

  let sent = 0;
  for (const item of orderedItems) {
    try {
      if (hasRecentlySentReply(item)) {
        log(`suppressed duplicate queued reply to ${item.recipient}`);
        await apiRequest(`/api/whatsapp/web-bridge/outbox/${encodeURIComponent(item.id)}/sent`, {
          method: 'POST',
          body: {
            client_id: CLIENT_ID,
            bridge_message_id: `webbridge-duplicate-suppressed:${Date.now()}:${item.id}`,
            duplicate_suppressed: true
          }
        });
        continue;
      }

      const opened = await openChatForReply(page, item.recipient);
      if (!opened) {
        throw new Error(`Could not open chat for ${item.recipient}`);
      }

      let mediaSent = false;
      if (item.media_type === 'image' && item.media_url) {
        try {
          await typeAndSendImageReply(page, item.media_url, item.caption || item.text);
          mediaSent = true;
        } catch (mediaError) {
          log(`property image unavailable for ${item.recipient}; sending the clean text card instead: ${mediaError.message || mediaError}`);
          const mediaComposerReset = await dismissPendingMediaSelection(page);
          if (!mediaComposerReset) {
            throw new Error(`Could not reset WhatsApp media composer after image failure: ${mediaError.message || mediaError}`);
          }
          await typeAndSendReply(page, item.text);
        }
      } else {
        await typeAndSendReply(page, item.text);
      }
      rememberRecentlySentReply(item);
      log(`sent queued reply to ${item.recipient}`);

      await apiRequest(`/api/whatsapp/web-bridge/outbox/${encodeURIComponent(item.id)}/sent`, {
        method: 'POST',
        body: {
          client_id: CLIENT_ID,
          bridge_message_id: `webbridge-out:${Date.now()}:${item.id}`,
          media_sent: mediaSent
        }
      });
      sent += 1;
    } catch (error) {
      await apiRequest(`/api/whatsapp/web-bridge/outbox/${encodeURIComponent(item.id)}/failed`, {
        method: 'POST',
        body: {
          client_id: CLIENT_ID,
          error: error.message || 'send_failed'
        }
      }).catch(() => {});
      log('failed to send queued reply:', item.recipient, error.message || error);
    }
  }

  return sent;
}

async function ensureWhatsappTab(page) {
  const needsWhatsapp = !page.url() || page.url() === 'about:blank' || !page.url().includes('web.whatsapp.com');
  if (!needsWhatsapp) return;

  try {
    await page.goto('https://web.whatsapp.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
  } catch (error) {
    const currentUrl = page.url();
    if (currentUrl.includes('web.whatsapp.com')) {
      log(`WhatsApp navigation is still loading; continuing with current tab (${error?.message || error}).`);
      return;
    }
    throw error;
  }
}

function scoreWhatsappReadyState(readyState = {}) {
  let score = 0;
  if (readyState.ready) score += 100;
  if (readyState.hasComposer) score += 20;
  if (readyState.hasChatList) score += 18;
  if (readyState.hasSearchBox) score += 10;
  if (readyState.hasLoggedInShell) score += 8;
  if (readyState.openElsewhere) score += 12;
  if (readyState.loginPrompt) score -= 25;
  if (readyState.databaseError) score -= 40;
  if (readyState.waitingForLogin) score -= 35;
  return score;
}

async function claimWhatsappUseHere(page) {
  try {
    const useHereButton = page.getByText('Use here', { exact: true }).first();
    const clicked = await clickVisibleLocator(useHereButton, 1200);
    if (clicked) {
      log('claimed WhatsApp Web session from another window with "Use here".');
      await page.waitForTimeout(2500);
      return true;
    }
  } catch (_error) {
    // Fall through to the DOM fallback. WhatsApp changes this markup often.
  }

  try {
    const clicked = await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const bodyText = normalize(document.body?.innerText || '').toLowerCase();
      const isUseHereScreen = bodyText.includes('whatsapp is open in another window')
        || bodyText.includes('use whatsapp in this window')
        || bodyText.includes('use here');
      if (!isUseHereScreen) return false;

      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && Number(style.opacity || 1) !== 0
          && rect.width > 10
          && rect.height > 10;
      };

      const candidates = Array.from(document.querySelectorAll('button, [role="button"], span, div'));
      const target = candidates.find((el) => normalize(el.textContent).toLowerCase() === 'use here' && isVisible(el));
      const clickable = target?.closest('button, [role="button"]') || target;
      if (!clickable) return false;
      clickable.click();
      return true;
    });
    if (clicked) {
      log('claimed WhatsApp Web session from another window with DOM fallback.');
      await page.waitForTimeout(2500);
      return true;
    }
  } catch (error) {
    log(`failed to claim WhatsApp Web "Use here" state: ${error?.message || error}`);
  }

  return false;
}

async function inspectWhatsappCandidate(page) {
  try {
    await ensureWhatsappTab(page);
    await page.waitForTimeout(250);
    let readyState = await detectWhatsappReady(page);
    if (readyState.openElsewhere && await claimWhatsappUseHere(page)) {
      readyState = await detectWhatsappReady(page);
    }
    return {
      page,
      url: page.url() || '',
      readyState,
      score: scoreWhatsappReadyState(readyState)
    };
  } catch (error) {
    return {
      page,
      url: '',
      readyState: {
        ready: false,
        waitingForLogin: false,
        inspectionError: String(error?.message || error || '').slice(0, 160)
      },
      score: -100
    };
  }
}

async function findBestWhatsappPage(context) {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  const whatsappPages = pages.filter((candidate) => {
    try {
      return candidate.url().includes('web.whatsapp.com');
    } catch (_error) {
      return false;
    }
  });

  const inspected = [];
  for (const candidate of whatsappPages) {
    inspected.push(await inspectWhatsappCandidate(candidate));
  }

  inspected.sort((a, b) => b.score - a.score);
  return {
    best: inspected[0] || null,
    inspected
  };
}

async function getUsableWhatsappPage(context) {
  const { best, inspected } = await findBestWhatsappPage(context);
  if (best?.page && best.score > -20) {
    if (inspected.length > 1) {
      log(`selected WhatsApp tab (${best.url || 'no_url'}) ${summarizeWhatsappReadyState(best.readyState)}`);
    }
    return best.page;
  }

  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  const page = pages.find((candidate) => {
    try {
      return !candidate.url().includes('web.whatsapp.com');
    } catch (_error) {
      return false;
    }
  }) || pages[0] || await context.newPage();
  await ensureWhatsappTab(page);
  return page;
}

async function recoverWhatsappPage(context, previousPage) {
  try {
    if (previousPage && !previousPage.isClosed()) {
      await ensureWhatsappTab(previousPage);
      await previousPage.waitForTimeout(250);
      const previousState = await detectWhatsappReady(previousPage);
      if (previousState.ready) return previousPage;
    }
  } catch (_error) {
    // The old page is not usable. Fall through and locate/open a fresh WhatsApp tab.
  }

  const page = await getUsableWhatsappPage(context);
  await page.waitForTimeout(500);
  return page;
}

async function main() {
  let browser = null;
  let context = null;
  let connectedOverCdp = false;

  if (CDP_URL) {
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      context = browser.contexts()[0];
      if (!context) {
        throw new Error(`No browser context available via CDP at ${CDP_URL}`);
      }
      connectedOverCdp = true;
    } catch (error) {
      log(`CDP endpoint unavailable at ${CDP_URL}; launching persistent WhatsApp Web profile instead.`);
      log(`CDP error: ${error?.message || error}`);
      browser = null;
      context = null;
    }
  }

  if (!context) {
    const executablePath = resolveChromeExecutablePath();
    if (!fs.existsSync(executablePath)) {
      throw new Error(`Chrome executable not found. Checked configured path and common Linux Chromium paths; configured path was ${CHROME_PATH}`);
    }
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    context = await launchPersistentContextWithProfileRetry(executablePath, {
      headless: HEADLESS_BROWSER,
      executablePath,
      userAgent: BROWSER_USER_AGENT,
      viewport: { width: 1440, height: 980 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
  }

  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        configurable: true,
        get: () => false
      });
    } catch (_error) {
      // Ignore browsers that do not allow redefining navigator.webdriver.
    }
  });

  let page = await getUsableWhatsappPage(context);

  log('WhatsApp Web copilot started.');
  log(`Base URL: ${BASE_URL}`);
  log(`Client ID: ${CLIENT_ID}`);
  log(`Poll interval: ${POLL_MS}ms; login poll: ${LOGIN_POLL_MS}ms; recent chat sweep: ${RECENT_CHAT_SWEEP_MS}ms; fast lane rows: ${RECENT_CHAT_FAST_LANE_LIMIT}; sweep open cap: ${RECENT_CHAT_SWEEP_OPEN_LIMIT}; row cache: ${RECENT_CHAT_ROW_CACHE_MS}ms; API retry attempts: ${API_RETRY_ATTEMPTS}`);
  if (connectedOverCdp) {
    log(`Connected over CDP: ${CDP_URL}`);
  } else {
    log(`Profile dir: ${PROFILE_DIR}`);
  }
  log('If WhatsApp asks for a QR scan, keep this window open and log in once.');

  let lastHeartbeat = 0;
  let lastBridgeState = '';
  let lastRecentSweep = 0;
  let lastTabReselect = 0;
  let consecutiveLoopErrors = 0;

  while (true) {
    try {
      let readyState = await detectWhatsappReady(page);
      if (readyState.openElsewhere && await claimWhatsappUseHere(page)) {
        readyState = await detectWhatsappReady(page);
        lastBridgeState = '';
      }
      const now = Date.now();
      const bridgeState = readyState.ready
        ? 'online'
        : readyState.waitingForLogin
          ? 'waiting_for_login'
          : 'starting';

      if (bridgeState !== lastBridgeState) {
        log(`bridge state -> ${bridgeState} (${page.url() || 'no_url'}) ${summarizeWhatsappReadyState(readyState)}`);
        lastBridgeState = bridgeState;
      }

      if (!readyState.ready) {
        if (now - lastTabReselect >= Math.max(5000, LOGIN_POLL_MS)) {
          lastTabReselect = now;
          const selectedPage = await getUsableWhatsappPage(context);
          if (selectedPage !== page) {
            page = selectedPage;
            readyState = await detectWhatsappReady(page);
            log(`reselected WhatsApp tab (${page.url() || 'no_url'}) ${summarizeWhatsappReadyState(readyState)}`);
            lastBridgeState = '';
            continue;
          }
        }

        if (now - lastHeartbeat >= HEARTBEAT_MS) {
          const phonePairing = readyState.waitingForLogin
            ? await startWhatsappPhonePairingIfConfigured(page)
            : { attempted: false };
          if (phonePairing.attempted) {
            readyState = await detectWhatsappReady(page);
          }
          const qrRefresh = readyState.waitingForLogin && !phonePairing.attempted
            ? await refreshWhatsappLoginQrIfNeeded(page)
            : { refreshed: false };
          if (qrRefresh.refreshed) {
            readyState = await detectWhatsappReady(page);
          }
          const loginScreenshotDataUrl = await captureLoginScreenshotDataUrl(page);
          await sendHeartbeat({
            status: readyState.databaseError
              ? 'browser_database_error'
              : readyState.openElsewhere
                ? 'open_elsewhere'
                : readyState.waitingForLogin
                  ? 'waiting_for_login'
                  : 'starting',
            current_url: page.url(),
            unread_count: 0,
            metadata: {
              ready_state: readyState,
              login_screenshot_data_url: loginScreenshotDataUrl || null,
              login_screenshot_captured_at: loginScreenshotDataUrl ? new Date().toISOString() : null,
              login_phone_pairing: phonePairing,
              login_qr_refresh: qrRefresh,
              note: readyState.databaseError
                ? 'WhatsApp Web is showing a browser database/storage error. Refresh WhatsApp Web or relink the bridge profile if it persists.'
                : readyState.openElsewhere
                  ? 'WhatsApp Web is open in another window; the bridge is trying to claim this session with Use here.'
                  : readyState.waitingForLogin
                    ? 'Waiting for WhatsApp Web login'
                    : 'Browser starting'
            }
          });
          lastHeartbeat = now;
        }
        await sleep(readyState.waitingForLogin ? LOGIN_POLL_MS : Math.max(750, POLL_MS));
        continue;
      }

      const sentAtLoopStart = await processOutbox(page, { maxSends: 4 });
      let processedCallEvents = 0;
      let sentAfterCall = 0;
      const callEvent = await detectAndDeclineIncomingCall(page);
      if (callEvent.detected) {
        const callKey = `${normalizeChatKey(callEvent.chatKey || callEvent.callerName || '')}:${callEvent.callType || 'voice'}:${normalizeReplyText(callEvent.rawText || callEvent.label || '').slice(0, 160)}`;
        if (rememberCallEventKey(callKey)) {
          log(`declined incoming WhatsApp ${callEvent.callType || 'voice'} call from ${callEvent.chatKey || callEvent.callerName || 'unknown caller'}`);
          const result = await apiRequest('/api/whatsapp/web-bridge/call', {
            method: 'POST',
            body: {
              client_id: CLIENT_ID,
              operator_name: OPERATOR_NAME || null,
              phone: callEvent.chatKey || callEvent.callerName || '',
              contact_name: callEvent.callerName || '',
              call_id: callEvent.eventId,
              call_type: callEvent.callType || 'voice',
              status: callEvent.declined ? 'declined' : 'missed',
              declined: !!callEvent.declined,
              current_url: page.url(),
              metadata: {
                raw_text: callEvent.rawText || '',
                button_label: callEvent.label || '',
                source: 'whatsapp_web_call_detector'
              }
            }
          });
          processedCallEvents = result.duplicate ? 0 : 1;
          if (result.data?.queued_reply && callEvent.chatKey) {
            sentAfterCall = await processOutbox(page, { recipient: callEvent.chatKey, maxSends: 1 });
          }
        }
      }

      const activeProcessed = await ingestActiveChat(page);
      const sentAfterActive = activeProcessed ? await processOutbox(page, { maxSends: 2 }) : 0;
      const unreadResult = activeProcessed
        ? { unreadCount: 0, processed: 0 }
        : await ingestUnreadChats(page);
      const sentAfterUnread = unreadResult.processed ? await processOutbox(page, { maxSends: 2 }) : 0;
      let recentSweepResult = { scanned: 0, processed: 0 };
      let sentAfterSweep = 0;
      const hadLiveActivity = !!(processedCallEvents || sentAfterCall || activeProcessed || sentAfterActive || unreadResult.processed || sentAfterUnread);
      if (!hadLiveActivity) {
        recentSweepResult = await ingestRecentChatsSweep(page, RECENT_CHAT_FAST_LANE_LIMIT);
        if (recentSweepResult.processed) {
          sentAfterSweep = await processOutbox(page, { maxSends: 2 });
        }
      }
      const hadFastLaneActivity = !!(recentSweepResult.processed || sentAfterSweep || recentSweepResult.shortCircuit);
      if (!hadLiveActivity && !hadFastLaneActivity && now - lastRecentSweep >= RECENT_CHAT_SWEEP_MS) {
        const widerRecentSweepResult = await ingestRecentChatsSweep(page);
        lastRecentSweep = Date.now();
        recentSweepResult = {
          scanned: (recentSweepResult.scanned || 0) + (widerRecentSweepResult.scanned || 0),
          processed: (recentSweepResult.processed || 0) + (widerRecentSweepResult.processed || 0),
          shortCircuit: !!widerRecentSweepResult.shortCircuit
        };
        if (widerRecentSweepResult.processed) {
          sentAfterSweep = await processOutbox(page, { maxSends: 2 });
        }
      }
      const sentAtLoopEnd = await processOutbox(page, { maxSends: 2 });
      const sentCount = sentAtLoopStart + sentAfterCall + sentAfterActive + sentAfterUnread + sentAfterSweep + sentAtLoopEnd;
      const activeSnapshot = await getActiveChatSnapshot(page);

      if (now - lastHeartbeat >= HEARTBEAT_MS) {
        await sendHeartbeat({
          status: 'online',
          current_url: page.url(),
          active_chat_key: normalizeChatKey(activeSnapshot.chatKey || ''),
          unread_count: unreadResult.unreadCount || 0,
          stats: {
            processed_call_events: processedCallEvents || 0,
            processed_unread: unreadResult.processed || 0,
            processed_active: activeProcessed || 0,
            processed_recent_sweep: recentSweepResult.processed || 0,
            scanned_recent_sweep: recentSweepResult.scanned || 0,
            sent_outbound: sentCount || 0
          },
          metadata: {
            ready_state: readyState,
            phase: 'online',
            note: 'Hosted WhatsApp browser connected',
            login_screenshot_data_url: null,
            login_screenshot_captured_at: null,
            login_phone_pairing: null,
            login_qr_refresh: null
          }
        });
        lastHeartbeat = now;
      }
      consecutiveLoopErrors = 0;
    } catch (error) {
      consecutiveLoopErrors += 1;
      log('bridge loop error:', error.message || error);
      await sendHeartbeat({
        status: 'degraded',
        current_url: '',
        last_error: error.message || String(error),
        metadata: {
          phase: 'main_loop',
          consecutive_loop_errors: consecutiveLoopErrors
        }
      });
      if (isClosedBrowserError(error) && consecutiveLoopErrors < MAX_CONSECUTIVE_LOOP_ERRORS) {
        try {
          page = await recoverWhatsappPage(context, page);
          log(`recovered WhatsApp tab after closed-page error (${page.url() || 'no_url'})`);
          consecutiveLoopErrors = 0;
          lastBridgeState = '';
          await sleep(600);
          continue;
        } catch (recoveryError) {
          log('WhatsApp tab recovery failed:', recoveryError.message || recoveryError);
        }
      }
      if (consecutiveLoopErrors >= MAX_CONSECUTIVE_LOOP_ERRORS || isClosedBrowserError(error)) {
        log(`bridge loop is not recoverable in-process; exiting so whatsapp-web-agent can restart it (${consecutiveLoopErrors} consecutive error${consecutiveLoopErrors === 1 ? '' : 's'}).`);
        process.exit(1);
      }
    }

    await sleep(POLL_MS);
  }
}

main().catch(async (error) => {
  log('fatal error:', error.message || error);
  await sendHeartbeat({
    status: 'error',
    current_url: '',
    last_error: error.message || String(error)
  });
  process.exit(1);
});
