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
const { isOwnWhatsappMessage } = requireWithReadRetry('../services/whatsappWebDirectionService');
const { whatsappCallCardBrowserConfig } = requireWithReadRetry('../services/whatsappCallCardDetectionService');

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
const configuredPollMs = Number(process.env.WHATSAPP_WEB_COPILOT_POLL_MS || 500);
// WhatsApp DOM scans and API outbox claims are expensive. The previous 50ms
// loop ran about 20 full scans per second and exhausted a 2 GB worker several
// times per day. Sub-second polling is still responsive without busy-spinning.
const POLL_MS = Math.min(5000, Math.max(400, Number.isFinite(configuredPollMs) ? configuredPollMs : 500));
const configuredLoginPollMs = Number(process.env.WHATSAPP_WEB_COPILOT_LOGIN_POLL_MS || 2500);
const LOGIN_POLL_MS = Math.min(
  10000,
  Math.max(1000, Number.isFinite(configuredLoginPollMs) ? configuredLoginPollMs : 2500)
);
const HEARTBEAT_MS = Math.max(10000, Number(process.env.WHATSAPP_WEB_COPILOT_HEARTBEAT_MS || 30000));
const AI_RUNTIME_BASE_URL = String(process.env.WHATSAPP_AI_RUNTIME_URL || '').trim().replace(/\/+$/, '');
const AI_RUNTIME_TOKEN = String(process.env.WHATSAPP_AI_RUNTIME_TOKEN || '').trim();
const configuredMaxSessionMs = Number(process.env.WHATSAPP_WEB_COPILOT_MAX_SESSION_MS || (4 * 60 * 60 * 1000));
const MAX_SESSION_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(30 * 60 * 1000, Number.isFinite(configuredMaxSessionMs) ? configuredMaxSessionMs : (4 * 60 * 60 * 1000))
);
const configuredMemoryRecycleMb = Number(process.env.WHATSAPP_WEB_COPILOT_MEMORY_RECYCLE_MB || 1800);
const MEMORY_RECYCLE_BYTES = Math.min(
  8 * 1024 * 1024 * 1024,
  Math.max(512 * 1024 * 1024, (Number.isFinite(configuredMemoryRecycleMb) ? configuredMemoryRecycleMb : 1800) * 1024 * 1024)
);
const configuredMemoryCheckMs = Number(process.env.WHATSAPP_WEB_COPILOT_MEMORY_CHECK_MS || 15000);
const MEMORY_CHECK_MS = Math.min(
  60000,
  Math.max(5000, Number.isFinite(configuredMemoryCheckMs) ? configuredMemoryCheckMs : 15000)
);
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
const configuredRecentSweepMs = Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_MS || 3000);
const RECENT_CHAT_SWEEP_MS = Math.min(30000, Math.max(1500, Number.isFinite(configuredRecentSweepMs) ? configuredRecentSweepMs : 3000));
const configuredFastLaneSweepMs = Number(process.env.WHATSAPP_WEB_COPILOT_FAST_LANE_SWEEP_MS || 650);
const FAST_LANE_SWEEP_MS = Math.min(5000, Math.max(500, Number.isFinite(configuredFastLaneSweepMs) ? configuredFastLaneSweepMs : 650));
const configuredOutboxPollMs = Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_POLL_MS || 750);
const OUTBOX_POLL_MS = Math.min(10000, Math.max(500, Number.isFinite(configuredOutboxPollMs) ? configuredOutboxPollMs : 750));
const RECENT_CHAT_SWEEP_LIMIT = Math.min(12, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_LIMIT || 8)));
const RECENT_CHAT_SWEEP_OPEN_LIMIT = Math.min(5, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_OPEN_LIMIT || 5)));
const RECENT_CHAT_FAST_LANE_LIMIT = Math.min(3, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_FAST_LANE_LIMIT || 3)));
const configuredRecentRowCacheMs = Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_ROW_CACHE_MS || 300000);
const RECENT_CHAT_ROW_CACHE_MS = Math.min(
  60 * 60 * 1000,
  Math.max(5000, Number.isFinite(configuredRecentRowCacheMs) ? configuredRecentRowCacheMs : 300000)
);
const RECENT_CHAT_ROW_CACHE_FILE = path.join(PROFILE_DIR, '.makaug-recent-chat-rows.json');
const OUTBOX_CLAIM_LIMIT = Math.min(25, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_CLAIM_LIMIT || 25)));
const OUTBOX_SENDS_PER_LOOP = Math.min(8, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_SENDS_PER_LOOP || 5)));
const API_RETRY_ATTEMPTS = Math.min(8, Math.max(3, Number(process.env.WHATSAPP_WEB_COPILOT_API_RETRY_ATTEMPTS || 5)));
const configuredSendConfirmMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_CONFIRM_MS || 250);
const SEND_CONFIRM_MS = Math.min(2000, Math.max(250, Number.isFinite(configuredSendConfirmMs) ? configuredSendConfirmMs : 250));
const configuredComposerClearMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_COMPOSER_CLEAR_MS || 80);
const SEND_COMPOSER_CLEAR_MS = Math.min(1200, Math.max(80, Number.isFinite(configuredComposerClearMs) ? configuredComposerClearMs : 220));
const configuredSendConfirmAfterClearMs = Number(process.env.WHATSAPP_WEB_COPILOT_SEND_CONFIRM_AFTER_CLEAR_MS || 3000);
const SEND_CONFIRM_AFTER_CLEAR_MS = Math.min(
  5000,
  Math.max(250, Number.isFinite(configuredSendConfirmAfterClearMs) ? configuredSendConfirmAfterClearMs : 3000)
);
const configuredTrustedComposerClearGraceMs = Number(
  process.env.WHATSAPP_WEB_COPILOT_TRUSTED_CLEAR_GRACE_MS || 125
);
const TRUSTED_COMPOSER_CLEAR_GRACE_MS = Math.min(
  500,
  Math.max(75, Number.isFinite(configuredTrustedComposerClearGraceMs) ? configuredTrustedComposerClearGraceMs : 125)
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
const EMPLOYEE_VIDEO_PREVIEW_MAX_BYTES = 25_000_000;
const OUTBOUND_PROPERTY_IMAGE_MAX_BYTES = 15_000_000;
const WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER = 'whatsapp-video-still-dual-media-20260831';
const WHATSAPP_CALL_CARD_BROWSER_CONFIG = Object.freeze(whatsappCallCardBrowserConfig());
const RECENT_INBOUND_BACKLOG_LIMIT = 60;
const EMPLOYEE_BATCH_HISTORY_SCAN_LIMIT = 160;
const EMPLOYEE_BATCH_HISTORY_MAX_ROUNDS = 30;
const EMPLOYEE_BATCH_RECOVERY_RETRY_MS = 20_000;
const EMPLOYEE_BATCH_RECOVERY_MAX_ATTEMPTS = 8;
const EMPLOYEE_VIDEO_RECOVERY_MAX_ATTEMPTS = 8;
const configuredEmployeeBatchRecoveryIdleMs = Number(
  process.env.WHATSAPP_WEB_COPILOT_EMPLOYEE_RECOVERY_IDLE_MS || 60_000
);
const EMPLOYEE_BATCH_RECOVERY_IDLE_MS = Math.min(
  10 * 60_000,
  Math.max(30_000, Number.isFinite(configuredEmployeeBatchRecoveryIdleMs) ? configuredEmployeeBatchRecoveryIdleMs : 60_000)
);
const EMPLOYEE_BATCH_RECOVERY_PHONES = String(
  process.env.WHATSAPP_WEB_COPILOT_EMPLOYEE_RECOVERY_PHONES || ''
).split(/[;,\s]+/).map((value) => normalizeChatKey(value)).filter(Boolean);
const seenBrowserMessageIds = new Set();
const completedEmployeeBatchHistoryKeys = new Set();
const employeeBatchReplayProgress = new Map();
const seenCallEventKeys = new Map();
const recentlySentReplyKeys = new Map();
const recentChatRowKeys = new Map();
let recentChatRowCacheWriteTimer = null;
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
const PHOTO_VIDEO_MENU_SELECTORS = [
  'button[role="menuitem"][aria-label*="Photos"]',
  'button[role="menuitem"][aria-label*="videos"]',
  '[role="menuitem"][aria-label*="Photos"]',
  '[role="menuitem"][aria-label*="videos"]',
  '[role="menuitem"]:has-text("Photos & videos")',
  'button:has-text("Photos & videos")'
];
const MEDIA_CAPTION_SELECTORS = [
  '[data-testid="media-caption-input-container"] [contenteditable="true"]',
  '[data-testid*="caption" i] [contenteditable="true"]',
  '[role="dialog"] div[role="textbox"][contenteditable="true"]',
  '[role="dialog"] [data-lexical-editor="true"][contenteditable="true"]',
  'div[aria-placeholder*="caption" i][contenteditable="true"]',
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

function isResolvableWhatsappCallChatKey(value) {
  return String(value || '').replace(/\D/g, '').length >= 9;
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

function readContainerMemoryBytes() {
  const candidates = [
    '/sys/fs/cgroup/memory.current',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes'
  ];
  for (const filePath of candidates) {
    try {
      const value = Number(String(fs.readFileSync(filePath, 'utf8') || '').trim());
      if (Number.isFinite(value) && value > 0) return value;
    } catch (_error) {
      // Local macOS workers do not expose Linux cgroup memory files.
    }
  }
  return null;
}

function persistRecentChatRowCache() {
  recentChatRowCacheWriteTimer = null;
  try {
    fs.mkdirSync(path.dirname(RECENT_CHAT_ROW_CACHE_FILE), { recursive: true });
    const now = Date.now();
    pruneRecentChatRowKeys(now);
    const payload = JSON.stringify({
      saved_at: new Date(now).toISOString(),
      rows: Array.from(recentChatRowKeys.entries()).slice(-300)
    });
    const temporaryPath = `${RECENT_CHAT_ROW_CACHE_FILE}.tmp`;
    fs.writeFileSync(temporaryPath, payload, { mode: 0o600 });
    fs.renameSync(temporaryPath, RECENT_CHAT_ROW_CACHE_FILE);
  } catch (error) {
    log(`recent chat row cache write failed: ${error.message || error}`);
  }
}

function scheduleRecentChatRowCacheWrite() {
  if (recentChatRowCacheWriteTimer) return;
  recentChatRowCacheWriteTimer = setTimeout(persistRecentChatRowCache, 250);
  recentChatRowCacheWriteTimer.unref?.();
}

function loadRecentChatRowCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RECENT_CHAT_ROW_CACHE_FILE, 'utf8'));
    const now = Date.now();
    for (const entry of Array.isArray(parsed?.rows) ? parsed.rows : []) {
      const [rowKey, seenAt] = Array.isArray(entry) ? entry : [];
      const timestamp = Number(seenAt);
      if (!rowKey || !Number.isFinite(timestamp) || now - timestamp >= RECENT_CHAT_ROW_CACHE_MS) continue;
      recentChatRowKeys.set(String(rowKey).slice(0, 500), timestamp);
    }
    pruneRecentChatRowKeys(now);
    if (recentChatRowKeys.size) log(`restored ${recentChatRowKeys.size} recent chat row fingerprints from the persistent profile`);
  } catch (error) {
    if (error?.code !== 'ENOENT') log(`recent chat row cache read failed: ${error.message || error}`);
  }
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
  scheduleRecentChatRowCacheWrite();
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
    release_marker: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER,
    git_commit: process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || process.env.GIT_COMMIT || '',
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
  const normalizedExtra = extra && typeof extra === 'object' ? extra : {};
  try {
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

  if (AI_RUNTIME_BASE_URL && AI_RUNTIME_TOKEN) {
    try {
      const response = await fetch(`${AI_RUNTIME_BASE_URL}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_RUNTIME_TOKEN}`
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          status: normalizedExtra.status || 'unknown',
          current_url: normalizedExtra.current_url || '',
          reported_at: new Date().toISOString()
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      log('isolated AI runtime heartbeat failed:', error.message || error);
    }
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
      return new RegExp(options.callDetection.textPatternSource, 'i').test(combined);
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
      // The row aria-label can contain WhatsApp's fixed "Voice call" action.
      // Only the actual preview is trusted as call-card text.
      const callLog = hasCallLogText(preview);
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
  }, { unreadOnly, limit, callDetection: WHATSAPP_CALL_CARD_BROWSER_CONFIG });
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
  return page.evaluate((callDetection) => {
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
    const hasOutgoingDeliveryReceipt = (root) => Boolean(root?.querySelector?.([
      '[aria-label*="Delivered" i]',
      '[aria-label*="Read" i]',
      '[aria-label*="Sent" i]',
      '[data-icon="msg-check"]',
      '[data-icon="msg-dblcheck"]'
    ].join(',')));
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
    const hasVideoMedia = (root) => {
      if (!root) return false;
      if (root.querySelector('video, source[type^="video/"], [data-testid*="video" i], [data-icon*="video" i], [aria-label*="video" i]')) return true;
      const highResolutionPoster = Array.from(root.querySelectorAll('img')).some((img) => (
        img.naturalWidth >= 160 && img.naturalHeight >= 120
      ));
      const playControl = root.querySelector('[aria-label="Play" i], [aria-label^="Play " i], [data-icon="play"]');
      return highResolutionPoster && Boolean(playControl);
    };
    const hasVoiceNote = (root, text = '') => {
      if (!root) return false;
      if (hasVideoMedia(root)) return false;
      if (root.querySelector('audio, source[type^="audio/"]')) return true;
      const voiceControl = root.querySelector([
        '[aria-label*="voice" i]',
        '[aria-label*="audio" i]',
        '[data-icon*="audio" i]',
        '[data-icon*="ptt" i]',
        '[data-testid*="audio" i]'
      ].join(','));
      if (voiceControl) return true;
      return /\b\d{1,2}:\d{2}\b/.test(String(text || '')) && !!root.querySelector('canvas');
    };
    const hasCallLog = (root, text = '') => {
      if (!root) return false;
      const authoredMessage = root.matches?.('div.copyable-text[data-pre-plain-text]')
        || !!root.querySelector?.('div.copyable-text[data-pre-plain-text]');
      if (authoredMessage || root.closest?.('.message-out')) return false;
      const dataId = root.closest?.('[data-id]')?.getAttribute('data-id') || root.getAttribute?.('data-id') || '';
      if (/^true_/.test(dataId)) return false;
      const markers = [
        root.getAttribute?.('aria-label'),
        root.getAttribute?.('data-icon'),
        root.getAttribute?.('data-testid'),
        root.getAttribute?.('title'),
        ...Array.from(root.querySelectorAll('[aria-label], [data-icon], [data-testid], [title]'))
        .flatMap((el) => [
          el.getAttribute('aria-label'),
          el.getAttribute('data-icon'),
          el.getAttribute('data-testid'),
          el.getAttribute('title')
        ].filter(Boolean))
      ].filter(Boolean);
      const callText = String(text || '').replace(/\s+/g, ' ').trim();
      const textMatch = new RegExp(callDetection.textPatternSource, 'i').test(callText);
      const markerPattern = new RegExp(callDetection.markerPatternSource, 'i');
      return textMatch || markers.some((marker) => markerPattern.test(String(marker || '').trim()));
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
      if (hasOutgoingDeliveryReceipt(root)) return 'out';
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
    const senderLabelFromMetadata = pre
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/:\s*$/, '')
      .trim();
    const renderedSenderLabel = String(renderedText || '').split(/\r?\n/, 1)[0].trim();
    const senderLabel = senderLabelFromMetadata
      || (isLikelyOutgoingSender(renderedSenderLabel) ? renderedSenderLabel : '');
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
    const documentMedia = Boolean(last.querySelector('a[download], [data-icon*="document" i], [data-testid*="document" i]'))
      || /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv)(?:\s|$)/i.test(text);
    const videoMedia = hasVideoMedia(last);
    const mediaType = sharedLocation
      ? 'location'
      : hasNonEmojiImage && isTimestampOnlyText(text) && !!sharedLocation
        ? 'location_preview'
      : callLog
        ? 'call'
      : documentMedia
        ? 'media'
      : videoMedia
        ? 'media'
      : voiceNote
        ? 'voice'
      : last.querySelector('img')
        ? 'image'
        : 'text';
    const cleanText = cleanRenderedMessageText(text, mediaType);

    return {
      chatKey: resolvedChatKey,
      contactName,
      text: cleanText || (mediaType === 'call' ? '[missed call]' : mediaType === 'image' ? '[image]' : mediaType === 'voice' ? '[voice note]' : mediaType === 'media' ? '[media]' : ''),
      timestampLabel,
      messageId,
      senderLabel,
      direction,
      mediaType,
      mediaUrl: mediaType === 'text' || mediaType === 'call' ? '' : `whatsapp-web://${messageId || crypto.randomUUID()}`,
      sharedLocation,
      mediaCount,
      mediaFingerprint
    };
  }, WHATSAPP_CALL_CARD_BROWSER_CONFIG);
}

