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
  { route: '/', selector: '[data-testid="list-property-free-cta"]', label: 'Header List your property for free', expectUrl: '/list-property', marker: 'List Your Property' },
  { route: '/to-rent', selector: '[data-testid="list-property-free-cta"]', label: 'Header List property from rent', expectUrl: '/list-property', marker: 'List Your Property' },
  { route: '/for-sale', selector: '[data-testid="list-property-free-cta"]', label: 'Header List property from sale', expectUrl: '/list-property', marker: 'List Your Property' },
  { route: '/land', selector: '[data-testid="list-property-free-cta"]', label: 'Header List property from land', expectUrl: '/list-property', marker: 'List Your Property' },
  { route: '/student-accommodation', selector: '[data-testid="list-property-free-cta"]', label: 'Header List property from student route', expectUrl: '/list-property', marker: 'List Your Property' },
  { route: '/', selector: '#nav-rent', label: 'Header To Rent', expectUrl: '/to-rent', marker: 'To Rent' },
  { route: '/', selector: '#nav-sale', label: 'Header For Sale', expectUrl: '/for-sale', marker: 'For Sale' },
  { route: '/', selector: '#nav-land', label: 'Header Land', expectUrl: '/land', marker: 'Land' },
  { route: '/', selector: '#nav-students', label: 'Header Students', expectUrl: '/student-accommodation', marker: 'Student Accommodation' },
  { route: '/', selector: '#nav-commercial', label: 'Header Commercial', expectUrl: '/commercial', marker: 'Commercial' },
  { route: '/', selector: '#nav-brokers', label: 'Header Brokers', expectUrl: '/brokers', marker: 'Brokers' },
  { route: '/', selector: '#nav-mortgage', label: 'Header Mortgage', expectUrl: '/mortgage', marker: 'Mortgage' },
  { route: '/', selector: '#nav-ai', label: 'Header AI Chatbot', expectUrl: '/discover-ai-chatbot', marker: 'AI' },
  { route: '/', selector: '#nav-fraud', label: 'Header Fraud', expectUrl: '/anti-fraud', marker: 'Fraud' },
  { route: '/', selector: '#top-signin-link', label: 'Header Sign In opens drawer', expectDrawer: '#account-access-drawer', marker: 'Sign in or create your MakaUg account' },
  { route: '/', selector: '#top-saved-link', label: 'Saved logged out opens drawer', expectDrawer: '#account-access-drawer', marker: 'Sign in or create your MakaUg account' },
  { route: '/student-accommodation', selector: '#student-login-cta', label: 'Student Login opens student drawer', expectDrawer: '#account-access-drawer', marker: 'Students can save campus searches' },
  { route: '/', selector: '#footer-link-list-free', label: 'Footer List Property', expectUrl: '/list-property', marker: 'List Your Property' },
  { route: '/', selector: '#footer-link-advertise', label: 'Footer Advertise', expectUrl: '/advertise', marker: 'Advertise' },
  { route: '/', selector: '#footer-link-help', label: 'Footer Help', expectUrl: '/help', marker: 'Help' },
  { route: '/', selector: '#footer-link-safety', label: 'Footer Safety', expectUrl: '/safety', marker: 'Safety' }
];

async function go(page, route) {
  await page.goto(`${BASE_URL}${route}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function visibleText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
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
        await locator.click({ timeout: 8000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(300);
        const text = await visibleText(page);
        if (action.expectDrawer) {
          const drawer = page.locator(action.expectDrawer).first();
          if (!(await drawer.count())) {
            failures.push(`missing drawer ${action.expectDrawer}`);
          } else if (!(await drawer.isVisible())) {
            failures.push(`drawer ${action.expectDrawer} is not visible`);
          }
        } else {
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
      results.push({
        label: `Visible action audit ${route}`,
        route,
        selector: `${actions.length} visible actions`,
        ok: dead.length === 0,
        failures: dead.slice(0, 5).map((item) => `dead visible action: ${item.id || item.label || item.tag}`)
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
