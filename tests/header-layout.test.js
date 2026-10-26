'use strict';

// Header layout guard: the top navigation must never overlap itself, spill
// past the header or hide the "List Property" CTA in any of the 9 site
// languages. Runs the real server.js and real page in headless Chrome at the
// widths people actually use. API calls are stubbed and external requests are
// blocked, so nothing here touches the live site or a database.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const LANGUAGES = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const WIDTHS = [390, 768, 1024, 1280, 1440, 1600, 1920];
const LISTING_ID = '9f1c2a7e-4b3d-4c8e-9a10-1e2f3a4b5c6d';
const PAGES = [
  { name: 'homepage', path: '/' },
  { name: 'listing', path: `/property/${LISTING_ID}`, detail: true }
];
const LISTING = {
  id: LISTING_ID,
  listing_type: 'sale',
  title: 'Three bedroom house for sale in Kyanja, Kampala',
  description: 'Three bedroom family house on a quiet road in Kyanja with a garden and parking.',
  district: 'Kampala',
  area: 'Kyanja',
  price: '450000000',
  price_period: 'once',
  price_currency: 'UGX',
  bedrooms: 3,
  bathrooms: 2,
  property_type: 'house',
  status: 'approved',
  listing_origin: 'agent',
  lister_type: 'agent',
  lister_name: 'Kyanja Homes',
  agent_name: 'Kyanja Homes',
  amenities: [],
  images: [],
  extra_fields: {},
  latitude: 0.384,
  longitude: 32.596,
  created_at: '2026-10-20T08:00:00.000Z',
  published_at: '2026-10-20T08:00:00.000Z'
};
function listingShell() {
  const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
  const { applyCountryHtml } = require('../packages/shared-country-core');
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return applyCountryHtml(sanitizePublicHtml(source, { pathname: `/property/${LISTING_ID}` }), 'UG', { homepage: false });
}
// Font Awesome is blocked (external), so give icons their real footprint.
const ICON_CSS = '.fa,.fas,.far,.fab,.fa-solid,.fa-regular{display:inline-block;width:1.25em;height:1em}';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function status(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, headers: { Host: 'makaug.com' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      MEMORY_LOG: 'off',
      STARTUP_DATA_REPAIRS: 'off',
      DATABASE_URL: '',
      // Production shows the Short Term link; include it so the nav is as full as live.
      SHORT_TERM_ENABLED: 'true',
      EVENT_LOOP_LAG_LOG: 'off'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  for (let i = 0; i < 240; i += 1) {
    try {
      if (await status(port, '/') === 200) return { port, child };
    } catch (_error) {}
    if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`server did not start: ${stderr}`);
}

async function stubNetwork(context, origin) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === `/property/${LISTING_ID}`) {
      // server.js renders this page only after a database lookup. Build the
      // same route shell with the same sanitizer and country core it uses;
      // the client router then renders the listing from the stubbed API.
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: listingShell() });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === `/api/properties/${LISTING_ID}`) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: LISTING }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
  });
}

// Everything visible in the header row, measured in the page.
function measure() {
  const nav = document.getElementById('desktop-primary-nav');
  const header = document.getElementById('site-header-row') || nav.parentElement;
  const actions = document.getElementById('nav-actions') || document.getElementById('nav-list-btn').parentElement;
  const cta = document.getElementById('nav-list-btn');
  const toggle = document.getElementById('mob-toggle');
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const label = (el) => el.id || (el.hasAttribute('data-harvest-public-submission') && 'paste-link-btn') || (el.querySelector('[id]')?.id) || el.getAttribute('data-testid') || el.tagName.toLowerCase();
  const parts = [];
  if (shown(document.getElementById('brand-home-link'))) parts.push(document.getElementById('brand-home-link'));
  if (shown(nav)) {
    for (const el of nav.children) {
      if (!shown(el)) continue;
      parts.push(el.id === 'nav-more' ? document.getElementById('nav-more-btn') : el);
    }
  }
  for (const el of actions.children) if (shown(el)) parts.push(el);
  const items = parts.map((el) => {
    const link = el.matches('a,button') ? el : el.querySelector('a,button') || el;
    return {
      id: label(el),
      box: box(el),
      text: (link.textContent || '').replace(/\s+/g, ' ').trim(),
      clipped: link.scrollWidth > link.clientWidth + 1 && getComputedStyle(link).overflow !== 'visible',
      textOverflow: link.scrollWidth > Math.ceil(link.getBoundingClientRect().width) + 1
    };
  });
  const moreMenu = document.getElementById('nav-more-menu');
  return {
    lang: document.documentElement.lang,
    dir: document.documentElement.dir || 'ltr',
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerBar: (() => { const bar = header.closest('nav'); return { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth }; })(),
    header: box(header),
    nav: shown(nav) ? box(nav) : null,
    navScroll: shown(nav) ? { scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth } : null,
    navShown: shown(nav),
    toggleShown: shown(toggle),
    cta: shown(cta) ? { box: box(cta), text: cta.textContent.trim(), scrollWidth: cta.scrollWidth, clientWidth: cta.clientWidth } : null,
    more: shown(document.getElementById('nav-more')) ? Array.from(moreMenu.querySelectorAll('a')).map((a) => a.textContent.trim()) : [],
    items
  };
}