async function getRecentIncomingSnapshots(page, limit = 20) {
  return page.evaluate((options) => {
    const maxItems = options.maxItems;
    const callDetection = options.callDetection;
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
    const hasOutgoingDeliveryReceipt = (root) => Boolean(root?.querySelector?.([
      '[aria-label*="Delivered" i]',
      '[aria-label*="Read" i]',
      '[aria-label*="Sent" i]',
      '[data-icon="msg-check"]',
      '[data-icon="msg-dblcheck"]'
    ].join(',')));
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
    const hasVideoMedia = (root) => {
      if (!root) return false;
      if (root.querySelector('video, source[type^="video/"], [data-testid*="video" i], [data-icon*="video" i], [aria-label*="video" i]')) return true;
      const highResolutionPoster = Array.from(root.querySelectorAll('img')).some((img) => (
        img.naturalWidth >= 160 && img.naturalHeight >= 120
      ));
      const playControl = root.querySelector('[aria-label="Play" i], [aria-label^="Play " i], [data-icon="play"]');
      return highResolutionPoster && Boolean(playControl);
    };
    const hasVoiceNote = (root, text = '') => {
      if (!root) return false;
      if (hasVideoMedia(root)) return false;
      if (root.querySelector('audio, source[type^="audio/"]')) return true;
      const voiceControl = root.querySelector([
        '[aria-label*="voice" i]',
        '[aria-label*="audio" i]',
        '[data-icon*="audio" i]',
        '[data-icon*="ptt" i]',
        '[data-testid*="audio" i]'
      ].join(','));
      if (voiceControl) return true;
      return /\b\d{1,2}:\d{2}\b/.test(String(text || '')) && !!root.querySelector('canvas');
    };
    const hasCallLog = (root, text = '') => {
      if (!root) return false;
      const authoredMessage = root.matches?.('div.copyable-text[data-pre-plain-text]')
        || !!root.querySelector?.('div.copyable-text[data-pre-plain-text]');
      if (authoredMessage || root.closest?.('.message-out')) return false;
      const dataId = root.closest?.('[data-id]')?.getAttribute('data-id') || root.getAttribute?.('data-id') || '';
      if (/^true_/.test(dataId)) return false;
      const markers = [
        root.getAttribute?.('aria-label'),
        root.getAttribute?.('data-icon'),
        root.getAttribute?.('data-testid'),
        root.getAttribute?.('title'),
        ...Array.from(root.querySelectorAll('[aria-label], [data-icon], [data-testid], [title]'))
        .flatMap((el) => [
          el.getAttribute('aria-label'),
          el.getAttribute('data-icon'),
          el.getAttribute('data-testid'),
          el.getAttribute('title')
        ].filter(Boolean))
      ].filter(Boolean);
      const callText = String(text || '').replace(/\s+/g, ' ').trim();
      const textMatch = new RegExp(callDetection.textPatternSource, 'i').test(callText);
      const markerPattern = new RegExp(callDetection.markerPatternSource, 'i');
      return textMatch || markers.some((marker) => markerPattern.test(String(marker || '').trim()));
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
      if (hasOutgoingDeliveryReceipt(root)) return 'out';
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
        const senderLabelFromMetadata = pre
          .replace(/^\[[^\]]+\]\s*/, '')
          .replace(/:\s*$/, '')
          .trim();
        const renderedSenderLabel = String(renderedText || '').split(/\r?\n/, 1)[0].trim();
        const senderLabel = senderLabelFromMetadata
          || (isLikelyOutgoingSender(renderedSenderLabel) ? renderedSenderLabel : '');
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
        const documentMedia = Boolean(node.querySelector('a[download], [data-icon*="document" i], [data-testid*="document" i]'))
          || /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv)(?:\s|$)/i.test(rawText);
        const videoMedia = hasVideoMedia(node);
        const mediaType = sharedLocation
          ? 'location'
          : hasNonEmojiImage && isTimestampOnlyText(rawText) && !!sharedLocation
            ? 'location_preview'
          : callLog
          ? 'call'
          : documentMedia
            ? 'media'
          : videoMedia
            ? 'media'
          : voiceNote
            ? 'voice'
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
          senderLabel,
          direction: inferredDirection,
          mediaType,
          mediaUrl: mediaType === 'text' ? '' : `whatsapp-web://${messageId || crypto.randomUUID()}`,
          sharedLocation,
          mediaCount,
          mediaFingerprint
        });
      });
    return snapshots
      .filter((item) => item.chatKey && item.text && (
        item.mediaType === 'call'
        || item.mediaType === 'call_log'
        || item.direction === 'in'
        || (item.direction === 'unknown' && item.mediaType && item.mediaType !== 'text')
      ))
      .slice(-Math.max(1, maxItems));
  }, { maxItems: limit, callDetection: WHATSAPP_CALL_CARD_BROWSER_CONFIG });
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

