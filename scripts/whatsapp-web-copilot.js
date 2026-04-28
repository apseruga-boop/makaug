#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const BASE_URL = String(
  process.env.WHATSAPP_WEB_COPILOT_BASE_URL
    || process.env.APP_BASE_URL
    || process.env.PUBLIC_BASE_URL
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
const POLL_MS = Math.max(1200, Number(process.env.WHATSAPP_WEB_COPILOT_POLL_MS || 1500));
const HEARTBEAT_MS = Math.max(10000, Number(process.env.WHATSAPP_WEB_COPILOT_HEARTBEAT_MS || 30000));

if (!BRIDGE_TOKEN) {
  console.error('Missing WHATSAPP_WEB_BRIDGE_TOKEN in environment.');
  process.exit(1);
}

if (!CDP_URL && !fs.existsSync(CHROME_PATH)) {
  console.error(`Chrome executable not found at ${CHROME_PATH}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), '[whatsapp-web-copilot]', ...args);
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

async function apiRequest(endpoint, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-whatsapp-web-bridge-token': BRIDGE_TOKEN
    },
    body: body ? JSON.stringify(body) : undefined
  });

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
    await apiRequest('/api/whatsapp/web-bridge/heartbeat', {
      method: 'POST',
      body: {
        client_id: CLIENT_ID,
        operator_name: OPERATOR_NAME || null,
        browser_name: 'Google Chrome',
        profile_dir: PROFILE_DIR,
        ...extra
      }
    });
  } catch (error) {
    log('heartbeat failed:', error.message || error);
  }
}

async function detectWhatsappReady(page) {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const waitingForLogin = bodyText.includes('scan the qr code')
      || bodyText.includes('use whatsapp on your phone to link a device')
      || bodyText.includes('link with phone number');
    const hasChatShell = !!document.querySelector('header') && !!document.querySelector('footer');
    const hasChatList = !!document.querySelector('[aria-label*="Chat list"], [data-testid="chat-list"], div[role="grid"], div[role="list"]');
    const hasLoggedInCopy = bodyText.includes('message notifications are off')
      || bodyText.includes('end-to-end encrypted');
    return {
      waitingForLogin,
      ready: (hasChatShell || hasChatList || hasLoggedInCopy) && !waitingForLogin
    };
  });
}

async function scanUnreadChats(page) {
  return page.evaluate(() => {
    const selectorGroups = [
      '[data-testid="cell-frame-container"]',
      'div[role="listitem"]'
    ];
    let rows = [];
    for (const selector of selectorGroups) {
      rows = Array.from(document.querySelectorAll(selector));
      if (rows.length) break;
    }

    return rows.map((row, index) => {
      const title = row.querySelector('span[title]')?.getAttribute('title')
        || Array.from(row.querySelectorAll('[dir="auto"]')).map((el) => (el.textContent || '').trim()).find(Boolean)
        || (row.innerText || '').split('\n')[0]
        || '';
      const ariaLabel = row.getAttribute('aria-label') || '';
      const unread = !!row.querySelector('[aria-label*="unread"], [data-testid*="unread"], [data-icon*="unread"]')
        || /unread/i.test(ariaLabel);
      const preview = (row.innerText || '').split('\n').slice(1, 4).join(' ').trim();
      return {
        index,
        title,
        preview,
        unread
      };
    }).filter((row) => row.unread && row.title);
  });
}

async function openChatByIndex(page, index) {
  const selectors = ['[data-testid="cell-frame-container"]', 'div[role="listitem"]'];
  for (const selector of selectors) {
    const locator = page.locator(selector).nth(index);
    if (await locator.count()) {
      await locator.click();
      await page.waitForTimeout(900);
      return true;
    }
  }
  return false;
}

async function getActiveChatSnapshot(page) {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    const chatKey = header?.querySelector('span[title]')?.getAttribute('title')
      || Array.from(header?.querySelectorAll('[dir="auto"]') || []).map((el) => (el.textContent || '').trim()).find(Boolean)
      || '';

    const nodes = Array.from(document.querySelectorAll('div.copyable-text[data-pre-plain-text]'));
    const last = nodes[nodes.length - 1];
    if (!last) {
      return {
        chatKey,
        text: '',
        timestampLabel: '',
        messageId: '',
        mediaType: 'text'
      };
    }

    const pre = last.getAttribute('data-pre-plain-text') || '';
    const timestampLabel = (pre.match(/^\[(.*?)\]/) || [])[1] || '';
    const senderLabel = pre
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/:\s*$/, '')
      .trim();
    const resolvedChatKey = chatKey || senderLabel;
    const text = (last.innerText || last.textContent || '').trim();
    const messageId = last.closest('[data-id]')?.getAttribute('data-id')
      || last.getAttribute('data-id')
      || '';
    const direction = last.closest('.message-out')
      ? 'out'
      : last.closest('.message-in')
        ? 'in'
        : 'unknown';
    const mediaType = last.querySelector('img')
      ? 'image'
      : last.querySelector('audio')
        ? 'voice'
        : last.querySelector('video')
          ? 'media'
          : 'text';

    return {
      chatKey: resolvedChatKey,
      text,
      timestampLabel,
      messageId,
      direction,
      mediaType
    };
  });
}

async function getRecentIncomingSnapshots(page, limit = 20) {
  return page.evaluate((maxItems) => {
    const header = document.querySelector('header');
    const chatKey = header?.querySelector('span[title]')?.getAttribute('title')
      || Array.from(header?.querySelectorAll('[dir="auto"]') || []).map((el) => (el.textContent || '').trim()).find(Boolean)
      || '';

    const nodes = Array.from(document.querySelectorAll('div.copyable-text[data-pre-plain-text]'));
    return nodes
      .slice(-Math.max(1, maxItems))
      .map((node) => {
        const pre = node.getAttribute('data-pre-plain-text') || '';
        const timestampLabel = (pre.match(/^\[(.*?)\]/) || [])[1] || '';
        const senderLabel = pre
          .replace(/^\[[^\]]+\]\s*/, '')
          .replace(/:\s*$/, '')
          .trim();
        const direction = node.closest('.message-out')
          ? 'out'
          : node.closest('.message-in')
            ? 'in'
            : 'unknown';
        const messageId = node.closest('[data-id]')?.getAttribute('data-id')
          || node.getAttribute('data-id')
          || '';
        const mediaType = node.querySelector('audio')
          ? 'voice'
          : node.querySelector('video')
            ? 'media'
            : node.querySelector('img')
              ? 'image'
              : 'text';
        const rawText = (node.innerText || node.textContent || '').trim();
        const text = rawText || (mediaType === 'image'
          ? '[image]'
          : mediaType === 'voice'
            ? '[voice note]'
            : mediaType === 'media'
              ? '[media]'
              : '');
        return {
          chatKey: chatKey || senderLabel,
          text,
          timestampLabel,
          messageId,
          direction,
          mediaType,
          mediaUrl: mediaType === 'text' ? '' : `whatsapp-web://${messageId || crypto.randomUUID()}`
        };
      })
      .filter((item) => item.direction === 'in' && item.chatKey && item.text);
  }, limit);
}

