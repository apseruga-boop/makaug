'use strict';

const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE_URL = String(process.env.BASE_URL || 'https://makaug.com').replace(/\/$/, '');
const IS_LOCAL_BASE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(BASE_URL);

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const PRIMARY_ACTIONS = [
  { route: '/', selector: '[data-testid="list-property-free-cta"]', label: 'Header List Property', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/to-rent', selector: '[data-testid="list-property-free-cta"]', label: 'Header List Property from rent', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/for-sale', selector: '[data-testid="list-property-free-cta"]', label: 'Header List Property from sale', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/land', selector: '[data-testid="list-property-free-cta"]', label: 'Header List Property from land', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/student-accommodation', selector: '[data-testid="list-property-free-cta"]', label: 'Header List Property from student route', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/', selector: '#nav-rent', label: 'Header To Rent', expectUrl: '/to-rent', marker: 'To Rent' },
  { route: '/', selector: '#nav-sale', label: 'Header For Sale', expectUrl: '/for-sale', marker: 'For Sale' },
  { route: '/', selector: '#nav-land', label: 'Header Land', expectUrl: '/land', marker: 'Land' },
  { route: '/', selector: '#nav-students', label: 'Header Students', expectUrl: '/student-accommodation', marker: 'Student Accommodation' },
  { route: '/', selector: '#nav-commercial', label: 'Header Commercial', expectUrl: '/commercial', marker: 'Commercial' },
  { route: '/', selector: '#nav-brokers', label: 'Header Brokers', expectUrl: '/brokers', marker: 'Brokers' },
  { route: '/', selector: '#nav-mortgage', label: 'Header Mortgage', expectUrl: '/mortgage', marker: 'Mortgage' },
  { route: '/', selector: '#nav-ai', label: 'Header AI Chatbot', expectUrl: '/discover-ai-chatbot', marker: 'AI' },
  { route: '/', selector: '#nav-about', label: 'Header About Us', expectUrl: '/about', marker: 'About MakaUg' },
  { route: '/', selector: '#top-signin-link', label: 'Header Sign In opens drawer', expectDrawer: '#account-access-drawer', marker: 'Sign in or create your MakaUg account' },
  { route: '/', selector: '#top-saved-link', label: 'Saved logged out opens drawer', expectDrawer: '#account-access-drawer', marker: 'Sign in or create your MakaUg account' },
  { route: '/student-accommodation', selector: '#student-login-cta', label: 'Student Login opens student drawer', expectDrawer: '#account-access-drawer', marker: 'Students can save campus searches' },
  { route: '/list-property', selector: '#list-choice-online-btn', label: 'List Property online choice opens form', expectSamePageAction: true, marker: 'Property Details' },
  { route: '/list-property', selector: '#lp-whatsapp-option-btn', label: 'List Property WhatsApp option', expectPopup: true, marker: 'List via WhatsApp' },
  { route: '/discover-ai-chatbot', selector: '#ai-chatbot-submit-btn', label: 'AI chatbot prompt action', expectSamePageAction: true, marker: 'MakaUg AI', fill: { selector: '#ai-chatbot-message', value: 'Help me search for a rental in Kampala' } },
  { route: '/', selector: '#footer-link-list-free', label: 'Footer List Property', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/', selector: '#footer-link-advertise', label: 'Footer Advertise', expectUrl: '/advertise', marker: 'Advertise' },
  { route: '/', selector: '#footer-link-help', label: 'Footer Help', expectUrl: '/help', marker: 'Help' },
  { route: '/', selector: '#footer-link-safety', label: 'Footer Safety', expectUrl: '/safety', marker: 'Safety' }
];

async function go(page, route) {
  await page.goto(`${BASE_URL}${route}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(180);
}

async function visibleText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
}

async function waitForMapIfPresent(page) {
  const hasMap = await page.locator('#map-home:visible, #map-sale:visible, #map-rent:visible, #map-students:visible, #map-commercial:visible, #map-land:visible, #map-brokers:visible').count();
  if (!hasMap) return false;
  await page.evaluate(() => {
    const map = document.querySelector('#map-home, #map-sale, #map-rent, #map-students, #map-commercial, #map-land, #map-brokers');
    if (map) map.scrollIntoView({ block: 'center', inline: 'center' });
  }).catch(() => {});
  await page.waitForTimeout(3400);
  return true;
}

async function clickGoogleMarkerCandidate(page) {
  const candidates = await page.evaluate(() => {
    const blocked = /^(Map|Satellite)$|keyboard|terms|report|fullscreen|street view|zoom|pegman|map data|imagery/i;
    return Array.from(document.querySelectorAll('.gm-style [role="button"], .gm-style img[alt], .gm-style [title]'))
      .map((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const label = (el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent || '').replace(/\s+/g, ' ').trim();
        const src = el.getAttribute('src') || '';
        return {
          label,
          src,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 8 && rect.height >= 8,
          width: rect.width,
          height: rect.height,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })
      .filter((item) => {
        if (!item.visible) return false;
        if (item.width > 90 || item.height > 90) return false;
        if (blocked.test(item.label)) return false;
        return item.label || /marker|spotlight|red|maps\.gstatic\.com\/mapfiles/i.test(item.src);
      })
      .slice(0, 14);
  });
  for (const candidate of candidates) {
    await page.mouse.click(candidate.x, candidate.y).catch(() => {});
    await page.waitForSelector('.gm-style-iw:visible, [data-map-marker-popup]:visible', { timeout: 1300 }).catch(() => {});
    const opened = await page.locator('.gm-style-iw:visible, [data-map-marker-popup]:visible').count();
    if (opened) return true;
  }
  return false;
}

async function clickPopupDetailOrBrokerAction(page, checks) {
  const popupLink = page.locator([
    '[data-map-property-link]:visible',
    '.gm-style-iw a[href*="/property/"]:visible',
    '.leaflet-popup a[href*="/property/"]:visible',
    '[data-map-broker-link]:visible',
    '.gm-style-iw a[href*="/agents/"]:visible',
    '.leaflet-popup a[href*="/agents/"]:visible',
    '.gm-style-iw button:has-text("View Property"):visible',
    '.leaflet-popup button:has-text("View Property"):visible',
    '.gm-style-iw button:has-text("View Broker"):visible',
    '.leaflet-popup button:has-text("View Broker"):visible'
  ].join(', ')).first();
  if (!(await popupLink.count())) {
    checks.push('map popup opened but has no View Property/View Broker action');
    return;
  }
  const href = await popupLink.getAttribute('href').catch(() => '') || '';
  const label = await popupLink.innerText().catch(() => '') || '';
  await popupLink.click({ timeout: 8000 }).catch((error) => {
    checks.push(`map popup detail click failed: ${error.message}`);
  });
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const text = await visibleText(page);
  const path = new URL(page.url()).pathname;
  const expectedProperty = href.includes('/property/') || /View Property/i.test(label);
  const expectedBroker = href.includes('/agents/') || /View Broker/i.test(label);
  if (expectedProperty && !path.startsWith('/property/') && !/Back to results|Book Viewing|Request Callback|WhatsApp Contact|Send enquiry/i.test(text)) {
    checks.push(`map popup View Property did not open a listing detail route/view (path ${path})`);
  }
  if (expectedBroker && !path.startsWith('/agents/') && !/Back to Brokers|Broker profile|Verified broker|Share Broker Card/i.test(text)) {
    checks.push(`map popup View Broker did not open a broker profile route/view (path ${path})`);
  }
}

async function auditVisibleActions(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('a,button,[role="button"],[onclick]'))
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (el.closest('.leaflet-container, .leaflet-pane, .gm-style')) return false;
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        label: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        href: el.getAttribute('href') || '',
        onclick: el.getAttribute('onclick') || '',
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true'
      }))
      .filter((item) => item.label || item.id);
  });
}

async function auditCardsAndMarkers(page, route) {
  const checks = [];
  const card = page.locator('.property-card:visible, [data-property-card]:visible, [data-property-id]:visible').first();
  if (await card.count()) {
    const before = page.url();
    await card.click({ timeout: 8000 }).catch((error) => {
      checks.push(`listing/property card click failed: ${error.message}`);
    });
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const text = await visibleText(page);
    const after = page.url();
    if (before === after && !/Back to results|Property Details|Book Viewing|Request Callback|WhatsApp/i.test(text)) {
      checks.push('listing/property card did not open a detail view or route');
    }
    await go(page, route);
  }
  const hasMap = await waitForMapIfPresent(page);
  const markerCount = await page.locator('.leaflet-marker-icon:visible, [data-map-marker]:visible').count();
  if (markerCount) {
    const markerIndex = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.leaflet-marker-icon, [data-map-marker]'))
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const top = document.elementFromPoint(x, y);
        if (top === el || el.contains(top)) return i;
      }
      return -1;
    });
    if (markerIndex < 0) {
      checks.push('no unobstructed map marker was clickable');
    } else {
      const marker = page.locator('.leaflet-marker-icon:visible, [data-map-marker]:visible').nth(markerIndex);
      await marker.click({ timeout: 8000 }).catch((error) => {
        checks.push(`map marker click failed: ${error.message}`);
      });
    }
    await page.waitForSelector('.leaflet-popup:visible, #detail-content:visible, [data-map-marker-popup]:visible', { timeout: 1500 }).catch(() => {});
    const popupOrDetail = await page.locator('.leaflet-popup:visible, #detail-content:visible, [data-map-marker-popup]:visible').count();
    if (!popupOrDetail) checks.push('map marker did not open popup/detail');
    else await clickPopupDetailOrBrokerAction(page, checks);
  } else if (hasMap) {
    const googlePopupOpened = await clickGoogleMarkerCandidate(page);
    if (googlePopupOpened) {
      await clickPopupDetailOrBrokerAction(page, checks);
    } else {
      const visibleCards = await page.locator('.property-card:visible, [data-property-card]:visible, .broker-grid-card:visible').count();
      if (visibleCards) checks.push('map has listing/broker cards but no clickable marker popup was found');
    }
  }
  return checks;
}

function actionHasDestination(item) {
  if (item.disabled) return true;
  if (/leaflet-control|leaflet-bar/i.test(`${item.id} ${item.label} ${item.href} ${item.onclick}`)) return true;
  if (['+', '−', '-'].includes(item.label)) return true;
  if (item.href && item.href !== '#' && !/^javascript:void/i.test(item.href)) return true;
  if (item.onclick && !/^return false;?$/i.test(item.onclick.trim())) return true;
  if (item.tag === 'button' && ['submit', 'button'].includes(String(item.type || 'button').toLowerCase())) return true;
  if (item.role === 'button' && item.onclick) return true;
  return false;
}

function isLocalOptionalResponseFailure(failure) {
  if (!IS_LOCAL_BASE) return false;
  let pathname = '';
  try {
    pathname = new URL(failure.url).pathname;
  } catch {
    pathname = failure.url || '';
  }
  return [
    '/api/properties',
    '/api/agents',
    '/api/mortgage-rates',
    '/api/ai/assistant-reply',
    '/api/analytics/event',
    '/api/analytics/web-vitals'
  ].some((prefix) => pathname.startsWith(prefix));
}

function significantConsoleIssues(issues, responseFailures) {
  return issues.filter((issue) => {
    if (issue.kind === 'pageerror') return true;
    if (
      IS_LOCAL_BASE
      && /Failed to load resource: the server responded with a status of/i.test(issue.text || '')
      && responseFailures.length > 0
      && responseFailures.every(isLocalOptionalResponseFailure)
    ) {
      return false;
    }
    return true;
  });
}

async function main() {
  const executablePath = chromeExecutable();
  if (!executablePath) throw new Error('No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE.');

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const consoleIssues = [];
  const responseFailures = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleIssues.push({ kind: 'console', text: msg.text() });
  });
  page.on('pageerror', (err) => consoleIssues.push({ kind: 'pageerror', text: err.message || String(err) }));
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) responseFailures.push({ status, url: response.url() });
  });

  const results = [];
  try {
    for (const action of PRIMARY_ACTIONS) {
      const beforeIssues = consoleIssues.length;
      const beforeResponses = responseFailures.length;
      const failures = [];
      await go(page, action.route);
      const locator = page.locator(action.selector).first();
      if (!(await locator.count())) {
        failures.push(`missing selector ${action.selector}`);
      } else {
        if (action.fill?.selector) {
          const input = page.locator(action.fill.selector).first();
          if (await input.count()) await input.fill(action.fill.value || 'Test');
        }
        const popupPromise = action.expectPopup ? page.waitForEvent('popup', { timeout: 6000 }).catch(() => null) : null;
        await locator.click({ timeout: 8000 });
        const popup = popupPromise ? await popupPromise : null;
        if (action.expectPopup) {
          if (!popup) failures.push('expected popup/external destination');
          else await popup.close().catch(() => {});
        }
        if (action.expectDrawer || action.expectPopup || action.expectSamePageAction) {
          await page.waitForTimeout(700);
        } else {
          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(180);
        }
        const text = await visibleText(page);
        if (action.expectDrawer) {
          const drawer = page.locator(action.expectDrawer).first();
          if (!(await drawer.count())) {
            failures.push(`missing drawer ${action.expectDrawer}`);
          } else if (!(await drawer.isVisible())) {
            failures.push(`drawer ${action.expectDrawer} is not visible`);
          }
        } else if (!action.expectPopup && !action.expectSamePageAction) {
          const url = new URL(page.url());
          if (!url.pathname.startsWith(action.expectUrl)) {
            failures.push(`expected URL ${action.expectUrl}, got ${url.pathname}`);
          }
        }
        if (action.marker && !text.toLowerCase().includes(action.marker.toLowerCase())) {
          failures.push(`missing marker ${action.marker}`);
        }
      }
      const newResponseFailures = responseFailures.slice(beforeResponses);
      const significantResponses = newResponseFailures.filter((failure) => !isLocalOptionalResponseFailure(failure));
      const newIssues = significantConsoleIssues(consoleIssues.slice(beforeIssues), newResponseFailures);
      if (significantResponses.length) {
        failures.push(`HTTP failures: ${significantResponses.slice(0, 2).map((f) => `${f.status} ${f.url}`).join(' | ')}`);
      }
      if (newIssues.length) failures.push(`console errors: ${newIssues.slice(0, 2).map((issue) => issue.text).join(' | ')}`);
      results.push({ label: action.label, route: action.route, selector: action.selector, ok: failures.length === 0, failures });
    }

    const auditRoutes = ['/', '/to-rent', '/for-sale', '/land', '/student-accommodation', '/commercial', '/brokers', '/list-property', '/advertise', '/mortgage', '/login', '/about', '/help', '/safety', '/anti-fraud'];
    for (const route of auditRoutes) {
      await go(page, route);
      const actions = await auditVisibleActions(page);
      const dead = actions.filter((item) => !actionHasDestination(item));
      const cardMarkerFailures = await auditCardsAndMarkers(page, route);
      results.push({
        label: `Visible action audit ${route}`,
        route,
        selector: `${actions.length} visible actions`,
        ok: dead.length === 0 && cardMarkerFailures.length === 0,
        failures: dead.slice(0, 5).map((item) => `dead visible action: ${item.id || item.label || item.tag}`).concat(cardMarkerFailures)
      });
    }
  } finally {
    await browser.close();
  }

  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.label} (${result.route}) selector=${result.selector}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`Click-action probe checked ${results.length} actions/audits; failures=${failed.length}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