function isLikelyWhatsappVideoResponse(response) {
  const headers = response.headers();
  const contentType = String(headers['content-type'] || '').toLowerCase();
  const url = String(response.url() || '').toLowerCase();
  if (contentType.startsWith('video/')) return true;
  const binary = contentType.includes('application/octet-stream') || contentType.includes('binary/octet-stream');
  const whatsappMedia = /(?:mmg\.whatsapp\.net|media|video|\.mp4|\.mov|\.webm)/i.test(url);
  const resourceType = String(response.request()?.resourceType?.() || '').toLowerCase();
  return binary && whatsappMedia && ['media', 'fetch', 'xhr'].includes(resourceType);
}

function isPlayableVideoBuffer(buffer, mimeType = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('webm')) {
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

async function clickVideoMessageControl(page, messageId) {
  return page.evaluate((targetMessageId) => {
    const nodes = Array.from(document.querySelectorAll('[data-id], [data-testid^="conv-msg-"]'));
    const root = nodes.find((el) => (
      el.getAttribute('data-id') === targetMessageId
      || el.getAttribute('data-testid') === targetMessageId
    ));
    if (!root) return false;
    const poster = Array.from(root.querySelectorAll('img')).find((img) => (
      img.naturalWidth >= 160 && img.naturalHeight >= 120
    ));
    const explicitVideo = root.querySelector('[data-testid*="video" i], [data-icon*="video" i], [aria-label*="video" i]');
    const controls = [
      root.querySelector('[aria-label*="Play video" i]'),
      root.querySelector('[data-testid*="video-play" i]'),
      root.querySelector('[data-icon="play"]'),
      root.querySelector('[aria-label="Play" i], [aria-label^="Play " i]')
    ].filter(Boolean);
    const control = controls[0] || explicitVideo;
    if (!control || (!explicitVideo && !poster)) return false;
    const clickable = control.closest?.('button, [role="button"]') || control;
    clickable.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    clickable.click();
    return true;
  }, messageId).catch(() => false);
}

async function captureVideoSnapshotFromNetwork(page, messageId) {
  const responsePromise = page.waitForResponse(
    (response) => response.ok() && isLikelyWhatsappVideoResponse(response),
    { timeout: 8000 }
  ).catch(() => null);
  const clicked = await clickVideoMessageControl(page, messageId);
  if (!clicked) return null;
  const response = await responsePromise;
  if (!response) return null;
  const buffer = await response.body().catch(() => null);
  if (!buffer?.length || buffer.length > EMPLOYEE_VIDEO_PREVIEW_MAX_BYTES) return null;
  const contentType = String(response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
  const mimeType = contentType.startsWith('video/') ? contentType : 'video/mp4';
  if (!isPlayableVideoBuffer(buffer, mimeType)) {
    log(`ignored encrypted or unsupported WhatsApp video response for ${messageId}`);
    return null;
  }
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mimeType,
    bytes: buffer.length,
    kind: 'video',
    name: ''
  };
}

async function captureVideoMessageScreenshot(page, messageId) {
  const candidates = page.locator('[data-id], [data-testid^="conv-msg-"]');
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const dataId = await candidate.getAttribute('data-id').catch(() => '');
    const testId = await candidate.getAttribute('data-testid').catch(() => '');
    if (dataId !== messageId && testId !== messageId) continue;
    await candidate.scrollIntoViewIfNeeded().catch(() => {});
    const buffer = await candidate.screenshot({
      type: 'jpeg',
      quality: 82,
      animations: 'disabled'
    }).catch(() => null);
    if (!buffer?.length || buffer.length > LISTING_IMAGE_PREVIEW_MAX_BYTES) return null;
    return {
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      mimeType: 'image/jpeg',
      bytes: buffer.length,
      kind: 'image',
      name: 'whatsapp-video-message-preview.jpg',
      degradedFromVideo: true
    };
  }
  return null;
}

async function captureVideoPosterFrame(page, messageId) {
  return page.evaluate(async ({ targetMessageId, maxBytes }) => {
    const nodes = Array.from(document.querySelectorAll('[data-id], [data-testid^="conv-msg-"]'));
    const root = nodes.find((el) => (
      el.getAttribute('data-id') === targetMessageId
      || el.getAttribute('data-testid') === targetMessageId
    ));
    if (!root) return null;

    const visibleVideo = Array.from(document.querySelectorAll('video')).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 90 && item.videoWidth > 0 && item.videoHeight > 0;
    });
    const video = root.querySelector('video') || visibleVideo || null;
    if (video?.videoWidth && video?.videoHeight) {
      video.pause?.();
      const duration = Number(video.duration || 0);
      if (duration > 0.25 && Number(video.currentTime || 0) < 0.1) {
        const seekTarget = Math.min(1, Math.max(0.1, duration / 3));
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 1200);
          video.addEventListener('seeked', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
          try {
            video.currentTime = seekTarget;
          } catch {
            clearTimeout(timeout);
            resolve();
          }
        });
      }
    }

    const poster = Array.from(root.querySelectorAll('img'))
      .filter((img) => img.naturalWidth >= 160 && img.naturalHeight >= 120)
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0] || null;
    const source = video?.videoWidth && video?.videoHeight ? video : poster;
    const width = video?.videoWidth || poster?.naturalWidth || 0;
    const height = video?.videoHeight || poster?.naturalHeight || 0;
    if (!source || !width || !height) return null;

    try {
      const scale = Math.min(1, 1280 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return null;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      let bytes = Math.floor((dataUrl.length * 3) / 4);
      if (bytes > maxBytes) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.68);
        bytes = Math.floor((dataUrl.length * 3) / 4);
      }
      if (!dataUrl || bytes > maxBytes) return null;
      return {
        dataUrl,
        mimeType: 'image/jpeg',
        bytes,
        kind: 'image',
        name: 'whatsapp-video-still.jpg',
        derivedFromVideo: true
      };
    } catch {
      return null;
    }
  }, {
    targetMessageId: messageId,
    maxBytes: LISTING_IMAGE_PREVIEW_MAX_BYTES
  }).catch(() => null);
}