async function ingestSnapshot({ snapshot, row = {}, source = 'unread_scan' }) {
  const chatKey = normalizeChatKey(snapshot.chatKey || row.title);
  const text = String(snapshot.text || row.preview || '').trim();
  const mediaType = snapshot.mediaType || 'text';

  if (!chatKey || (!text && !snapshot.mediaUrl)) return { processed: 0, skipped: 'missing_chat_or_content' };
  if (snapshot.direction === 'out') return { processed: 0, skipped: 'outgoing_message' };

  const messageId = createMessageId(chatKey, text, snapshot.timestampLabel, mediaType, snapshot.messageId || '');

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
        created_at: snapshot.timestampLabel || new Date().toISOString(),
        metadata: {
          chat_title: snapshot.chatKey || row.title,
          unread_preview: row.preview || '',
          source
        }
      }
    });
    if (!result.duplicate) {
      log(`ingested ${source} ${mediaType} message from ${chatKey}; queued_reply=${result.data?.queued_reply ? 'yes' : 'no'}`);
    }
    return { processed: result.duplicate ? 0 : 1, duplicate: !!result.duplicate };
  } catch (error) {
    log('failed to ingest chat:', chatKey, error.message || error);
    return { processed: 0, error };
  }
}

async function ingestUnreadChats(page) {
  const unreadRows = await scanUnreadChats(page);
  let processed = 0;

  for (const row of unreadRows) {
    const opened = await openChatByIndex(page, row.index);
    if (!opened) continue;

    const snapshots = await getRecentIncomingSnapshots(page);
    for (const snapshot of snapshots) {
      const result = await ingestSnapshot({ snapshot, row, source: 'unread_scan' });
      processed += result.processed || 0;
    }
  }

  return {
    unreadCount: unreadRows.length,
    processed
  };
}