function problemsFor(where, m) {
  const out = [];
  const EPS = 0.5;
  const tag = `${where} [${m.lang} ${m.viewport}px]`;
  // Header only: other page sections are covered by their own tests.
  if (m.headerBar.scrollWidth > m.headerBar.clientWidth + 1 || m.headerBar.clientWidth > m.viewport) out.push(`${tag}: header is wider than the screen (${m.headerBar.scrollWidth} > ${m.headerBar.clientWidth})`);
  if (!m.navShown && !m.toggleShown) out.push(`${tag}: neither the desktop nav nor the menu button is visible`);
  if (m.navScroll && m.navScroll.scrollWidth > m.navScroll.clientWidth + 1) out.push(`${tag}: nav content is wider than the nav (${m.navScroll.scrollWidth} > ${m.navScroll.clientWidth})`);
  for (const item of m.items) {
    const b = item.box;
    if (b.left < m.header.left - EPS || b.right > m.header.right + EPS || b.left < -EPS || b.right > m.viewport + EPS) {
      out.push(`${tag}: ${item.id} "${item.text}" spills outside the header (${b.left.toFixed(1)}..${b.right.toFixed(1)} of ${m.header.left.toFixed(1)}..${m.header.right.toFixed(1)})`);
    }
    if (m.nav && item.id.startsWith('nav-') && !['nav-actions', 'nav-list-btn', 'nav-saved-btn'].includes(item.id) && (b.left < m.nav.left - EPS || b.right > m.nav.right + EPS)) {
      out.push(`${tag}: nav link ${item.id} "${item.text}" runs outside the nav area`);
    }
    if (item.textOverflow) out.push(`${tag}: ${item.id} "${item.text}" text is wider than its box`);
  }
  for (let i = 0; i < m.items.length; i += 1) {
    for (let j = i + 1; j < m.items.length; j += 1) {
      const a = m.items[i].box;
      const b = m.items[j].box;
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > EPS && overlapY > EPS) out.push(`${tag}: ${m.items[i].id} "${m.items[i].text}" overlaps ${m.items[j].id} "${m.items[j].text}" by ${overlapX.toFixed(1)}px`);
    }
  }
  if (m.viewport >= 768) {
    if (!m.cta) out.push(`${tag}: List Property CTA is not visible`);
    else {
      const c = m.cta.box;
      if (c.left < -EPS || c.right > m.viewport + EPS || c.width < 1) out.push(`${tag}: CTA is not fully on screen`);
      if (m.cta.scrollWidth > m.cta.clientWidth + 1) out.push(`${tag}: CTA label "${m.cta.text}" is cut off`);
    }
  }
  if (m.dir !== (m.lang === 'ar' ? 'rtl' : 'ltr')) out.push(`${tag}: wrong text direction ${m.dir}`);
  return out;
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)))));
}

async function openPage(page, base, target, lang) {
  await page.goto(base + target.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.addStyleTag({ content: ICON_CSS });
  await page.waitForFunction((code) => typeof window.setLang === 'function' && document.documentElement.lang === code, lang, { timeout: 30000 });
  if (lang !== 'en') {
    await page.waitForFunction(() => (document.getElementById('nav-sale')?.textContent || '').trim() !== 'For Sale', null, { timeout: 30000 });
  }
  if (target.detail) {
    await page.waitForFunction(() => document.getElementById('page-detail')?.classList.contains('active'), null, { timeout: 30000 });
  }
  await settle(page);
}

test('the header fits on one row without overlap in all 9 languages at every common width', { timeout: 600000 }, async () => {
  const { port, child } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-first-run'] });
  const problems = [];
  const coverage = new Set();
  let moreUsed = 0;
  try {
    const runPage = async (target) => {
      for (const lang of LANGUAGES) {
        const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 } });
        await context.addCookies([{ name: 'makaug_lang', value: lang, url: base }]);
        await context.addInitScript((code) => { try { localStorage.setItem('makaug_lang', code); } catch (_error) {} }, lang);
        await stubNetwork(context, base);
        const page = await context.newPage();
        try {
          await openPage(page, base, target, lang);
          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            await settle(page);
            const m = await page.evaluate(measure);
            problems.push(...problemsFor(target.name, m));
            if (m.more.length) moreUsed += 1;
            coverage.add(`${target.name}:${lang}:${width}`);
          }
          // The More menu itself must open on screen and list whole labels.
          await page.setViewportSize({ width: 1440, height: 900 });
          await settle(page);
          if (await page.locator('#nav-more-btn').isVisible()) {
            await page.click('#nav-more-btn');
            const menu = await page.evaluate(() => {
              const el = document.getElementById('nav-more-menu');
              const r = el.getBoundingClientRect();
              return { hidden: el.hidden, left: r.left, right: r.right, vw: innerWidth, links: Array.from(el.querySelectorAll('a')).map((a) => ({ text: a.textContent.trim(), over: a.scrollWidth > a.clientWidth + 1 })) };
            });
            if (menu.hidden) problems.push(`${target.name} [${lang} 1440px]: More menu did not open`);
            if (menu.left < 0 || menu.right > menu.vw) problems.push(`${target.name} [${lang} 1440px]: More menu opens off screen`);
            for (const link of menu.links) if (link.over || !link.text) problems.push(`${target.name} [${lang} 1440px]: More menu link "${link.text}" is cut off`);
            await page.keyboard.press('Escape');
          }
        } finally {
          await context.close();
        }
      }
    };
    await Promise.all(PAGES.map(runPage));
  } finally {
    await browser.close();
    child.kill('SIGTERM');
  }
  assert.equal(coverage.size, PAGES.length * LANGUAGES.length * WIDTHS.length, 'every page, language and width was checked');
  assert.deepEqual(problems, [], 'no header element overlaps, spills or is cut off');
  assert.ok(moreUsed > 0, 'at least one language needed the More menu, so the overflow path was exercised');
});