async function hydrateVideoSnapshot(page, snapshot) {
  if (!snapshot || snapshot.mediaType !== 'media' || snapshot.mediaPreviews?.length) return snapshot;
  const messageId = String(snapshot.messageId || '').trim();
  if (!messageId) return snapshot;

  try {
    let preview = await captureVideoSnapshotFromNetwork(page, messageId);
    let browserPreviewError = '';
    if (!preview) {
      try {
        preview = await page.evaluate(async ({ targetMessageId, maxBytes, posterMaxBytes }) => {
      const nodes = Array.from(document.querySelectorAll('[data-id], [data-testid^="conv-msg-"]'));
      const root = nodes.find((el) => (
        el.getAttribute('data-id') === targetMessageId
        || el.getAttribute('data-testid') === targetMessageId
      ));
      const visibleVideo = () => Array.from(document.querySelectorAll('video')).find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 90;
      });
      let video = root?.querySelector('video') || visibleVideo();
      let documentAnchor = root?.querySelector('a[download][href], a[href^="blob:"]')
        || document.querySelector('[role="dialog"] a[download][href], [role="dialog"] a[href^="blob:"]');
      let sourceUrl = video?.currentSrc || video?.src || video?.querySelector('source')?.src
        || documentAnchor?.href || '';
      const highResolutionPoster = Array.from(root?.querySelectorAll('img') || []).some((img) => (
        img.naturalWidth >= 160 && img.naturalHeight >= 120
      ));
      const explicitVideoMarker = root?.querySelector('[data-testid*="video" i], [data-icon*="video" i], [aria-label*="video" i]');
      const playControl = root?.querySelector('[aria-label="Play" i], [aria-label^="Play " i], [data-icon="play"]');
      if (!sourceUrl && (explicitVideoMarker || (highResolutionPoster && playControl))) {
        const clickable = playControl?.closest?.('button, [role="button"]') || playControl || explicitVideoMarker;
        clickable?.click?.();
        for (let attempt = 0; attempt < 20 && !sourceUrl; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          video = root?.querySelector('video') || visibleVideo();
          documentAnchor = root?.querySelector('a[download][href], a[href^="blob:"]')
            || document.querySelector('[role="dialog"] a[download][href], [role="dialog"] a[href^="blob:"]');
          sourceUrl = video?.currentSrc || video?.src || video?.querySelector('source')?.src
            || documentAnchor?.href || '';
        }
      }
      if (!sourceUrl) {
        const poster = Array.from(root?.querySelectorAll('img') || [])
          .filter((img) => img.naturalWidth >= 160 && img.naturalHeight >= 120)
          .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0];
        if (!poster) return null;
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(poster.naturalWidth, poster.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(poster.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(poster.naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return null;
        context.drawImage(poster, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const bytes = Math.floor((dataUrl.length * 3) / 4);
        if (!dataUrl || bytes > posterMaxBytes) return null;
        return {
          dataUrl,
          mimeType: 'image/jpeg',
          bytes,
          kind: 'image',
          name: 'whatsapp-video-preview.jpg',
          degradedFromVideo: true
        };
      }
      const response = await fetch(sourceUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (video && !video.paused) video.pause();
      if (!blob.size || blob.size > maxBytes) return { error: 'video_too_large', bytes: blob.size };
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('video read failed'));
        reader.readAsDataURL(blob);
      });
      const name = documentAnchor?.download || '';
      const extension = String(name).split('.').pop().toLowerCase();
      const inferredMime = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        txt: 'text/plain',
        csv: 'text/csv'
      }[extension] || '';
      const normalizedDataUrl = inferredMime
        ? dataUrl.replace(/^data:[^;,]+/i, `data:${inferredMime}`)
        : dataUrl;
      return {
        dataUrl: normalizedDataUrl,
        mimeType: (blob.type && blob.type !== 'application/octet-stream')
          ? blob.type
          : (inferredMime || (video ? 'video/mp4' : 'application/octet-stream')),
        bytes: blob.size,
        name
      };
        }, {
          targetMessageId: messageId,
          maxBytes: EMPLOYEE_VIDEO_PREVIEW_MAX_BYTES,
          posterMaxBytes: LISTING_IMAGE_PREVIEW_MAX_BYTES
        });
      } catch (error) {
        browserPreviewError = error.message || String(error);
        log(`video DOM fetch failed for ${normalizeChatKey(snapshot.chatKey)}; trying message screenshot fallback: ${browserPreviewError}`);
      }
    }
    if (!preview?.dataUrl) {
      preview = await captureVideoMessageScreenshot(page, messageId);
    }

    if (preview?.dataUrl) {
      const mediaPreview = {
        dataUrl: preview.dataUrl,
        mimeType: preview.mimeType || 'video/mp4',
        bytes: Number(preview.bytes || 0),
        sha256: crypto.createHash('sha256').update(String(preview.dataUrl || '')).digest('hex'),
        kind: preview.kind || (String(preview.mimeType || '').startsWith('video/') ? 'video' : 'document'),
        name: preview.name || ''
      };
      const mediaPreviews = [mediaPreview];
      if (mediaPreview.kind === 'video') {
        const still = await captureVideoPosterFrame(page, messageId)
          || await captureVideoMessageScreenshot(page, messageId);
        if (still?.dataUrl) {
          mediaPreviews.push({
            dataUrl: still.dataUrl,
            mimeType: still.mimeType || 'image/jpeg',
            bytes: Number(still.bytes || 0),
            sha256: crypto.createHash('sha256').update(String(still.dataUrl || '')).digest('hex'),
            kind: 'image',
            name: still.name || 'whatsapp-video-still.jpg'
          });
        }
      }
      return {
        ...snapshot,
        mediaPreviews,
        mediaCount: mediaPreviews.length,
        ...(mediaPreview.kind === 'video' && mediaPreviews.length === 1 ? {
          mediaPreviewWarning: 'video_still_unavailable'
        } : {}),
        ...(preview.degradedFromVideo ? {
          mediaPreviewError: 'video_bytes_unavailable_poster_stored'
        } : {})
      };
    }
    return {
      ...snapshot,
      mediaPreviewError: preview?.error || browserPreviewError || 'video_preview_unavailable'
    };
  } catch (error) {
    return { ...snapshot, mediaPreviewError: error.message || String(error) };
  }
}

async function hydrateMediaSnapshot(page, snapshot) {
  const voiceHydrated = await hydrateVoiceSnapshot(page, snapshot);
  const imageHydrated = await hydrateImageSnapshot(page, voiceHydrated);
  return hydrateVideoSnapshot(page, imageHydrated);
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
  if (!isResolvableWhatsappCallChatKey(normalizedChatKey)) {
    log(`skipped call card without a resolvable phone identity: ${normalizedChatKey}`);
    return { processed: 0, skipped: 'unresolved_phone_for_call' };
  }

  const callEventKey = [
    'call-card',
    normalizedChatKey,
    normalizeReplyText(normalizedText).toLowerCase(),
    String(snapshot.timestampLabel || row.timestampLabel || '').trim()
  ].join(':').slice(0, 500);
  if (!rememberCallEventKey(callEventKey)) {
    return { processed: 0, duplicate: true };
  }

  const callId = createMessageId(
    normalizedChatKey,
    normalizedText,
    snapshot.timestampLabel || row.timestampLabel || '',
    'call',
    snapshot.messageId || ''
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
          detection_kind: 'call_log_card',
          call_detector_release: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER,
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
  if (isOwnWhatsappMessage({
    direction: snapshot.direction,
    senderLabel: snapshot.senderLabel,
    text: snapshot.text
  })) return { processed: 0, skipped: 'outgoing_message' };
  if (chatKey.replace(/\D/g, '').length >= 9) {
    activeInboundRecipientHint = chatKey;
  }
  if (source === 'active_chat' && mediaType !== 'text' && !snapshot.messageId && !snapshot.mediaFingerprint) {
    return { processed: 0, skipped: 'unstable_active_media_without_message_id' };
  }

  const browserMediaPlaceholder = /^whatsapp-web:\/\//i.test(String(snapshot.mediaUrl || ''));
  const missingImageBytes = mediaType === 'image'
    && browserMediaPlaceholder
    && !(Array.isArray(snapshot.imagePreviews) && snapshot.imagePreviews.length);
  const missingFileBytes = mediaType === 'media'
    && browserMediaPlaceholder
    && !(Array.isArray(snapshot.mediaPreviews) && snapshot.mediaPreviews.length);
  if (missingImageBytes || missingFileBytes) {
    const hydrationError = snapshot.imagePreviewError || snapshot.mediaPreviewError || 'media_bytes_unavailable';
    log(`paused ordered intake for ${chatKey}: ${hydrationError}`);
    return {
      processed: 0,
      retryable: true,
      skipped: 'ordered_media_hydration_pending',
      error: new Error(hydrationError)
    };
  }

  const browserMessageKey = snapshot.browserMessageKey || browserMessageKeyFor(snapshot, row);
  if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) {
    return { processed: 0, duplicate: true };
  }
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
          message_direction: snapshot.direction || '',
          sender_label: snapshot.senderLabel || '',
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
          media_previews: Array.isArray(snapshot.mediaPreviews)
            ? snapshot.mediaPreviews.map((item) => ({
              data_url: item.dataUrl || '',
              mime_type: item.mimeType || 'application/octet-stream',
              bytes: Number(item.bytes || 0),
              sha256: item.sha256 || '',
              kind: item.kind || ''
            }))
            : [],
          media_preview_error: snapshot.mediaPreviewError || '',
          unread_preview: row.preview || '',
          source,
          ...(snapshot.bridgeMetadata && typeof snapshot.bridgeMetadata === 'object'
            ? snapshot.bridgeMetadata
            : {})
        }
      }
    });
    rememberBrowserMessageKey(browserMessageKey);
    if (!result.duplicate) {
      log(`ingested ${source} ${mediaType} message from ${chatKey}; queued_reply=${result.data?.queued_reply ? 'yes' : 'no'}`);
    }
    return {
      processed: result.duplicate ? 0 : 1,
      duplicate: !!result.duplicate,
      queuedReply: !!result.data?.queued_reply,
      backfillRequest: result.data?.backfill_request || null,
      ownerForward: result.data?.owner_forward || null,
      responseMessage: result.data?.message || '',
      chatKey
    };
  } catch (error) {
    log('failed to ingest chat:', chatKey, error.message || error);
    return { processed: 0, error };
  }
}

async function scrollWhatsappHistoryOlder(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#main')
      || document.querySelector('[data-testid="conversation-panel-wrapper"]');
    if (!root) return false;
    const candidates = [root, ...Array.from(root.querySelectorAll('div'))]
      .filter((el) => el.scrollHeight > el.clientHeight + 120);
    if (!candidates.length) return false;
    const scroller = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    // WhatsApp can initially report scrollTop=0 while it is still hydrating the
    // current history window. Re-applying the top boundary and continuing the
    // bounded scan gives its virtualized list time to fetch the preceding rows.
    // Returning false here used to abandon recovery after the first viewport.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1200 }));
    return true;
  }).catch(() => false);
}

async function scrollWhatsappHistoryToLatest(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#main')
      || document.querySelector('[data-testid="conversation-panel-wrapper"]');
    if (!root) return;
    const candidates = [root, ...Array.from(root.querySelectorAll('div'))]
      .filter((el) => el.scrollHeight > el.clientHeight + 120);
    if (!candidates.length) return;
    const scroller = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }).catch(() => {});
  await page.waitForTimeout(350);
}

async function scrollWhatsappHistoryNewer(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#main')
      || document.querySelector('[data-testid="conversation-panel-wrapper"]');
    if (!root) return false;
    const candidates = [root, ...Array.from(root.querySelectorAll('div'))]
      .filter((el) => el.scrollHeight > el.clientHeight + 120);
    if (!candidates.length) return false;
    const scroller = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    const previousTop = scroller.scrollTop;
    const maximumTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const step = Math.max(500, Math.floor(scroller.clientHeight * 0.8));
    const nextTop = Math.min(maximumTop, previousTop + step);
    scroller.scrollTop = nextTop;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    return nextTop > previousTop + 5;
  }).catch(() => false);
}

function employeeBatchSnapshotKey(snapshot = {}) {
  return String(
    snapshot.messageId
    || snapshot.mediaFingerprint
    || `${snapshot.timestampLabel || ''}:${snapshot.mediaType || 'text'}:${snapshot.text || ''}`
  ).slice(0, 500);
}

function snapshotsAfterCompletedEmployeeBatch(snapshots = [], replay = {}) {
  if (!replay.alreadyComplete || !replay.completionKey) return snapshots;
  let completionIndex = -1;
  for (let index = 0; index < snapshots.length; index += 1) {
    if (employeeBatchSnapshotKey(snapshots[index]) === replay.completionKey) {
      completionIndex = index;
    }
  }
  return completionIndex >= 0 ? snapshots.slice(completionIndex + 1) : snapshots;
}

function isEmployeeBatchTriggerSnapshot(snapshot = {}) {
  return /^\s*agent\s*0*07\s*[.!]?\s*$/i.test(String(snapshot.text || '').trim());
}