async function ingestActiveChat(page) {
  const snapshots = await getRecentIncomingSnapshots(page);
  let processed = 0;
  for (const snapshot of snapshots) {
    const result = await ingestSnapshot({
      snapshot,
      row: { title: snapshot.chatKey, preview: '' },
      source: 'active_chat'
    });
    processed += result.processed || 0;
  }
  return processed;
}

async function openChatForReply(page, recipient) {
  const chatKey = String(recipient || '').trim();
  const phoneDigits = chatKey.replace(/\D/g, '');

  if (phoneDigits.length >= 9) {
    await page.goto(`https://web.whatsapp.com/send?phone=${encodeURIComponent(phoneDigits)}`, {
      waitUntil: 'domcontentloaded'
    });
    await page.waitForTimeout(1800);
    return true;
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
        await page.waitForTimeout(900);

        const exactTitle = page.locator(`span[title="${chatKey.replace(/"/g, '\\"')}"]`).first();
        if (await exactTitle.count()) {
          await exactTitle.click();
          await page.waitForTimeout(900);
          return true;
        }

        const row = page.locator('[data-testid="cell-frame-container"], div[role="listitem"]').first();
        if (await row.count()) {
          await row.click();
          await page.waitForTimeout(900);
          return true;
        }
      } catch (_error) {
        // continue to next selector
      }
    }
  }

  return false;
}

async function typeAndSendReply(page, text) {
  const composerSelectors = [
    'footer [data-testid="conversation-compose-box-input"][contenteditable="true"]',
    'footer div[aria-label^="Type a message"][contenteditable="true"]',
    'footer div[contenteditable="true"][data-tab]',
    'footer div[contenteditable="true"]',
    'div[contenteditable="true"][data-tab="10"]'
  ];

  let composer = null;
  const deadline = Date.now() + 15000;
  while (!composer && Date.now() < deadline) {
    for (const selector of composerSelectors) {
      const locator = page.locator(selector).last();
      if (await locator.count()) {
        composer = locator;
        break;
      }
    }
    if (!composer) await page.waitForTimeout(500);
  }

  if (!composer) {
    throw new Error('Could not find the WhatsApp reply box');
  }

  await composer.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(String(text || ''), { delay: 14 });
  await page.waitForTimeout(250);

  const sendSelectors = [
    '[data-testid="compose-btn-send"]',
    'span[data-icon="send"]',
    'button span[data-icon="send"]',
    'button[aria-label*="Send"]'
  ];

  for (const selector of sendSelectors) {
    const button = page.locator(selector).last();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(700);
      return true;
    }
  }

  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  return true;
}

