#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

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
const POLL_MS = Math.max(700, Number(process.env.WHATSAPP_WEB_COPILOT_POLL_MS || 700));
const HEARTBEAT_MS = Math.max(10000, Number(process.env.WHATSAPP_WEB_COPILOT_HEARTBEAT_MS || 30000));
const MAX_CONSECUTIVE_LOOP_ERRORS = Math.max(2, Number(process.env.WHATSAPP_WEB_COPILOT_MAX_LOOP_ERRORS || 5));
const RECENT_CHAT_SWEEP_MS = Math.max(3000, Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_MS || 6500));
const RECENT_CHAT_SWEEP_LIMIT = Math.min(8, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_RECENT_SWEEP_LIMIT || 5)));
const OUTBOX_CLAIM_LIMIT = Math.min(25, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_CLAIM_LIMIT || 25)));
const OUTBOX_SENDS_PER_LOOP = Math.min(10, Math.max(1, Number(process.env.WHATSAPP_WEB_COPILOT_OUTBOX_SENDS_PER_LOOP || 4)));
const VOICE_AUDIO_MAX_BYTES = 8_000_000;
const seenBrowserMessageIds = new Set();
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

function isClosedBrowserError(error) {
  return /target page, context or browser has been closed|browser has been closed|context has been closed|page has been closed|session closed|target closed/i
    .test(String(error?.message || error || ''));
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

function isTimestampOnly(value) {
  return /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(String(value || '').trim());
}

function normalizeReplyText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

async function scanChatRows(page, { unreadOnly = true, limit = 20 } = {}) {
  return page.evaluate((options) => {
    const unreadOnlyRows = options?.unreadOnly !== false;
    const maxRows = Math.max(1, Math.min(50, Number(options?.limit || 20)));
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
    }).filter((row) => row.title && (!unreadOnlyRows || row.unread)).slice(0, maxRows);
  }, { unreadOnly, limit });
}

async function scanUnreadChats(page) {
  return scanChatRows(page, { unreadOnly: true, limit: 25 });
}