function isEmployeeBatchCompletionSnapshot(snapshot = {}) {
  return /^\s*complete(?:\s+complete)*\s*[.!]?\s*$/i.test(String(snapshot.text || '').trim());
}

function isEmployeePropertyStartSnapshot(snapshot = {}) {
  if (!['image', 'media'].includes(String(snapshot.mediaType || '').toLowerCase())) return false;
  const text = String(snapshot.text || '').trim();
  if (!text || /^(?:forwarded|\[(?:image|media|video|document)\])$/i.test(text)) return false;
  return true;
}

async function locateEmployeeBatchHistory(page, { chatKey = '' } = {}) {
  const normalizedChat = normalizeChatKey(chatKey);
  const snapshotsByKey = new Map();
  let orderedKeys = [];
  let triggerKey = '';

  for (let round = 0; round < EMPLOYEE_BATCH_HISTORY_MAX_ROUNDS; round += 1) {
    const snapshots = (await getRecentIncomingSnapshots(page, EMPLOYEE_BATCH_HISTORY_SCAN_LIMIT))
      .filter((snapshot) => {
        const snapshotChat = normalizeChatKey(snapshot.chatKey);
        return !normalizedChat || !snapshotChat || snapshotChat === normalizedChat;
      });
    const newKeys = [];
    for (const snapshot of snapshots) {
      const key = employeeBatchSnapshotKey(snapshot);
      if (!key || snapshotsByKey.has(key)) continue;
      snapshotsByKey.set(key, snapshot);
      newKeys.push(key);
    }
    if (round === 0) orderedKeys.push(...newKeys);
    else orderedKeys = [...newKeys, ...orderedKeys];

    const ordered = orderedKeys.map((key) => snapshotsByKey.get(key)).filter(Boolean);
    const lastCompletionIndex = ordered.map(isEmployeeBatchCompletionSnapshot).lastIndexOf(true);
    const lastTriggerIndex = ordered
      .slice(0, lastCompletionIndex >= 0 ? lastCompletionIndex + 1 : ordered.length)
      .map(isEmployeeBatchTriggerSnapshot)
      .lastIndexOf(true);
    if (lastCompletionIndex >= 0 && lastTriggerIndex >= 0 && lastTriggerIndex < lastCompletionIndex) {
      triggerKey = employeeBatchSnapshotKey(ordered[lastTriggerIndex]);
      const completionKey = employeeBatchSnapshotKey(ordered[lastCompletionIndex]);
      const batchSnapshots = ordered.slice(lastTriggerIndex, lastCompletionIndex + 1);
      return {
        found: true,
        chatKey: normalizedChat || normalizeChatKey(ordered[lastCompletionIndex]?.chatKey),
        triggerKey,
        completionKey,
        triggerSnapshot: ordered[lastTriggerIndex],
        completionSnapshot: ordered[lastCompletionIndex],
        observedPropertyMessages: batchSnapshots.filter(isEmployeePropertyStartSnapshot).length
      };
    }
    const moved = await scrollWhatsappHistoryOlder(page);
    if (!moved) break;
    await page.waitForTimeout(650);
  }

  await scrollWhatsappHistoryToLatest(page);
  return { found: false, reason: triggerKey ? 'completion_not_found' : 'agent_007_trigger_not_found' };
}

async function replayEmployeeBatchThroughCompletion(page, history = {}, row = {}) {
  const completionKey = String(history.completionKey || '');
  if (!history.found || !completionKey) return { handled: false, processed: 0 };
  if (completedEmployeeBatchHistoryKeys.has(completionKey)) {
    return { handled: false, processed: 0, alreadyComplete: true, completionKey };
  }

  const preparation = await apiRequest('/api/whatsapp/web-bridge/employee-batch-recovery', {
    method: 'POST',
    body: {
      client_id: CLIENT_ID,
      phone: history.chatKey,
      observed_property_messages: history.observedPropertyMessages,
      trigger_message_id: history.triggerSnapshot?.messageId || history.triggerKey,
      completion_message_id: history.completionSnapshot?.messageId || history.completionKey
    }
  });
  const preparationData = preparation.data || {};
  if (preparationData.alreadyComplete) {
    completedEmployeeBatchHistoryKeys.add(completionKey);
    rememberBrowserMessageKey(browserMessageKeyFor(history.completionSnapshot, row));
    await scrollWhatsappHistoryToLatest(page);
    log(`Agent 007 batch already reconciled for ${history.chatKey}: ${history.observedPropertyMessages} property messages`);
    return { handled: false, processed: 0, alreadyComplete: true, completionKey };
  }
  if (!preparationData.ready) {
    completedEmployeeBatchHistoryKeys.add(completionKey);
    await scrollWhatsappHistoryToLatest(page);
    log(`Agent 007 batch history replay skipped for ${history.chatKey}: ${preparationData.reason || 'recovery_not_ready'}`);
    return { handled: true, processed: 0, skipped: preparationData.reason || 'recovery_not_ready' };
  }

  log(`starting Agent 007 ordered history replay for ${history.chatKey}: ${history.observedPropertyMessages} property messages observed`);
  let started = false;
  let completed = false;
  let processed = 0;
  const completedSnapshotKeys = employeeBatchReplayProgress.get(completionKey) || new Set();
  employeeBatchReplayProgress.set(completionKey, completedSnapshotKeys);
  while (employeeBatchReplayProgress.size > 25) {
    employeeBatchReplayProgress.delete(employeeBatchReplayProgress.keys().next().value);
  }
  const visited = new Set(completedSnapshotKeys);
  const replayRunKey = crypto.createHash('sha1')
    .update(`${history.triggerKey}:${history.completionKey}:${Date.now()}:${crypto.randomUUID()}`)
    .digest('hex')
    .slice(0, 16);

  for (let round = 0; round < EMPLOYEE_BATCH_HISTORY_MAX_ROUNDS * 2 && !completed; round += 1) {
    const snapshots = (await getRecentIncomingSnapshots(page, EMPLOYEE_BATCH_HISTORY_SCAN_LIMIT))
      .filter((snapshot) => {
        const snapshotChat = normalizeChatKey(snapshot.chatKey);
        return !history.chatKey || !snapshotChat || snapshotChat === history.chatKey;
      });
    for (const snapshot of snapshots) {
      const key = employeeBatchSnapshotKey(snapshot);
      if (!started) {
        if (key !== history.triggerKey) continue;
        started = true;
      }
      if (!key || visited.has(key)) continue;

      const isCompletion = key === history.completionKey || isEmployeeBatchCompletionSnapshot(snapshot);
      if (!isCompletion && !['image', 'media'].includes(String(snapshot.mediaType || '').toLowerCase())) {
        visited.add(key);
        continue;
      }
      const originalBrowserKey = browserMessageKeyFor(snapshot, row);
      if (isCompletion) {
        const result = await ingestSnapshot({
          snapshot: {
            ...snapshot,
            messageId: `${snapshot.messageId || key}:ordered-complete:${replayRunKey}`.slice(0, 500),
            browserMessageKey: `employee-batch-complete:${replayRunKey}`,
            bridgeMetadata: {
              employee_batch_ordered_replay: true,
              employee_batch_completion: true,
              employee_batch_history_marker: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER,
              observed_property_messages: history.observedPropertyMessages
            }
          },
          row,
          source: 'employee_batch_history_completion'
        });
        if (result.retryable || result.error) {
          log(`Agent 007 ordered history completion paused for ${history.chatKey}: ${result.error?.message || result.error || 'retryable_completion_error'}`);
          await scrollWhatsappHistoryToLatest(page);
          return {
            handled: true,
            processed,
            retryable: true,
            skipped: result.error ? 'bridge_completion_error' : 'retryable_completion_error'
          };
        }
        processed += result.processed || 0;
        if (result.queuedReply) await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
        rememberBrowserMessageKey(originalBrowserKey);
        completed = !!(result.processed || result.duplicate || result.queuedReply);
        break;
      }

      const hydrated = await hydrateMediaSnapshot(page, {
        ...snapshot,
        bridgeMetadata: {
          employee_batch_ordered_replay: true,
          employee_batch_completion: false,
          employee_batch_history_marker: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER,
          observed_property_messages: history.observedPropertyMessages
        }
      });
      const result = await ingestSnapshot({
        snapshot: {
          ...hydrated,
          messageId: `${snapshot.messageId || key}:ordered-replay:${replayRunKey}`.slice(0, 500),
          browserMessageKey: `employee-batch-replay:${replayRunKey}:${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`
        },
        row,
        source: 'employee_batch_history_replay'
      });
      if (result.retryable || result.error) {
        log(`Agent 007 ordered history replay paused for ${history.chatKey}: ${result.error?.message || result.error || 'retryable_media_error'}`);
        await scrollWhatsappHistoryToLatest(page);
        return {
          handled: true,
          processed,
          retryable: true,
          skipped: result.error ? 'bridge_ingest_error' : 'retryable_media_error'
        };
      }
      processed += result.processed || 0;
      visited.add(key);
      completedSnapshotKeys.add(key);
    }
    if (completed) break;
    const moved = await scrollWhatsappHistoryNewer(page);
    if (!moved) break;
    await page.waitForTimeout(650);
  }

  await scrollWhatsappHistoryToLatest(page);
  if (completed) {
    completedEmployeeBatchHistoryKeys.add(completionKey);
    employeeBatchReplayProgress.delete(completionKey);
    log(`Agent 007 ordered history replay completed for ${history.chatKey}; processed ${processed} missing message(s)`);
    return { handled: true, processed, completed: true };
  }
  log(`Agent 007 ordered history replay did not reach COMPLETE for ${history.chatKey}`);
  return { handled: true, processed, retryable: true, skipped: 'completion_not_reached' };
}

async function maybeReplayEmployeeBatchThroughCompletion(page, snapshots = [], row = {}) {
  const visibleCompletions = snapshots.filter(isEmployeeBatchCompletionSnapshot);
  const visibleCompletion = visibleCompletions[visibleCompletions.length - 1];
  if (!visibleCompletion) return { handled: false, processed: 0 };
  const visibleCompletionKey = employeeBatchSnapshotKey(visibleCompletion);
  if (completedEmployeeBatchHistoryKeys.has(visibleCompletionKey)) {
    return {
      handled: false,
      processed: 0,
      alreadyComplete: true,
      completionKey: visibleCompletionKey
    };
  }
  const history = await locateEmployeeBatchHistory(page, {
    chatKey: normalizeChatKey(visibleCompletion.chatKey || row.title)
  });
  if (!history.found) return { handled: false, processed: 0 };
  return replayEmployeeBatchThroughCompletion(page, history, row);
}