async function processOutbox(page) {
  const response = await apiRequest(`/api/whatsapp/web-bridge/outbox?client_id=${encodeURIComponent(CLIENT_ID)}&limit=5`);
  const items = Array.isArray(response.data) ? response.data : [];

  let sent = 0;
  for (const item of items) {
    try {
      const opened = await openChatForReply(page, item.recipient);
      if (!opened) {
        throw new Error(`Could not open chat for ${item.recipient}`);
      }

      await typeAndSendReply(page, item.text);
      log(`sent queued reply to ${item.recipient}`);

      await apiRequest(`/api/whatsapp/web-bridge/outbox/${encodeURIComponent(item.id)}/sent`, {
        method: 'POST',
        body: {
          client_id: CLIENT_ID,
          bridge_message_id: `webbridge-out:${Date.now()}:${item.id}`
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
  if (!page.url() || page.url() === 'about:blank') {
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
  } else if (!page.url().includes('web.whatsapp.com')) {
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
  }
}

async function main() {
  let browser = null;
  let context = null;

  if (CDP_URL) {
    browser = await chromium.connectOverCDP(CDP_URL);
    context = browser.contexts()[0];
    if (!context) {
      throw new Error(`No browser context available via CDP at ${CDP_URL}`);
    }
  } else {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      executablePath: CHROME_PATH,
      viewport: { width: 1440, height: 980 },
      args: ['--disable-dev-shm-usage']
    });
  }

  const page = context.pages()[0] || await context.newPage();
  await ensureWhatsappTab(page);

  log('WhatsApp Web copilot started.');
  log(`Base URL: ${BASE_URL}`);
  log(`Client ID: ${CLIENT_ID}`);
  if (CDP_URL) {
    log(`Connected over CDP: ${CDP_URL}`);
  } else {
    log(`Profile dir: ${PROFILE_DIR}`);
  }
  log('If WhatsApp asks for a QR scan, keep this window open and log in once.');

  let lastHeartbeat = 0;
  let lastBridgeState = '';

  while (true) {
    try {
      const readyState = await detectWhatsappReady(page);
      const now = Date.now();
      const bridgeState = readyState.ready
        ? 'online'
        : readyState.waitingForLogin
          ? 'waiting_for_login'
          : 'starting';

      if (bridgeState !== lastBridgeState) {
        log(`bridge state -> ${bridgeState} (${page.url() || 'no_url'})`);
        lastBridgeState = bridgeState;
      }

      if (!readyState.ready) {
        if (now - lastHeartbeat >= HEARTBEAT_MS) {
          await sendHeartbeat({
            status: readyState.waitingForLogin ? 'waiting_for_login' : 'starting',
            current_url: page.url(),
            unread_count: 0,
            metadata: {
              note: readyState.waitingForLogin
                ? 'Waiting for WhatsApp Web login'
                : 'Browser starting'
            }
          });
          lastHeartbeat = now;
        }
        await sleep(POLL_MS);
        continue;
      }

      const unreadResult = await ingestUnreadChats(page);
      const activeProcessed = await ingestActiveChat(page);
      const sentCount = await processOutbox(page);
      const activeSnapshot = await getActiveChatSnapshot(page);

      if (now - lastHeartbeat >= HEARTBEAT_MS) {
        await sendHeartbeat({
          status: 'online',
          current_url: page.url(),
          active_chat_key: normalizeChatKey(activeSnapshot.chatKey || ''),
          unread_count: unreadResult.unreadCount || 0,
          stats: {
            processed_unread: unreadResult.processed || 0,
            processed_active: activeProcessed || 0,
            sent_outbound: sentCount || 0
          }
        });
        lastHeartbeat = now;
      }
    } catch (error) {
      log('bridge loop error:', error.message || error);
      await sendHeartbeat({
        status: 'degraded',
        current_url: '',
        last_error: error.message || String(error),
        metadata: {
          phase: 'main_loop'
        }
      });
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