async function openChatByIndex(page, index) {
  const selectors = ['[data-testid="cell-frame-container"]', 'div[role="listitem"]'];
  for (const selector of selectors) {
    const locator = page.locator(selector).nth(index);
    if (await locator.count()) {
      await locator.click();
      await page.waitForTimeout(350);
      return true;
    }
  }
  return false;
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
    const isTimestampOnlyText = (value) => /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(String(value || '').trim());
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

    const copyNodes = Array.from(document.querySelectorAll('div.copyable-text[data-pre-plain-text]'));
    const mediaOnlyNodes = Array.from(document.querySelectorAll('[data-id]')).filter((el) => {
      if (el.querySelector('div.copyable-text[data-pre-plain-text]')) return false;
      return !!el.querySelector('img, video, audio') || hasVoiceNote(el, el.innerText || el.textContent || '');
    });
    const nodes = [...copyNodes, ...mediaOnlyNodes]
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
      const nodeDigits = phoneLike(nodeSender);
      if (nodeDigits) {
        fallbackChatKey = nodeDigits;
        fallbackContactName = nodeSender;
      }
    }
    const timestampLabel = (pre.match(/^\[(.*?)\]/) || [])[1] || '';
    const senderLabel = pre
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/:\s*$/, '')
      .trim();
    const senderDigits = phoneLike(senderLabel);
    const headerDigits = phoneLike(headerTitle);
    const resolvedChatKey = senderDigits || headerDigits || fallbackChatKey || headerTitle || senderLabel;
    const contactName = senderDigits
      ? headerTitle
      : (headerDigits ? senderLabel : (fallbackContactName || headerTitle || senderLabel));
    const text = (last.innerText || last.textContent || '').trim();
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
    const messageId = last.closest('[data-id]')?.getAttribute('data-id')
      || last.getAttribute('data-id')
      || '';
    const direction = last.closest('.message-out')
      ? 'out'
      : last.closest('.message-in')
        ? 'in'
        : 'unknown';
    const nonEmojiImages = Array.from(last.querySelectorAll('img')).filter((img) => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      return !src.startsWith('data:image/gif') && !img.className.includes('emoji') && !alt.match(/^\p{Emoji}+$/u);
    });
    const hasNonEmojiImage = nonEmojiImages.length > 0;
    const extraImageMatch = text.match(/\+(\d+)/);
    const mediaCount = hasNonEmojiImage ? Math.max(1, extraImageMatch ? Number(extraImageMatch[1]) + 1 : 1) : 0;
    const sharedLocation = extractSharedLocation(last);
    const voiceNote = hasVoiceNote(last, text);
    const mediaType = sharedLocation
      ? 'location'
      : hasNonEmojiImage && isTimestampOnlyText(text) && !!sharedLocation
        ? 'location_preview'
      : voiceNote
        ? 'voice'
      : last.querySelector('img')
      ? 'image'
      : last.querySelector('video')
          ? 'media'
          : 'text';

    return {
      chatKey: resolvedChatKey,
      contactName,
      text: text || (mediaType === 'image' ? '[image]' : mediaType === 'voice' ? '[voice note]' : mediaType === 'media' ? '[media]' : ''),
      timestampLabel,
      messageId,
      direction,
      mediaType,
      mediaUrl: mediaType === 'text' ? '' : `whatsapp-web://${messageId || crypto.randomUUID()}`,
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
    const isTimestampOnlyText = (value) => /^\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i.test(String(value || '').trim());
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

    const copyNodes = Array.from(document.querySelectorAll('div.copyable-text[data-pre-plain-text]'));
    const mediaOnlyNodes = Array.from(document.querySelectorAll('[data-id]')).filter((el) => {
      if (el.querySelector('div.copyable-text[data-pre-plain-text]')) return false;
      return !!el.querySelector('img, video, audio') || hasVoiceNote(el, el.innerText || el.textContent || '');
    });
    const nodes = [...copyNodes, ...mediaOnlyNodes]
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
        const rawText = (node.innerText || node.textContent || '').trim();
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
        const hasNonEmojiImage = nonEmojiImages.length > 0;
        const extraImageMatch = rawText.match(/\+(\d+)/);
        const mediaCount = hasNonEmojiImage ? Math.max(1, extraImageMatch ? Number(extraImageMatch[1]) + 1 : 1) : 0;
        const sharedLocation = extractSharedLocation(node);
        const voiceNote = hasVoiceNote(node, rawText);
        const mediaType = sharedLocation
          ? 'location'
          : hasNonEmojiImage && isTimestampOnlyText(rawText) && !!sharedLocation
            ? 'location_preview'
          : voiceNote
          ? 'voice'
          : node.querySelector('video')
            ? 'media'
            : node.querySelector('img')
              ? 'image'
              : 'text';
        const text = rawText || (mediaType === 'image'
          ? '[image]'
          : mediaType === 'voice'
            ? '[voice note]'
            : mediaType === 'media'
              ? '[media]'
              : '');
        const senderDigits = phoneLike(senderLabel);
        const headerDigits = phoneLike(headerTitle);
        const resolvedChatKey = senderDigits || headerDigits || lastInboundChatKey || headerTitle || senderLabel;
        const contactName = senderDigits
          ? headerTitle
          : (headerDigits ? senderLabel : (lastInboundContactName || headerTitle || senderLabel));
        const inferredDirection = senderDigits ? 'in' : direction;
        if (senderDigits) {
          lastInboundChatKey = senderDigits;
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
        item.direction === 'in'
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
      const nodes = Array.from(document.querySelectorAll('[data-id]'));
      const root = nodes.find((el) => el.getAttribute('data-id') === targetMessageId);
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

async function ingestSnapshot({ snapshot, row = {}, source = 'unread_scan' }) {
  const chatKey = normalizeChatKey(snapshot.chatKey || row.title);
  const mediaType = snapshot.mediaType || 'text';
  const text = isTimestampOnly(snapshot.text) && String(mediaType).includes('location')
    ? '[shared location]'
    : String(snapshot.text || row.preview || '').trim();

  if (!chatKey || (!text && !snapshot.mediaUrl)) return { processed: 0, skipped: 'missing_chat_or_content' };
  if (snapshot.direction === 'out') return { processed: 0, skipped: 'outgoing_message' };
  if (chatKey.replace(/\D/g, '').length >= 9) {
    activeInboundRecipientHint = chatKey;
  }
  if (source === 'active_chat' && mediaType !== 'text' && !snapshot.messageId && !snapshot.mediaFingerprint) {
    return { processed: 0, skipped: 'unstable_active_media_without_message_id' };
  }

  const browserMessageKey = snapshot.browserMessageKey || browserMessageKeyFor(snapshot, row);
  if (browserMessageKey && !snapshot.browserMessageSeen && seenBrowserMessageIds.has(browserMessageKey)) {
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
      const browserMessageKey = browserMessageKeyFor(snapshot, row);
      if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) continue;
      rememberBrowserMessageKey(browserMessageKey);
      const hydrated = await hydrateVoiceSnapshot(page, {
        ...snapshot,
        browserMessageKey,
        browserMessageSeen: true
      });
      const result = await ingestSnapshot({ snapshot: hydrated, row, source: 'unread_scan' });
      processed += result.processed || 0;
    }
  }

  return {
    unreadCount: unreadRows.length,
    processed
  };
}