async function runConfiguredEmployeeBatchRecovery(page) {
  let processed = 0;
  let settled = EMPLOYEE_BATCH_RECOVERY_PHONES.length > 0;
  for (const phone of EMPLOYEE_BATCH_RECOVERY_PHONES) {
    const opened = await openChatForReply(page, phone);
    if (!opened) {
      log(`configured Agent 007 recovery chat could not be opened: ${phone}`);
      settled = false;
      continue;
    }
    await page.waitForTimeout(700);
    const snapshots = await getRecentIncomingSnapshots(page, RECENT_INBOUND_BACKLOG_LIMIT);
    let result = await maybeReplayEmployeeBatchThroughCompletion(page, snapshots, {
      title: phone,
      preview: ''
    });
    if (!result.handled && !result.alreadyComplete) {
      const history = await locateEmployeeBatchHistory(page, { chatKey: phone });
      if (history.found) {
        result = await replayEmployeeBatchThroughCompletion(page, history, {
          title: phone,
          preview: ''
        });
      }
    }
    processed += result.processed || 0;
    const phoneSettled = !!(result.completed || result.alreadyComplete);
    settled = settled && phoneSettled;
    log(`configured Agent 007 recovery checked ${phone}; handled=${result.handled ? 'yes' : 'no'} settled=${phoneSettled ? 'yes' : 'no'} processed=${result.processed || 0}`);
  }
  return { processed, settled };
}

function employeeVideoRecoveryPhone(target = {}) {
  const suffix = String(target.sender_phone_suffix || '').replace(/\D/g, '');
  if (!suffix) return '';
  return EMPLOYEE_BATCH_RECOVERY_PHONES.find((phone) => (
    String(phone || '').replace(/\D/g, '').endsWith(suffix)
  )) || '';
}

async function findEmployeeVideoRecoverySnapshot(page, target = {}, chatKey = '') {
  const expectedCaption = normalizeReplyText(target.source_caption || '').toLowerCase();
  if (!expectedCaption) return null;
  await scrollWhatsappHistoryToLatest(page);
  for (let round = 0; round < EMPLOYEE_BATCH_HISTORY_MAX_ROUNDS; round += 1) {
    const snapshots = (await getRecentIncomingSnapshots(page, EMPLOYEE_BATCH_HISTORY_SCAN_LIMIT))
      .filter((snapshot) => {
        const snapshotChat = normalizeChatKey(snapshot.chatKey);
        return !chatKey || !snapshotChat || snapshotChat === normalizeChatKey(chatKey);
      });
    const match = snapshots.find((snapshot) => {
      if (!['image', 'media'].includes(String(snapshot.mediaType || '').toLowerCase())) return false;
      const observedCaption = normalizeReplyText(snapshot.text || '').toLowerCase();
      return observedCaption === expectedCaption
        || observedCaption.endsWith(expectedCaption)
        || expectedCaption.endsWith(observedCaption);
    });
    if (match) return match;
    const moved = await scrollWhatsappHistoryOlder(page);
    if (!moved) break;
    await page.waitForTimeout(650);
  }
  await scrollWhatsappHistoryToLatest(page);
  return null;
}

async function runPendingEmployeeVideoRecovery(page) {
  const response = await apiRequest('/api/whatsapp/web-bridge/employee-video-recovery-targets');
  const targets = Array.isArray(response.data?.targets) ? response.data.targets : [];
  if (!targets.length) return { settled: true, recovered: 0 };
  let recovered = 0;
  let retryable = false;
  for (const target of targets) {
    const phone = employeeVideoRecoveryPhone(target);
    if (!phone) {
      log(`video recovery target ${target.id} has no configured employee phone matching suffix ${target.sender_phone_suffix || 'unknown'}`);
      retryable = true;
      continue;
    }
    const opened = await openChatForReply(page, phone);
    if (!opened) {
      retryable = true;
      continue;
    }
    const snapshot = await findEmployeeVideoRecoverySnapshot(page, target, phone);
    if (!snapshot) {
      log(`video recovery could not find WhatsApp source message for ${target.id}`);
      retryable = true;
      continue;
    }
    const hydrated = await hydrateMediaSnapshot(page, snapshot);
    const previews = Array.isArray(hydrated.mediaPreviews) ? hydrated.mediaPreviews : [];
    const hasVideo = previews.some((item) => item.kind === 'video' || String(item.mimeType || '').startsWith('video/'));
    const hasImage = previews.some((item) => item.kind === 'image' || String(item.mimeType || '').startsWith('image/'));
    if (!hasVideo || !hasImage) {
      log(`video recovery hydration incomplete for ${target.id}; video=${hasVideo} still=${hasImage}`);
      retryable = true;
      continue;
    }
    const result = await apiRequest(`/api/whatsapp/web-bridge/employee-video-recovery/${encodeURIComponent(target.id)}`, {
      method: 'POST',
      body: {
        client_id: CLIENT_ID,
        phone,
        media_type: 'video/mp4',
        media_previews: previews,
        image_previews: Array.isArray(hydrated.imagePreviews) ? hydrated.imagePreviews : []
      }
    });
    if (result.data?.recovered) {
      recovered += 1;
      log(`recovered original WhatsApp video and still for review property ${target.id}`);
    } else {
      retryable = true;
    }
  }
  await scrollWhatsappHistoryToLatest(page);
  return { settled: !retryable, recovered };
}

async function collectOwnerHistoryBackfillSnapshots(page, { chatKey = '', limit = 60 } = {}) {
  const requestedLimit = Math.max(1, Math.min(100, Number(limit || 60)));
  const normalizedCommandChat = normalizeChatKey(chatKey);
  const collected = new Map();

  for (let round = 0; round < 7 && collected.size < requestedLimit; round += 1) {
    const snapshots = await getRecentIncomingSnapshots(page, requestedLimit);
    for (const snapshot of snapshots) {
      if (snapshot.mediaType !== 'image') continue;
      const snapshotChat = normalizeChatKey(snapshot.chatKey);
      if (normalizedCommandChat && snapshotChat && snapshotChat !== normalizedCommandChat) continue;
      const key = String(
        snapshot.messageId
        || snapshot.mediaFingerprint
        || `${snapshot.timestampLabel}:${snapshot.text}`
      ).slice(0, 500);
      if (!key || collected.has(key)) continue;
      const hydrated = await hydrateMediaSnapshot(page, snapshot);
      collected.set(key, hydrated);
      if (collected.size >= requestedLimit) break;
    }
    if (collected.size >= requestedLimit) break;
    const moved = await scrollWhatsappHistoryOlder(page);
    if (!moved) break;
    await page.waitForTimeout(650);
  }

  return Array.from(collected.values()).slice(-requestedLimit);
}

async function runOwnerHistoryBackfill(page, request = {}, chatKey = '') {
  const sourceLabel = String(request.source_label || '').trim();
  const sourceKey = String(request.source_key || sourceLabel).trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(request.limit || 60)));
  if (!['francis', 'kazi'].includes(sourceKey)) return { processed: 0, skipped: 'invalid_source' };

  log(`starting owner-only ${sourceLabel} history backfill (limit ${limit})`);
  const snapshots = await collectOwnerHistoryBackfillSnapshots(page, { chatKey, limit });
  let mediaAttached = 0;
  const updatedProperties = new Set();
  let alreadyHandled = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    const originalText = String(snapshot.text || '').trim();
    if (!originalText || /^\[image\]$/i.test(originalText)) {
      skipped += 1;
      continue;
    }
    const labelledText = new RegExp(`^\\s*${sourceLabel}\\s*:`, 'i').test(originalText)
      ? originalText
      : `${sourceLabel.toUpperCase()}: ${originalText}`;
    const historyKey = String(
      snapshot.messageId
      || snapshot.mediaFingerprint
      || `${snapshot.timestampLabel}:${originalText}:${index}`
    );
    const backfillMessageId = `${historyKey}:backfill:${String(request.run_id || Date.now())}`.slice(0, 500);
    const result = await ingestSnapshot({
      snapshot: {
        ...snapshot,
        text: labelledText,
        messageId: backfillMessageId,
        browserMessageKey: `owner-history-backfill:${sourceKey}:${request.run_id || 'run'}:${historyKey}`.slice(0, 500),
        bridgeMetadata: {
          owner_history_backfill: true,
          reconcile_only: true,
          suppress_reply: true,
          backfill_source_label: sourceLabel,
          backfill_marker: request.marker || 'whatsapp-owner-history-backfill-20260820'
        }
      },
      row: { title: chatKey || snapshot.chatKey, preview: '' },
      source: 'owner_history_backfill'
    });
    if (result.error) {
      failed += 1;
      continue;
    }
    const action = result.ownerForward?.action || '';
    if (action === 'media_reconciled') {
      mediaAttached += Number(result.ownerForward?.media_attached || 0);
      if (result.ownerForward?.property_id) updatedProperties.add(result.ownerForward.property_id);
    } else if (action === 'media_already_attached' || result.duplicate) {
      alreadyHandled += 1;
    } else {
      skipped += 1;
    }
  }

  await scrollWhatsappHistoryToLatest(page);
  const summary = [
    `✅ ${sourceLabel} photo recovery finished.`,
    `Photos checked: ${snapshots.length}`,
    `Media attached: ${mediaAttached}`,
    `Review rows updated: ${updatedProperties.size}`,
    `Already handled: ${alreadyHandled}`,
    `Skipped safely: ${skipped + failed}`,
    'New listings created: 0',
    'Listings published: 0'
  ].join('\n');
  await typeAndSendReply(page, summary);
  log(`${sourceLabel} history backfill complete: ${JSON.stringify({ photos: snapshots.length, mediaAttached, rows: updatedProperties.size, alreadyHandled, skipped, failed })}`);
  return {
    processed: updatedProperties.size,
    photos: snapshots.length,
    mediaAttached,
    alreadyHandled,
    skipped,
    failed
  };
}

