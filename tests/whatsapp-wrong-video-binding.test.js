'use strict';

/**
 * 24 Oct 2026. A forwarded burst reused the previous WhatsApp viewer's video.
 * Bulindo 25f945a9 landed on Mbalwa 28e43441 and 2b9bef0b. Mengo 82b7baa8 and
 * Kitukutwe a0600410 received one clip. Kulambiro deb68eb2 and Kyanja 87543468
 * were swapped. Capture must stay on the bubble that was clicked, and a video
 * hash already stored for the same phone or batch must not be attached again.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.WHATSAPP_WEB_BRIDGE_TOKEN = process.env.WHATSAPP_WEB_BRIDGE_TOKEN || 'test-bridge-token';
const copilot = require('../scripts/whatsapp-web-copilot');
const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const copilotSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const propertiesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');

function mp4(marker) {
  const buffer = Buffer.alloc(32);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write(String(marker || 'A'), 16, 'ascii');
  return buffer;
}

function dataUrlOf(buffer) {
  return `data:video/mp4;base64,${buffer.toString('base64')}`;
}

class MiniEl {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.rect = attrs.rect || { width: 40, height: 40, left: 0, top: 0 };
    this.naturalWidth = attrs.naturalWidth || 0;
    this.naturalHeight = attrs.naturalHeight || 0;
    this.videoWidth = attrs.videoWidth || 0;
    this.videoHeight = attrs.videoHeight || 0;
    this.currentSrc = attrs.src || '';
    this.src = attrs.src || '';
    this.href = attrs.href || '';
    this.className = '';
    this.clicked = false;
    children.forEach((child) => this.append(child));
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => matchesSelector(element, selector));
  }

  closest(selector) {
    return matchesSelector(this, selector) ? this : null;
  }

  dispatchEvent() {}

  click() {
    this.clicked = true;
    if (typeof this.attrs.onClick === 'function') this.attrs.onClick(this);
  }
}

function descendants(root) {
  const found = [];
  const visit = (node) => {
    node.children.forEach((child) => {
      found.push(child);
      visit(child);
    });
  };
  visit(root);
  return found;
}

function matchesSelector(element, selector) {
  return String(selector || '').split(',').some((part) => matchesCompound(element, part.trim()));
}

function splitCompound(selector) {
  const parts = [];
  let current = '';
  let bracket = 0;
  for (const char of String(selector || '')) {
    if (char === '[') bracket += 1;
    if (char === ']') bracket = Math.max(0, bracket - 1);
    if (/\s/.test(char) && bracket === 0) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesCompound(element, selector) {
  if (!selector) return false;
  const steps = splitCompound(selector);
  if (steps.length > 1) {
    const last = steps[steps.length - 1];
    if (!matchesSimple(element, last)) return false;
    let parent = element.parentElement;
    const ancestor = steps[steps.length - 2];
    while (parent) {
      if (matchesSimple(parent, ancestor)) return true;
      parent = parent.parentElement;
    }
    return false;
  }
  return matchesSimple(element, selector);
}

function matchesSimple(element, token) {
  const tagMatch = token.match(/^[a-z]+/i);
  const tag = tagMatch ? tagMatch[0].toLowerCase() : '';
  if (tag && element.tagName.toLowerCase() !== tag) return false;
  const attrs = [...token.matchAll(/\[([^\]=~|^$*]+)(?:([~|^$*]?=)"([^"]*)"(\s+i)?)?\]/g)];
  if (!tag && !attrs.length) return false;
  return attrs.every((match) => attributeMatches(element, match[1], match[2] || '', match[3] || '', Boolean(match[4])));
}

function attributeMatches(element, name, operator, expected, insensitive) {
  const value = element.getAttribute(name);
  if (value == null) return false;
  const left = insensitive ? String(value).toLowerCase() : String(value);
  const right = insensitive ? expected.toLowerCase() : expected;
  if (!operator) return true;
  if (operator === '=') return left === right;
  if (operator === '*=') return left.includes(right);
  if (operator === '^=') return left.startsWith(right);
  return false;
}

function miniDocument(children) {
  const root = new MiniEl('html', {}, children);
  return {
    root,
    querySelectorAll(selector) {
      return [root, ...descendants(root)].filter((element) => matchesSelector(element, selector));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  };
}

async function withDocument(document, run) {
  const previous = global.document;
  const previousMouse = global.MouseEvent;
  global.document = document;
  global.MouseEvent = class MouseEvent {
    constructor() {}
  };
  try {
    return await run();
  } finally {
    global.document = previous;
    global.MouseEvent = previousMouse;
  }
}

function responseFor({ url, buffer, startTime, contentType = 'video/mp4', ok = true }) {
  return {
    ok: () => ok,
    url: () => url,
    headers: () => ({ 'content-type': contentType }),
    body: async () => buffer,
    request: () => ({
      timing: () => ({ startTime }),
      resourceType: () => 'media'
    })
  };
}

function networkPage({ document, responsesForClick }) {
  const listeners = [];
  const emptyLocator = {
    async count() { return 0; },
    nth() { return emptyLocator; },
    async getAttribute() { return ''; },
    async scrollIntoViewIfNeeded() {},
    async hover() {},
    async screenshot() { return null; },
    async evaluate() { return false; },
    async isVisible() { return false; },
    async click() { return false; }
  };
  return {
    async evaluate(fn, arg) {
      return withDocument(document, () => fn(arg));
    },
    locator() { return emptyLocator; },
    on(event, listener) {
      if (event === 'response') listeners.push(listener);
    },
    off(event, listener) {
      if (event !== 'response') return;
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    async waitForTimeout() {
      const batch = responsesForClick.splice(0);
      batch.forEach((response) => listeners.forEach((listener) => listener(response)));
    }
  };
}

test('a burst of three videos does not read the viewer the previous click left open', async () => {
  const videoA = mp4('BULINDO');
  const videoB = mp4('MBALWA1');
  const videoC = mp4('MBALWA2');
  const state = { viewerOpen: false };
  const viewerVideo = new MiniEl('video', {
    src: 'https://mmg.whatsapp.net/bulindo.mp4',
    videoWidth: 640,
    videoHeight: 360,
    rect: { width: 640, height: 360, left: 0, top: 0 }
  });
  const viewer = new MiniEl('div', {
    role: 'dialog',
    'data-testid': 'media-viewer',
    rect: { width: 900, height: 700, left: 0, top: 0 }
  }, [viewerVideo]);
  const bubbles = ['msg-a', 'msg-b', 'msg-c'].map((id) => new MiniEl('div', { 'data-id': id, rect: { width: 280, height: 180, left: 0, top: 0 } }, [
    new MiniEl('button', {
      'aria-label': 'Play video',
      rect: { width: 48, height: 48, left: 0, top: 0 },
      onClick: () => { state.viewerOpen = true; }
    }),
    new MiniEl('span', { 'data-testid': 'video-pip' })
  ]));
  const document = miniDocument([]);
  const mount = () => {
    document.root.children = state.viewerOpen ? [viewer, ...bubbles] : bubbles;
    document.root.children.forEach((child) => { child.parentElement = document.root; });
  };
  mount();
  const queued = {
    'msg-a': [responseFor({ url: 'https://mmg.whatsapp.net/bulindo.mp4', buffer: videoA, startTime: Date.now() + 5000 })],
    'msg-b': [responseFor({ url: 'https://mmg.whatsapp.net/bulindo.mp4', buffer: videoA, startTime: Date.now() + 5000 })],
    'msg-c': [responseFor({ url: 'https://mmg.whatsapp.net/mbalwa.mp4', buffer: videoC, startTime: Date.now() + 5000 })]
  };
  const originalDocument = {
    querySelectorAll: (...args) => {
      mount();
      return document.querySelectorAll(...args);
    },
    querySelector: (...args) => {
      mount();
      return document.querySelector(...args);
    }
  };
  copilot.beginChatVideoCaptureRun('256700000001');
  const ids = ['msg-a', 'msg-b', 'msg-c'];
  const buffers = [videoA, videoB, videoC];
  const results = [];
  for (let index = 0; index < ids.length; index += 1) {
    const page = networkPage({
      document: originalDocument,
      responsesForClick: queued[ids[index]]
    });
    results.push(await withDocument(originalDocument, () => copilot.hydrateVideoSnapshot(page, {
      chatKey: '256700000001',
      messageId: ids[index],
      mediaType: 'media',
      text: '[media]',
      mediaPreviews: []
    })));
    buffers[index] = buffers[index];
  }
  assert.equal(results[0].mediaPreviewError || '', '');
  assert.equal(results[0].mediaPreviews[0].dataUrl, dataUrlOf(videoA));
  assert.equal(state.viewerOpen, true);
  for (const result of results.slice(1)) {
    assert.equal(result.mediaPreviewError, 'video_bytes_unavailable_viewer_still_open');
    assert.deepStrictEqual(result.mediaPreviews, []);
    assert.equal(JSON.stringify(result).includes(videoA.toString('base64')), false);
    assert.equal(JSON.stringify(result).includes(videoC.toString('base64')), false);
  }
});

test('network capture keeps a response that starts after the click and belongs to the opened viewer', async () => {
  const clickedAt = 1_700_000_000_000;
  const opened = { sourceUrls: ['https://mmg.whatsapp.net/after.mp4'] };
  const before = responseFor({ url: opened.sourceUrls[0], buffer: mp4('BEFORE'), startTime: clickedAt - 500 });
  const stranger = responseFor({ url: 'https://mmg.whatsapp.net/other.mp4', buffer: mp4('OTHER'), startTime: clickedAt + 50 });
  const after = responseFor({ url: opened.sourceUrls[0], buffer: mp4('AFTER'), startTime: clickedAt + 40 });
  const missingTiming = responseFor({ url: opened.sourceUrls[0], buffer: mp4('NOTIME'), startTime: 0 });
  assert.equal(copilot.videoResponseStartedAfter(before, clickedAt), false);
  assert.equal(copilot.videoResponseStartedAfter(missingTiming, clickedAt), false);
  assert.equal(copilot.videoResponseBelongsToOpenedViewer(stranger, opened), false);
  assert.equal(copilot.videoResponseStartedAfter(after, clickedAt), true);
  assert.equal(copilot.videoResponseBelongsToOpenedViewer(after, opened), true);

  const good = mp4('GOOD');
  const stale = mp4('STALE');
  const viewer = new MiniEl('div', {
    role: 'dialog',
    'data-testid': 'media-viewer',
    rect: { width: 900, height: 700, left: 0, top: 0 }
  }, [new MiniEl('video', { src: 'https://mmg.whatsapp.net/good.mp4', videoWidth: 320, videoHeight: 240, rect: { width: 320, height: 240, left: 0, top: 0 } })]);
  const bubble = new MiniEl('div', { 'data-id': 'msg-good' }, [
    new MiniEl('button', { 'aria-label': 'Play video' }),
    new MiniEl('span', { 'data-testid': 'video-pip' })
  ]);
  let openedViewer = false;
  bubble.children[0].attrs.onClick = () => { openedViewer = true; };
  const document = miniDocument([bubble]);
  const liveDocument = {
    querySelectorAll: (selector) => {
      document.root.children = openedViewer ? [bubble, viewer] : [bubble];
      document.root.children.forEach((child) => { child.parentElement = document.root; });
      return document.querySelectorAll(selector);
    },
    querySelector: (selector) => liveDocument.querySelectorAll(selector)[0] || null
  };
  const page = networkPage({
    document: liveDocument,
    responsesForClick: [
      responseFor({ url: 'https://mmg.whatsapp.net/good.mp4', buffer: stale, startTime: Date.now() - 10000 }),
      responseFor({ url: 'https://mmg.whatsapp.net/stranger.mp4', buffer: mp4('NO'), startTime: Date.now() + 10000 }),
      responseFor({ url: 'https://mmg.whatsapp.net/good.mp4', buffer: good, startTime: Date.now() + 10000 })
    ]
  });
  const preview = await withDocument(liveDocument, () => copilot.captureVideoSnapshotFromNetwork(page, 'msg-good'));
  assert.equal(preview.dataUrl, dataUrlOf(good));
  assert.equal(viewer.getAttribute('data-makaug-capture-for'), 'msg-good');
});

test('download, DOM and key-frame capture ignore a page-level video', async () => {
  const dialogBuffer = mp4('DIALOG');
  const bubbleBuffer = mp4('BUBBLE');
  const dialogDownload = { clicked: false };
  const bubble = {
    attrs: { 'data-id': 'msg-bound', 'data-testid': '' },
    download: null
  };
  const pageDownloads = new Map();
  function locator(selector, scope) {
    const selected = resolveLocator(selector, scope);
    return {
      async count() { return selected.length; },
      nth(index) { return elementHandle(selected[index]); },
      first() { return elementHandle(selected[0]); },
      getByRole(role, options = {}) {
        return locator(`role=${role}:${options.name || ''}`, selected);
      },
      locator(next) { return locator(next, selected); },
      async isVisible() { return selected.length > 0 && selected[0].visible !== false; },
      async click() {
        if (selected[0]) selected[0].clicked = true;
        return true;
      },
      async scrollIntoViewIfNeeded() {},
      async hover() {},
      async getAttribute(name) { return selected[0]?.attrs?.[name] || ''; },
      async evaluate() { return false; },
      async screenshot() { return null; }
    };
  }
  function elementHandle(node) {
    return locator('', node ? [node] : []);
  }
  function resolveLocator(selector, scope) {
    const roots = scope || [bubble, { attrs: { role: 'dialog' }, pageLevel: true, clicked: false, visible: true, onClick: () => { dialogDownload.clicked = true; } }];
    if (!selector) return roots;
    if (selector.startsWith('role=button:')) {
      const pattern = selector.slice('role=button:'.length);
      return roots.flatMap((node) => (node.buttons || []).filter((button) => pattern && button.name.test(pattern)));
    }
    if (selector.includes('download')) {
      return roots.flatMap((node) => node.buttons || []);
    }
    if (selector.includes('data-makaug-capture-for')) return [];
    if (selector.includes('data-id')) return [bubble];
    return [];
  }
  const page = {
    locator,
    async waitForEvent() {
      return {
        suggestedFilename: () => 'bubble.mp4',
        async createReadStream() {
          return (async function* stream() { yield bubbleBuffer; }());
        }
      };
    },
    async waitForTimeout() {},
    async evaluate() { return null; }
  };
  bubble.buttons = [];
  const missed = await copilot.captureVideoSnapshotFromDownload(page, 'msg-bound');
  assert.equal(missed, null);
  assert.equal(dialogDownload.clicked, false);

  bubble.buttons = [{ name: /download/i, visible: true, clicked: false, attrs: {} }];
  page.waitForEvent = async () => ({
    suggestedFilename: () => 'bubble.mp4',
    async createReadStream() {
      return (async function* stream() { yield bubbleBuffer; }());
    }
  });
  const downloaded = await copilot.captureVideoSnapshotFromDownload(page, 'msg-bound');
  assert.equal(downloaded.dataUrl, dataUrlOf(bubbleBuffer));
  assert.equal(downloaded.dataUrl.includes(dialogBuffer.toString('base64')), false);

  const other = new MiniEl('video', {
    src: 'https://mmg.whatsapp.net/previous.mp4',
    videoWidth: 640,
    videoHeight: 360,
    rect: { width: 400, height: 300, left: 0, top: 0 }
  });
  const dialog = new MiniEl('div', {
    role: 'dialog',
    rect: { width: 900, height: 700, left: 0, top: 0 }
  }, [other]);
  const target = new MiniEl('div', { 'data-id': 'msg-dom' }, []);
  const document = miniDocument([target, dialog]);
  const frames = await withDocument(document, () => copilot.captureVideoKeyFrames({
    async evaluate(fn, arg) { return fn(arg); }
  }, 'msg-dom', 5));
  assert.deepStrictEqual(frames, []);
  assert.equal(other.clicked, false);
});

test('a chat run reports video_bytes_reused_from_other_message and does not send the bytes', async () => {
  const shared = mp4('SHARED');
  const viewerFor = {};
  function bubble(id) {
    return new MiniEl('div', { 'data-id': id }, [
      new MiniEl('button', {
        'aria-label': 'Play video',
        onClick() { viewerFor[id] = true; }
      }),
      new MiniEl('span', { 'data-testid': 'video-pip' })
    ]);
  }
  const first = bubble('msg-1');
  const second = bubble('msg-2');
  const document = miniDocument([first, second]);
  const viewer = new MiniEl('div', {
    role: 'dialog',
    'data-testid': 'media-viewer',
    rect: { width: 800, height: 600, left: 0, top: 0 }
  }, [new MiniEl('video', {
    src: 'https://mmg.whatsapp.net/shared.mp4',
    videoWidth: 320,
    videoHeight: 180,
    rect: { width: 320, height: 180, left: 0, top: 0 }
  })]);
  const liveDocument = {
    querySelectorAll(selector) {
      const open = viewerFor['msg-1'] || viewerFor['msg-2'];
      document.root.children = open ? [first, second, viewer] : [first, second];
      document.root.children.forEach((child) => { child.parentElement = document.root; });
      if (/Close/i.test(selector)) return [];
      return document.querySelectorAll(selector);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  copilot.beginChatVideoCaptureRun('256700000009');
  const pageFor = (id) => networkPage({
    document: liveDocument,
    responsesForClick: [responseFor({
      url: 'https://mmg.whatsapp.net/shared.mp4',
      buffer: shared,
      startTime: Date.now() + 8000
    })]
  });
  const firstResult = await withDocument(liveDocument, () => copilot.hydrateVideoSnapshot(pageFor('msg-1'), {
    chatKey: '256700000009',
    messageId: 'msg-1',
    mediaType: 'media',
    mediaPreviews: []
  }));
  viewerFor['msg-1'] = false;
  viewer.removeAttribute('data-makaug-capture-for');
  const secondResult = await withDocument(liveDocument, () => copilot.hydrateVideoSnapshot(pageFor('msg-2'), {
    chatKey: '256700000009',
    messageId: 'msg-2',
    mediaType: 'media',
    mediaUrl: 'whatsapp-web://msg-2',
    text: '[media]',
    direction: 'in',
    mediaPreviews: []
  }));
  assert.equal(firstResult.mediaPreviews[0].kind, 'video');
  assert.equal(secondResult.mediaPreviewError, 'video_bytes_reused_from_other_message');
  assert.equal(secondResult.videoBytesReusedFromMessageId, 'msg-1');
  assert.deepStrictEqual(secondResult.mediaPreviews, []);

  const posts = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    posts.push(JSON.parse(options.body));
    return { ok: true, status: 200, headers: { get: () => '' }, json: async () => ({ ok: true }) };
  };
  try {
    const posted = await copilot.ingestSnapshot({
      snapshot: {
        ...secondResult,
        chatKey: '256700000009',
        text: '[media]',
        direction: 'in',
        mediaType: 'media',
        mediaUrl: 'whatsapp-web://msg-2',
        whatsappSentAt: new Date(2026, 9, 24, 10, 15, 4).toISOString(),
        quotedMessageId: 'caption-mengo'
      },
      row: { title: '256700000009', preview: '' },
      source: 'active_chat'
    });
    assert.equal(posted.processed, 1);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(posts.length, 1);
  assert.equal(posts[0].metadata.media_preview_error, 'video_bytes_reused_from_other_message');
  assert.equal(posts[0].metadata.video_bytes_reused_from_message_id, 'msg-1');
  assert.deepStrictEqual(posts[0].metadata.media_previews, []);
  assert.equal(posts[0].metadata.quoted_message_id, 'caption-mengo');
  assert.equal(posts[0].metadata.whatsapp_message_id, 'msg-2');
  assert.equal(posts[0].created_at, posts[0].metadata.whatsapp_sent_at);
});

test('send time and quoted message id are read from the WhatsApp bubble', () => {
  const expected = new Date(2026, 9, 24, 10, 15, 4).toISOString();
  assert.equal(
    copilot.parseWhatsappMessageSentAt('[10:15:04 AM, 24/10/2026] Agent: '),
    expected
  );
  assert.equal(
    copilot.parseWhatsappMessageSentAt('[10:15 AM, 24/10/2026] Agent: '),
    new Date(2026, 9, 24, 10, 15, 0).toISOString()
  );
  const root = new MiniEl('div', { 'data-id': 'msg-video' }, [
    new MiniEl('div', { 'data-testid': 'quoted-message', 'data-id': 'caption-82b7' })
  ]);
  assert.equal(copilot.quotedWhatsappMessageId(root, 'msg-video'), 'caption-82b7');
  const paired = copilot.attachWhatsappPairingFields({
    prePlainText: '[10:15:04 AM, 24/10/2026] Agent: ',
    quotedMessageId: 'caption-82b7',
    timestampLabel: '10:15 AM'
  });
  assert.equal(paired.whatsappSentAt, expected);
  assert.equal(paired.quotedMessageId, 'caption-82b7');
});

test('bridge capture paths no longer fall back to whatever video is on the page', () => {
  const download = copilotSource.slice(
    copilotSource.indexOf('async function captureVideoSnapshotFromDownload'),
    copilotSource.indexOf('async function captureVideoMessageScreenshot')
  );
  const frames = copilotSource.slice(
    copilotSource.indexOf('async function captureVideoKeyFrames'),
    copilotSource.indexOf('async function captureVideoPosterFrame')
  );
  const dom = copilotSource.slice(
    copilotSource.indexOf('async function hydrateVideoSnapshot'),
    copilotSource.indexOf('async function hydrateMediaSnapshot')
  );
  assert.equal(copilotSource.includes('visibleVideo'), false);
  assert.equal(download.includes('[role="dialog"]'), false);
  assert.equal(frames.includes('[role="dialog"]'), false);
  assert.equal(dom.includes('visibleVideo'), false);
  assert.match(copilotSource, /if \(closed !== true\)/);
  assert.match(copilotSource, /videoResponseStartedAfter/);
  assert.match(copilotSource, /videoResponseBelongsToOpenedViewer/);
  assert.match(copilotSource, /video_bytes_reused_from_other_message/);
  assert.match(copilotSource, /beginChatVideoCaptureRun/);
});

const MBALWA = '28e43441-0000-4000-8000-000000000028';
const BULINDO = '25f945a9-0000-4000-8000-000000000025';
const VIDEO_HASH = 'a'.repeat(64);
const PHOTO_HASH = 'b'.repeat(64);
const FRAME_HASH = 'c'.repeat(64);

function videoItem(sha = VIDEO_HASH) {
  return {
    url: `https://cdn.makaug.com/${sha}.mp4`,
    sha256: sha,
    mimeType: 'video/mp4',
    kind: 'video',
    name: 'whatsapp-property-video.mp4'
  };
}

function photoItem(sha = PHOTO_HASH) {
  return {
    url: `https://cdn.makaug.com/${sha}.jpg`,
    sha256: sha,
    mimeType: 'image/jpeg',
    kind: 'image',
    name: `${sha}.jpg`,
    publicEligible: true
  };
}

function frameItem() {
  return {
    url: 'https://cdn.makaug.com/frame.jpg',
    sha256: FRAME_HASH,
    mimeType: 'image/jpeg',
    kind: 'image',
    name: 'whatsapp-video-key-frame-1.jpg',
    publicEligible: true
  };
}

test('a video already on the same phone or batch is held with a note and is not attached', async () => {
  const updates = [];
  const inserted = [];
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  db.query = async (sql, params = []) => {
    if (/p\.extra_fields -> 'media_sha256'/.test(sql)) {
      return { rows: [{ id: BULINDO, inquiry_reference: 'MK-BULINDO', sha256: VIDEO_HASH }] };
    }
    if (/jsonb_array_elements_text\(extra_fields -> 'media_sha256'\)/.test(sql)) {
      return { rows: [{ sha256: VIDEO_HASH }, { sha256: PHOTO_HASH }] };
    }
    if (/SELECT id, extra_fields/.test(sql)) {
      return { rows: [{ id: params[0], extra_fields: { media_sha256: [], video_urls: [] } }] };
    }
    if (/FROM property_images/.test(sql)) return { rows: [{ count: 1, primary_image_url: 'https://cdn.makaug.com/own.jpg' }] };
    if (/UPDATE properties/.test(sql)) {
      updates.push(JSON.parse(params[1]));
      return { rows: [] };
    }
    if (/INSERT INTO property_images/.test(sql)) {
      inserted.push(params[1]);
      return { rows: [] };
    }
    return { rows: [{ id: params[0] || MBALWA }] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  try {
    const claims = await route.employeeVideoReuseOnSibling({
      propertyId: MBALWA,
      phone: '+256700000001',
      batchPropertyIds: [BULINDO],
      storedMedia: [videoItem()]
    });
    assert.equal(route.employeeVideoReuseNote(claims), 'this video is also on MK-BULINDO');
    const decision = route.decideEmployeeVideoAttachment({
      storedMedia: [videoItem(), frameItem(), photoItem()],
      siblingClaims: claims,
      claimedElsewhere: new Set([VIDEO_HASH, PHOTO_HASH]),
      selfIntake: false
    });
    assert.equal(decision.note, 'this video is also on MK-BULINDO');
    assert.equal(decision.recovery, true);
    assert.equal(decision.media.some((item) => item.kind === 'video'), false);
    assert.equal(decision.media.some((item) => item.sha256 === FRAME_HASH), false);
    assert.equal(decision.media.some((item) => item.sha256 === PHOTO_HASH), true);

    const keptPhoto = route.decideEmployeeVideoAttachment({
      storedMedia: [photoItem()],
      siblingClaims: [],
      claimedElsewhere: new Set([PHOTO_HASH]),
      selfIntake: false
    });
    assert.equal(keptPhoto.media.length, 1);
    assert.equal(keptPhoto.recovery, false);

    const attachment = await route.attachEmployeeReviewMedia({
      propertyId: MBALWA,
      phone: '+256700000001',
      batchPropertyIds: [BULINDO],
      storedMedia: [videoItem(), frameItem()]
    });
    assert.equal(attachment.attached, 0);
    assert.equal(updates.at(-1).media_reuse_note, 'this video is also on MK-BULINDO');
    assert.equal(updates.at(-1).video_recovery_required, true);
    assert.equal(updates.at(-1).video_recovery_reason, 'video_bytes_reused_from_other_message');
    assert.ok(updates.at(-1).media_also_on_other_property.includes(VIDEO_HASH));
    assert.equal(inserted.includes('https://cdn.makaug.com/frame.jpg'), false);
  } finally {
    db.query = originalQuery;
    db.getClient = originalGetClient;
  }
});

test('creating a listing keeps a reused photo and refuses the reused video', async () => {
  const inserts = [];
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  db.query = async (sql, params = []) => {
    if (/p\.extra_fields -> 'media_sha256'/.test(sql)) {
      return { rows: [{ id: BULINDO, inquiry_reference: 'MK-BULINDO', sha256: VIDEO_HASH }] };
    }
    if (/jsonb_array_elements_text\(extra_fields -> 'media_sha256'\)/.test(sql)) {
      return { rows: [{ sha256: VIDEO_HASH }, { sha256: PHOTO_HASH }] };
    }
    if (/INSERT INTO properties/.test(sql)) {
      inserts.push(JSON.parse(params[20]));
      return { rows: [{ id: MBALWA, inquiry_reference: 'MK-MBALWA' }] };
    }
    return { rows: [{ id: MBALWA }] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  try {
    const propertyId = await route.createEmployeeReviewProperty({
      phone: '+256700000001',
      inboundMessageId: 'msg-mbalwa',
      caption: '3 bedroom house for sale in Mbalwa Wakiso 250m',
      facts: {
        listingType: 'sale',
        price: 250000000,
        locationPatch: { area: 'Mbalwa', district: 'Wakiso' },
        bedroomDraft: { bedrooms: 3 },
        priceMetadata: {}
      },
      storedMedia: [videoItem(), frameItem(), photoItem()],
      sessionData: { property_ids: [BULINDO], whatsapp_agent_self_intake: false }
    });
    assert.equal(propertyId, MBALWA);
    const extra = inserts[0];
    assert.equal(extra.media_reuse_note, 'this video is also on MK-BULINDO');
    assert.equal(extra.video_recovery_required, true);
    assert.equal(extra.video_recovery_reason, 'video_bytes_reused_from_other_message');
    assert.equal(extra.video_urls.length, 0);
    assert.equal(extra.media_sha256.includes(VIDEO_HASH), false);
    assert.equal(extra.media_sha256.includes(PHOTO_HASH), true);
  } finally {
    db.query = originalQuery;
    db.getClient = originalGetClient;
  }
});

test('caption pairing uses the quoted message, then send time, then arrival order', () => {
  const index = [
    { caption: 'House in Mengo 400m', whatsappMessageId: 'caption-mengo', sentAt: '2026-10-24T07:00:00.000Z' },
    { caption: 'Plot in Kitukutwe 80m', whatsappMessageId: 'caption-kitukutwe', sentAt: '2026-10-24T07:05:00.000Z' }
  ];
  assert.equal(route.pairEmployeeCaptionForMedia({
    cleanBody: 'Own caption in Kulambiro 90m',
    pendingCaption: 'House in Mengo 400m',
    quotedMessageId: 'caption-kitukutwe',
    captionIndex: index
  }), 'Own caption in Kulambiro 90m');
  assert.equal(route.pairEmployeeCaptionForMedia({
    placeholderBody: true,
    cleanBody: '[media]',
    pendingCaption: 'Plot in Kitukutwe 80m',
    quotedMessageId: 'caption-mengo',
    captionIndex: index
  }), 'House in Mengo 400m');
  assert.equal(route.pairEmployeeCaptionForMedia({
    placeholderBody: true,
    cleanBody: '[media]',
    pendingCaption: 'Plot in Kitukutwe 80m',
    whatsappSentAt: '2026-10-24T07:00:30.000Z',
    captionIndex: index
  }), 'House in Mengo 400m');
  assert.equal(route.pairEmployeeCaptionForMedia({
    placeholderBody: true,
    cleanBody: '[media]',
    pendingCaption: 'Plot in Kitukutwe 80m',
    captionIndex: index
  }), 'Plot in Kitukutwe 80m');

  const data = {
    pending_property_caption: 'Plot in Kitukutwe 80m',
    pending_property_media: [],
    pending_property_queue: [{ caption: 'House in Mengo 400m', media: [], inboundMessageId: 'caption-mengo' }],
    employee_caption_index: index
  };
  const paired = route.applyBridgeCaptionPairing(data, {
    placeholderBody: true,
    cleanBody: '[media]',
    quotedMessageId: 'caption-mengo'
  });
  assert.equal(paired, 'House in Mengo 400m');
  assert.equal(data.pending_property_caption, 'House in Mengo 400m');
  assert.equal(data.pending_property_queue[0].caption, 'Plot in Kitukutwe 80m');
});

test('staff review and approval blockers show the reused-video note', () => {
  assert.match(appSource, /function staffMediaReuseWarningHtml/);
  assert.match(appSource, /data-media-reuse-note/);
  assert.match(appSource, /data-media-also-on-other-property/);
  const card = appSource.slice(appSource.indexOf('function staffReviewQueueCardHtml'), appSource.indexOf('function staffReviewQueueLoadingHtml'));
  const preview = appSource.slice(appSource.indexOf('function renderStaffListingPreviewModal'), appSource.indexOf('function staffPreviewRememberTitle') > -1 ? appSource.indexOf('function closeStaffListingPreview') : appSource.indexOf('function renderStaffListingPreviewModal') + 8000);
  assert.match(card, /staffMediaReuseWarningHtml/);
  assert.match(preview, /staffMediaReuseWarningHtml/);
  const banner = appSource.slice(appSource.indexOf('function showApprovalBlockerBanner'), appSource.indexOf('function dismissApprovalBlockerBanner'));
  assert.match(banner, /media_reuse_note/);
  assert.match(banner, /media_also_on_other_property/);
  assert.match(propertiesSource, /code: 'media_also_on_other_property'/);
  assert.match(propertiesSource, /media_reuse_note: reuseNote/);
  assert.match(routeSource, /this video is also on/);
  assert.match(routeSource, /video_bytes_reused_from_other_message/);
});