async function ingestRecentChatsSweep(page, limit = RECENT_CHAT_SWEEP_LIMIT) {
  const rows = await scanChatRows(page, { unreadOnly: false, limit });
  let processed = 0;

  for (const row of rows) {
    const opened = await openChatByIndex(page, row.index);
    if (!opened) continue;

    const snapshots = await getRecentIncomingSnapshots(page, 6);
    for (const snapshot of snapshots) {
      const browserMessageKey = browserMessageKeyFor(snapshot, row);
      if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) continue;
      rememberBrowserMessageKey(browserMessageKey);
      const hydrated = await hydrateVoiceSnapshot(page, {
        ...snapshot,
        browserMessageKey,
        browserMessageSeen: true
      });
      const result = await ingestSnapshot({ snapshot: hydrated, row, source: 'recent_chat_sweep' });
      processed += result.processed || 0;
    }
  }

  if (processed) {
    log(`recent chat sweep processed ${processed} inbound message${processed === 1 ? '' : 's'}`);
  }

  return {
    scanned: rows.length,
    processed
  };
}

async function ingestActiveChat(page) {
  const snapshots = await getRecentIncomingSnapshots(page);
  let processed = 0;
  for (const snapshot of snapshots) {
    const row = { title: snapshot.chatKey, preview: '' };
    const browserMessageKey = browserMessageKeyFor(snapshot, row);
    if (browserMessageKey && seenBrowserMessageIds.has(browserMessageKey)) continue;
    rememberBrowserMessageKey(browserMessageKey);
    const hydrated = await hydrateVoiceSnapshot(page, {
      ...snapshot,
      browserMessageKey,
      browserMessageSeen: true
    });
    const result = await ingestSnapshot({
      snapshot: hydrated,
      row,
      source: 'active_chat'
    });
    processed += result.processed || 0;
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
    await page.waitForTimeout(120);
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
    const nodes = Array.from(document.querySelectorAll('.message-out'));
    const texts = nodes
      .map((node) => normalize(node.innerText || node.textContent || ''))
      .filter(Boolean);
    return {
      count: nodes.length,
      lastText: texts[texts.length - 1] || '',
      recentTexts: texts.slice(-10)
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

async function waitForOutgoingReplyConfirmation(page, expectedText, beforeState = {}, timeoutMs = 3500) {
  const expected = normalizeReplyText(expectedText);
  const expectedPrefix = expected.slice(0, 120);
  const beforeCount = Number(beforeState.count || 0);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await getOutgoingMessageState(page).catch(() => ({ count: 0, recentTexts: [] }));
    const recentTexts = Array.isArray(state.recentTexts) ? state.recentTexts : [];
    const matchedText = expectedPrefix
      ? recentTexts.some((text) => normalizeReplyText(text).includes(expectedPrefix))
      : false;
    if (state.count > beforeCount && (!expectedPrefix || matchedText || state.lastText)) {
      return true;
    }
    if (matchedText) return true;

    await page.waitForTimeout(120);
  }

  return false;
}

async function openChatForReply(page, recipient) {
  const chatKey = String(recipient || '').trim();
  const phoneDigits = chatKey.replace(/\D/g, '');
  const normalizedRecipient = normalizeChatKey(phoneDigits || chatKey);
  if (activeInboundRecipientHint && activeInboundRecipientHint === normalizedRecipient) {
    const composer = await waitForReplyComposer(page, 1500);
    if (composer) return true;
  }
  const activeSnapshot = await getActiveChatSnapshot(page).catch(() => null);
  const activeKey = normalizeChatKey(activeSnapshot?.chatKey || '');
  if (activeKey && activeKey === normalizedRecipient) {
    return !!await waitForReplyComposer(page, 5000);
  }
  if (phoneDigits.length >= 9 && activeKey === normalizedRecipient) {
    return !!await waitForReplyComposer(page, 5000);
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
          await exactTitle.click();
          return !!await waitForReplyComposer(page, 7000);
        }

        const row = page.locator('[data-testid="cell-frame-container"], div[role="listitem"]').first();
        if (await row.count()) {
          await row.click();
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
  const composer = await waitForReplyComposer(page, 15000);
  if (!composer) {
    throw new Error('Could not find the WhatsApp reply box');
  }

  await composer.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(String(text || ''));
  await page.waitForTimeout(120);

  await clickWhatsAppSend(page);
  const confirmed = await waitForOutgoingReplyConfirmation(page, text, beforeState);
  if (confirmed) return true;

  const composerForEnterSend = await findReplyComposer(page, 700);
  if (composerForEnterSend) {
    await composerForEnterSend.click();
    const composerState = await getReplyComposerText(page).catch(() => ({ found: false, text: '' }));
    if (!normalizeReplyText(composerState.text || '')) {
      await page.keyboard.insertText(String(text || ''));
      await page.waitForTimeout(80);
    }
    await page.keyboard.press('Enter');
    const confirmedAfterEnter = await waitForOutgoingReplyConfirmation(page, text, beforeState, 3000);
    if (confirmedAfterEnter) return true;
  }

  const composerAfterMiss = await findReplyComposer(page, 700);
  if (composerAfterMiss) {
    await composerAfterMiss.click();
    await clickWhatsAppSend(page);
    const confirmedAfterRetry = await waitForOutgoingReplyConfirmation(page, text, beforeState, 2500);
    if (confirmedAfterRetry) return true;
  }

  throw new Error('WhatsApp send was not confirmed in the chat');
}

async function processOutbox(page) {
  const response = await apiRequest(`/api/whatsapp/web-bridge/outbox?client_id=${encodeURIComponent(CLIENT_ID)}&limit=${encodeURIComponent(OUTBOX_CLAIM_LIMIT)}`);
  const items = Array.isArray(response.data) ? response.data : [];
  const activeRecipient = normalizeChatKey(activeInboundRecipientHint || '');
  const orderedItems = items.sort((a, b) => {
    if (!activeRecipient) return 0;
    const aKey = normalizeChatKey(a.recipient || '');
    const bKey = normalizeChatKey(b.recipient || '');
    if (aKey === activeRecipient && bKey !== activeRecipient) return -1;
    if (bKey === activeRecipient && aKey !== activeRecipient) return 1;
    return 0;
  }).slice(0, OUTBOX_SENDS_PER_LOOP);

  let sent = 0;
  for (const item of orderedItems) {
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

async function getUsableWhatsappPage(context) {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  const whatsappPage = pages.find((candidate) => {
    try {
      return candidate.url().includes('web.whatsapp.com');
    } catch (_error) {
      return false;
    }
  });
  const page = whatsappPage || pages[0] || await context.newPage();
  await ensureWhatsappTab(page);
  return page;
}

async function recoverWhatsappPage(context, previousPage) {
  try {
    if (previousPage && !previousPage.isClosed()) {
      await ensureWhatsappTab(previousPage);
      await previousPage.waitForTimeout(250);
      await detectWhatsappReady(previousPage);
      return previousPage;
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

  let page = await getUsableWhatsappPage(context);

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
  let lastRecentSweep = 0;
  let consecutiveLoopErrors = 0;

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
      const sentBeforeSweep = await processOutbox(page);
      let recentSweepResult = { scanned: 0, processed: 0 };
      let sentAfterSweep = 0;
      if (now - lastRecentSweep >= RECENT_CHAT_SWEEP_MS) {
        recentSweepResult = await ingestRecentChatsSweep(page);
        lastRecentSweep = Date.now();
        if (recentSweepResult.processed) {
          sentAfterSweep = await processOutbox(page);
        }
      }
      const sentCount = sentBeforeSweep + sentAfterSweep;
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
            processed_recent_sweep: recentSweepResult.processed || 0,
            scanned_recent_sweep: recentSweepResult.scanned || 0,
            sent_outbound: sentCount || 0
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