async function runBackfillRequestIfPresent(page, result = {}) {
  if (!result.backfillRequest) return null;
  try {
    return await runOwnerHistoryBackfill(page, result.backfillRequest, result.chatKey);
  } catch (error) {
    log(`owner history backfill failed: ${error.message || error}`);
    await scrollWhatsappHistoryToLatest(page);
    await typeAndSendReply(page, 'I could not complete the photo recovery. Nothing was published or duplicated. Kunta will check the worker log.').catch(() => {});
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

    const snapshots = await getRecentIncomingSnapshots(page, RECENT_INBOUND_BACKLOG_LIMIT);
    const employeeReplay = await maybeReplayEmployeeBatchThroughCompletion(page, snapshots, row);
    if (employeeReplay.handled) {
      processed += employeeReplay.processed || 0;
      continue;
    }
    const liveSnapshots = snapshotsAfterCompletedEmployeeBatch(snapshots, employeeReplay);
    let handledRow = false;
    let retryableBlocked = false;
    for (const snapshot of liveSnapshots) {
      const browserMessageKey = browserMessageKeyFor(snapshot, row);
      if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) continue;
      const hydrated = await hydrateMediaSnapshot(page, {
        ...snapshot,
        browserMessageKey
      });
      const result = await ingestSnapshot({ snapshot: hydrated, row, source: 'unread_scan' });
      if (result.retryable) {
        retryableBlocked = true;
        break;
      }
      processed += result.processed || 0;
      handledRow = handledRow || !!(result.processed || result.duplicate || result.queuedReply);
      if (result.backfillRequest) {
        const backfill = await runBackfillRequestIfPresent(page, result);
        processed += backfill?.processed || 0;
        handledRow = true;
      }
      if (result.queuedReply) {
        await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
      }
    }
    if (!handledRow && !retryableBlocked) {
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

    const snapshots = await getRecentIncomingSnapshots(page, RECENT_INBOUND_BACKLOG_LIMIT);
    const employeeReplay = await maybeReplayEmployeeBatchThroughCompletion(page, snapshots, row);
    if (employeeReplay.handled) {
      processed += employeeReplay.processed || 0;
      rememberRecentChatRow(rowKey);
      return finish(true);
    }
    const liveSnapshots = snapshotsAfterCompletedEmployeeBatch(snapshots, employeeReplay);
    let rowObserved = !liveSnapshots.length;
    let handledRow = false;
    let retryableBlocked = false;
    for (const snapshot of liveSnapshots) {
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
      if (result.retryable) {
        retryableBlocked = true;
        rowObserved = false;
        break;
      }
      rowObserved = true;
      handledRow = handledRow || !!(result.processed || result.duplicate || result.queuedReply);
      processed += result.processed || 0;
      if (result.backfillRequest) {
        const backfill = await runBackfillRequestIfPresent(page, result);
        processed += backfill?.processed || 0;
        rememberRecentChatRow(rowKey);
        return finish(true);
      }
      if (result.queuedReply) {
        await processOutbox(page, { recipient: result.chatKey, maxSends: 1 });
      }
      if (result.processed || result.queuedReply) {
        rememberRecentChatRow(rowKey);
        return finish(true);
      }
    }
    if (!handledRow && row.unread && !retryableBlocked) {
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
  const snapshots = await getRecentIncomingSnapshots(page, RECENT_INBOUND_BACKLOG_LIMIT);
  const employeeReplay = await maybeReplayEmployeeBatchThroughCompletion(page, snapshots, {
    title: snapshots[0]?.chatKey || '',
    preview: ''
  });
  if (employeeReplay.handled) return employeeReplay.processed || 0;
  const liveSnapshots = snapshotsAfterCompletedEmployeeBatch(snapshots, employeeReplay);
  let processed = 0;
  for (const snapshot of liveSnapshots) {
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
    if (result.retryable) break;
    processed += result.processed || 0;
    if (result.backfillRequest) {
      const backfill = await runBackfillRequestIfPresent(page, result);
      processed += backfill?.processed || 0;
    }
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
      const hasOutgoingDeliveryState = Array.from(root.querySelectorAll?.('[aria-label], [data-icon], [data-testid]') || [])
        .some((child) => {
          const aria = normalize(child.getAttribute?.('aria-label') || '').toLowerCase();
          const icon = normalize(child.getAttribute?.('data-icon') || '').toLowerCase();
          const testId = normalize(child.getAttribute?.('data-testid') || '').toLowerCase();
          return /^(?:sent|delivered|read|pending)$/.test(aria)
            || /(?:msg-)?(?:check|clock)/.test(icon)
            || /(?:msg-)?(?:check|clock)/.test(testId);
        });
      if (hasOutgoingDeliveryState) return true;
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

  // The hosted headless worker explicitly trusts a cleared composer. Give the
  // real outgoing bubble a short grace period, then release the single-threaded
  // scan loop instead of holding every other customer behind a three-second UI
  // animation. Interactive/local workers retain the strict confirmation wait.
  const afterClearTimeout = TRUST_SEND_ON_COMPOSER_CLEAR
    ? TRUSTED_COMPOSER_CLEAR_GRACE_MS
    : SEND_CONFIRM_AFTER_CLEAR_MS;
  if (await waitForOutgoingReplyConfirmation(page, text, beforeState, afterClearTimeout)) {
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

async function hasVisibleSelector(page, selectors) {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      if (await matches.nth(index).isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

async function hasPhotoVideoMenuItem(page) {
  if (await hasVisibleSelector(page, PHOTO_VIDEO_MENU_SELECTORS)) return true;
  const matches = page.getByText('Photos & videos', { exact: true });
  const count = await matches.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    if (await matches.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function clickPhotoVideoMenuItem(page) {
  if (await clickFirstVisible(page, PHOTO_VIDEO_MENU_SELECTORS)) return true;
  const matches = page.getByText('Photos & videos', { exact: true });
  const count = await matches.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = matches.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;
    try {
      await candidate.click({ timeout: 2500 });
      return true;
    } catch (_error) {
      // Try another exact visible label if WhatsApp mounted a duplicate.
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

async function findPhotoVideoMenuFileInput(page) {
  for (const selector of PHOTO_VIDEO_MENU_SELECTORS) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const menuItem = matches.nth(index);
      if (!await menuItem.isVisible().catch(() => false)) continue;

      // Current WhatsApp exposes a generic accept="*" input in the active
      // attachment drawer. It is the live React-owned upload control even
      // though an older accept="image/*" input remains mounted in the chat
      // shell. Stay inside the drawer so we never bind the stale control.
      const drawer = menuItem.locator('xpath=ancestor::*[@data-testid="drawer-middle"][1]');
      if (await drawer.count().catch(() => 0)) {
        const drawerInputs = drawer.locator('input[type="file"]');
        const drawerInputCount = await drawerInputs.count().catch(() => 0);
        if (drawerInputCount) return drawerInputs.nth(drawerInputCount - 1);
      }

      const nestedInputs = menuItem.locator('input[type="file"]');
      const nestedInputCount = await nestedInputs.count().catch(() => 0);
      if (nestedInputCount) return nestedInputs.nth(nestedInputCount - 1);
    }
  }
  return null;
}

async function describeFileInputs(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('input[type="file"]')).map((node, index) => {
    const owner = node.closest('[role="menuitem"],button,[aria-label],[data-testid]');
    return {
      index,
      accept: node.getAttribute('accept') || '',
      multiple: node.hasAttribute('multiple'),
      disabled: Boolean(node.disabled),
      ownerRole: owner?.getAttribute?.('role') || '',
      ownerAriaLabel: owner?.getAttribute?.('aria-label') || '',
      ownerDataTestid: owner?.getAttribute?.('data-testid') || ''
    };
  })).catch(() => []);
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
  return page.evaluate(({ selectors, text }) => {
    const isVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
    };
    const candidates = selectors.flatMap((selector) => (
      Array.from(document.querySelectorAll(selector)).filter(isVisible)
    ));
    const target = candidates[candidates.length - 1];
    if (!target) return false;
    target.focus();
    document.execCommand?.('selectAll', false, null);
    document.execCommand?.('insertText', false, String(text || ''));
    target.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: String(text || '')
    }));
    return Boolean(String(target.innerText || target.textContent || '').trim());
  }, { selectors: MEDIA_CAPTION_SELECTORS, text: caption }).catch(() => false);
}

async function pasteImageIntoComposer(page, media) {
  return page.evaluate(({ base64, mimeType, fileName, composerSelectors }) => {
    const isVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
    };
    const composer = composerSelectors.flatMap((selector) => (
      Array.from(document.querySelectorAll(selector)).filter(isVisible)
    )).at(-1);
    if (!composer || typeof DataTransfer !== 'function' || typeof ClipboardEvent !== 'function') return false;

    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], fileName, { type: mimeType });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(file);
    composer.focus();
    composer.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData
    }));
    return true;
  }, {
    base64: media.buffer.toString('base64'),
    mimeType: media.mimeType,
    fileName: media.fileName,
    composerSelectors: COMPOSER_SELECTORS
  }).catch(() => false);
}

async function describeVisibleMediaControls(page) {
  return page.evaluate(() => {
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
    const describe = (node) => ({
      tag: String(node.tagName || '').toLowerCase(),
      role: node.getAttribute?.('role') || '',
      ariaLabel: node.getAttribute?.('aria-label') || '',
      ariaPlaceholder: node.getAttribute?.('aria-placeholder') || '',
      dataTestid: node.getAttribute?.('data-testid') || '',
      dataIcon: node.getAttribute?.('data-icon') || '',
      dataTab: node.getAttribute?.('data-tab') || '',
      contenteditable: node.getAttribute?.('contenteditable') || '',
      type: node.getAttribute?.('type') || ''
    });
    const activeElement = document.activeElement ? describe(document.activeElement) : null;
    const controls = Array.from(document.querySelectorAll([
      '[role="dialog"]',
      '[contenteditable="true"]',
      'button',
      'input[type="file"]',
      '[aria-label]',
      '[aria-placeholder]',
      '[data-testid]',
      '[data-icon]'
    ].join(','))).filter(isVisible).slice(-80).map(describe);
    return { activeElement, controls };
  }).catch(() => ({ activeElement: null, controls: [] }));
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await getMediaComposerState(page);
    if (!state.captionVisible && !state.discardDialogVisible) return true;

    if (state.discardDialogVisible) {
      const clicked = await page.evaluate(() => {
        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
        };
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => (
          isVisible(node)
          && /discard selection/i.test(`${node.getAttribute('aria-label') || ''} ${node.innerText || ''}`)
        ));
        if (!dialog) return false;
        const action = Array.from(dialog.querySelectorAll('button,[role="button"]')).find((node) => (
          isVisible(node) && /discard|yes|ok|continue/i.test(`${node.getAttribute('aria-label') || ''} ${node.innerText || ''}`)
        ));
        if (!action) return false;
        action.click();
        return true;
      }).catch(() => false);
      if (!clicked) await page.keyboard.press('Enter').catch(() => null);
    } else {
      await page.keyboard.press('Escape').catch(() => null);
    }
    await page.waitForTimeout(250);
  }

  const finalState = await getMediaComposerState(page);
  return !finalState.captionVisible && !finalState.discardDialogVisible;
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

async function waitForMediaCaptionReady(page, timeoutMs = 10000) {
  return page.waitForFunction((selectors) => selectors.some((selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    return nodes.some((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8;
    });
  }), MEDIA_CAPTION_SELECTORS, { timeout: timeoutMs }).then(() => true).catch(() => false);
}

async function typeAndSendImageReply(page, mediaUrl, caption) {
  const media = await fetchOutboundPropertyImage(mediaUrl);
  const beforeState = await getOutgoingMessageState(page).catch(() => ({ count: 0, recentTexts: [] }));

  // WhatsApp keeps stale, hidden file inputs mounted in the chat shell. Always
  // open the current attachment menu first so the input we bind owns a live
  // React change handler and actually creates the media-preview composer.
  if (!await hasPhotoVideoMenuItem(page)) {
    const opened = await clickFirstVisible(page, ATTACH_BUTTON_SELECTORS);
    if (!opened) throw new Error('Could not open the WhatsApp attachment picker');
    await page.waitForTimeout(800);
  }
  const drawerInput = await findPhotoVideoMenuFileInput(page);
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
  const photosOpened = await clickPhotoVideoMenuItem(page);
  let captionReady = false;
  if (photosOpened) {
    const fileChooser = await chooserPromise;
    const fileInput = fileChooser ? null : ((await findAttachedFileInput(page)) || drawerInput);
    if (fileChooser || fileInput) {
      const upload = {
        name: media.fileName,
        mimeType: media.mimeType,
        buffer: media.buffer
      };
      if (fileChooser) await fileChooser.setFiles(upload);
      else await fileInput.setInputFiles(upload);
      captionReady = await waitForMediaCaptionReady(page);
    }
  }
  if (!captionReady) {
    const pasted = await pasteImageIntoComposer(page, media);
    if (pasted) captionReady = await waitForMediaCaptionReady(page);
  }
  if (!captionReady || !await setMediaCaption(page, caption)) {
    const controls = await describeVisibleMediaControls(page);
    const fileInputs = await describeFileInputs(page);
    log(`media caption controls unavailable: ${JSON.stringify({ ...controls, fileInputs })}`);
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
    const browserSendStartedAt = Date.now();
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
      const browserSendMs = Date.now() - browserSendStartedAt;
      const queuedAtMs = Date.parse(String(item.created_at || ''));
      const queueAgeMs = Number.isFinite(queuedAtMs) ? Math.max(0, Date.now() - queuedAtMs) : null;
      log(`sent queued reply to ${item.recipient}; browser_send_ms=${browserSendMs}; queue_age_ms=${queueAgeMs ?? 'unknown'}`);

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
  const sessionStartedAt = Date.now();
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
    loadRecentChatRowCache();
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
  log(`Poll interval: ${POLL_MS}ms; outbox poll: ${OUTBOX_POLL_MS}ms; fast lane sweep: ${FAST_LANE_SWEEP_MS}ms; recent chat sweep: ${RECENT_CHAT_SWEEP_MS}ms; send confirm: ${SEND_CONFIRM_MS}ms; trusted clear grace: ${TRUSTED_COMPOSER_CLEAR_GRACE_MS}ms; max browser session: ${Math.round(MAX_SESSION_MS / 60000)}m; memory recycle: ${Math.round(MEMORY_RECYCLE_BYTES / (1024 * 1024))}MB; fast lane rows: ${RECENT_CHAT_FAST_LANE_LIMIT}; sweep open cap: ${RECENT_CHAT_SWEEP_OPEN_LIMIT}; row cache: ${RECENT_CHAT_ROW_CACHE_MS}ms; API retry attempts: ${API_RETRY_ATTEMPTS}`);
  if (connectedOverCdp) {
    log(`Connected over CDP: ${CDP_URL}`);
  } else {
    log(`Profile dir: ${PROFILE_DIR}`);
  }
  log('If WhatsApp asks for a QR scan, keep this window open and log in once.');

  let lastHeartbeat = 0;
  let lastBridgeState = '';
  let lastRecentSweep = 0;
  let lastFastLaneSweep = 0;
  let lastMemoryCheck = 0;
  let lastOutboxPoll = 0;
  let lastTabReselect = 0;
  let consecutiveLoopErrors = 0;
  let configuredEmployeeRecoverySettled = EMPLOYEE_BATCH_RECOVERY_PHONES.length === 0;
  let configuredEmployeeRecoveryAttempts = 0;
  let lastConfiguredEmployeeRecoveryAttempt = 0;
  let employeeVideoRecoverySettled = false;
  let employeeVideoRecoveryAttempts = 0;
  let lastEmployeeVideoRecoveryAttempt = 0;

  while (true) {
    try {
      let readyState = await detectWhatsappReady(page);
      if (readyState.openElsewhere && await claimWhatsappUseHere(page)) {
        readyState = await detectWhatsappReady(page);
        lastBridgeState = '';
      }
      const now = Date.now();
      if (now - sessionStartedAt >= MAX_SESSION_MS) {
        log(`planned browser recycle after ${Math.round((now - sessionStartedAt) / 60000)} minutes to release Chromium memory safely.`);
        await sendHeartbeat({
          status: 'restarting',
          current_url: page.url(),
          metadata: { phase: 'planned_memory_recycle' }
        });
        if (!connectedOverCdp && context) await context.close().catch(() => null);
        process.exit(0);
      }
      if (now - lastMemoryCheck >= MEMORY_CHECK_MS) {
        lastMemoryCheck = now;
        const memoryBytes = readContainerMemoryBytes();
        if (Number.isFinite(memoryBytes) && memoryBytes >= MEMORY_RECYCLE_BYTES) {
          const memoryMb = Math.round(memoryBytes / (1024 * 1024));
          log(`planned browser recycle at ${memoryMb}MB to prevent a Chromium out-of-memory stall.`);
          persistRecentChatRowCache();
          await sendHeartbeat({
            status: 'restarting',
            current_url: page.url(),
            metadata: {
              phase: 'memory_pressure_recycle',
              memory_mb: memoryMb,
              memory_recycle_mb: Math.round(MEMORY_RECYCLE_BYTES / (1024 * 1024))
            }
          });
          if (!connectedOverCdp && context) await context.close().catch(() => null);
          process.exit(0);
        }
      }
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

      let sentAtLoopStart = 0;
      if (now - lastOutboxPoll >= OUTBOX_POLL_MS) {
        sentAtLoopStart = await processOutbox(page, { maxSends: 4 });
        lastOutboxPoll = Date.now();
      }
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
                source: 'whatsapp_web_call_detector',
                detection_kind: 'live_call_overlay',
                call_detector_release: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER
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
      if (!hadLiveActivity && now - lastFastLaneSweep >= FAST_LANE_SWEEP_MS) {
        recentSweepResult = await ingestRecentChatsSweep(page, RECENT_CHAT_FAST_LANE_LIMIT);
        lastFastLaneSweep = Date.now();
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
      const hadPriorityActivity = !!(
        hadLiveActivity
        || hadFastLaneActivity
        || recentSweepResult.processed
        || sentAfterSweep
      );
      if (
        !hadPriorityActivity
        && !configuredEmployeeRecoverySettled
        && configuredEmployeeRecoveryAttempts < EMPLOYEE_BATCH_RECOVERY_MAX_ATTEMPTS
        && now - sessionStartedAt >= EMPLOYEE_BATCH_RECOVERY_IDLE_MS
        && now - lastConfiguredEmployeeRecoveryAttempt >= EMPLOYEE_BATCH_RECOVERY_RETRY_MS
      ) {
        configuredEmployeeRecoveryAttempts += 1;
        lastConfiguredEmployeeRecoveryAttempt = now;
        const recovery = await runConfiguredEmployeeBatchRecovery(page);
        configuredEmployeeRecoverySettled = !!recovery.settled;
        if (!configuredEmployeeRecoverySettled && configuredEmployeeRecoveryAttempts >= EMPLOYEE_BATCH_RECOVERY_MAX_ATTEMPTS) {
          log(`configured Agent 007 recovery exhausted ${configuredEmployeeRecoveryAttempts} bounded attempts; the normal chat sweeps remain active`);
        }
      }
      if (
        !hadPriorityActivity
        && !employeeVideoRecoverySettled
        && employeeVideoRecoveryAttempts < EMPLOYEE_VIDEO_RECOVERY_MAX_ATTEMPTS
        && now - sessionStartedAt >= EMPLOYEE_BATCH_RECOVERY_IDLE_MS
        && now - lastEmployeeVideoRecoveryAttempt >= EMPLOYEE_BATCH_RECOVERY_RETRY_MS
      ) {
        employeeVideoRecoveryAttempts += 1;
        lastEmployeeVideoRecoveryAttempt = now;
        const recovery = await runPendingEmployeeVideoRecovery(page);
        employeeVideoRecoverySettled = !!recovery.settled;
        if (!employeeVideoRecoverySettled && employeeVideoRecoveryAttempts >= EMPLOYEE_VIDEO_RECOVERY_MAX_ATTEMPTS) {
          log(`employee video recovery exhausted ${employeeVideoRecoveryAttempts} bounded attempts; the listings remain pending for staff review`);
        }
      }
      const sentCount = sentAtLoopStart + sentAfterCall + sentAfterActive + sentAfterUnread + sentAfterSweep;
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
