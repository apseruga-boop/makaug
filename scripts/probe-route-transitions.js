'use strict';

const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE_URL = String(process.env.BASE_URL || 'https://makaug.com').replace(/\/$/, '');
const IS_LOCAL_BASE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(BASE_URL);

const ROUTES = [
  ['/', 'page-home'],
  ['/for-sale', 'page-sale'],
  ['/to-rent', 'page-rent'],
  ['/student-accommodation', 'page-students'],
  ['/students', 'page-students'],
  ['/commercial', 'page-commercial'],
  ['/land', 'page-land'],
  ['/brokers', 'page-brokers'],
  ['/mortgage', 'page-mortgage'],
  ['/discover-ai-chatbot', 'page-ai-chatbot'],
  ['/about', 'page-about'],
  ['/how-it-works', 'page-how-it-works'],
  ['/help', 'page-help'],
  ['/safety', 'page-safety'],
  ['/anti-fraud', 'page-fraud'],
  ['/report-fraud', 'page-fraud'],
  ['/advertise', 'page-advertise'],
  ['/careers', 'page-careers'],
  ['/terms', 'page-terms'],
  ['/privacy-policy', 'page-privacy-policy'],
  ['/cookie-policy', 'page-cookie-policy'],
  ['/list-property', 'page-list-property'],
  ['/saved', 'page-saved']
];

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

async function waitForActivePage(page, expectedId) {
  await page.waitForFunction((id) => {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('active')) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 200 && rect.height > 120;
  }, expectedId, { timeout: 5000 });
}

async function main() {
  const executablePath = chromeExecutable();
  if (!executablePath) throw new Error('No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE.');

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const responseFailures = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message || String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) responseFailures.push({ status: response.status(), url: response.url() });
  });

  const results = [];
  try {
    const response = await page.goto(`${BASE_URL}/?routeTransitionProbe=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if ((response?.status() || 0) !== 200) throw new Error(`Home route returned ${response?.status() || 0}`);
    await waitForActivePage(page, 'page-home');

    for (const [route, expectedId] of ROUTES) {
      if (process.env.ROUTE_TRANSITION_VERBOSE === '1') console.log(`CHECK ${route} -> ${expectedId}`);
      const started = Date.now();
      const transition = await page.evaluate((targetRoute) => {
        const before = {
          href: window.location.href,
          navigationCount: performance.getEntriesByType('navigation').length,
          activeIds: Array.from(document.querySelectorAll('.page.active')).map((el) => el.id)
        };
        const handled = window.navigatePublicRoute ? window.navigatePublicRoute(targetRoute) : true;
        return {
          before,
          handled,
          href: window.location.href,
          pathname: window.location.pathname,
          navigationCount: performance.getEntriesByType('navigation').length
        };
      }, route);
      try {
        await waitForActivePage(page, expectedId);
      } catch (error) {
        const debug = await page.evaluate((expectedId) => ({
          href: window.location.href,
          handled: typeof window.navigatePublicRoute,
          expectedExists: !!document.getElementById(expectedId),
          expectedClass: document.getElementById(expectedId)?.className || '',
          expectedHeight: Math.round(document.getElementById(expectedId)?.getBoundingClientRect().height || 0),
          activeIds: Array.from(document.querySelectorAll('.page.active')).map((el) => `${el.id}:${Math.round(el.getBoundingClientRect().height)}:${el.className}`),
          bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500)
        }), expectedId).catch((debugError) => ({ debugError: debugError.message || String(debugError) }));
        throw new Error(`${error.message || error} while waiting for ${route} -> ${expectedId}; debug=${JSON.stringify(debug)}`);
      }
      await page.waitForTimeout(route === '/list-property' ? 180 : 40);
      const state = await page.evaluate((expectedId) => {
        const activePages = Array.from(document.querySelectorAll('.page.active')).map((el) => {
          const rect = el.getBoundingClientRect();
          return { id: el.id, height: Math.round(rect.height), width: Math.round(rect.width) };
        });
        const openModals = Array.from(document.querySelectorAll('.modal-overlay.open')).map((el) => el.id);
        const active = document.getElementById(expectedId);
        return {
          activePages,
          openModals,
          expectedActive: !!active?.classList.contains('active'),
          bodyModalOpen: document.body.classList.contains('modal-open'),
          href: window.location.href,
          pathname: window.location.pathname,
          navigationCount: performance.getEntriesByType('navigation').length
        };
      }, expectedId);
      const failures = [];
      if (transition.handled !== false) failures.push('navigatePublicRoute did not handle route');
      if (!state.expectedActive) failures.push(`${expectedId} was not active`);
      if (state.activePages.length !== 1) failures.push(`expected exactly one active page, got ${state.activePages.map((p) => p.id).join(',') || 'none'}`);
      if (state.navigationCount !== transition.before.navigationCount) failures.push('browser performed a full navigation during SPA transition');
      if (route !== '/list-property' && state.bodyModalOpen) failures.push(`modal overlay left open: ${state.openModals.join(',') || 'unknown'}`);
      results.push({
        route,
        expectedId,
        ok: failures.length === 0,
        ms: Date.now() - started,
        pathname: state.pathname,
        activePages: state.activePages,
        openModals: state.openModals,
        failures
      });
    }
  } finally {
    await browser.close();
  }

  for (const result of results) {
    const active = result.activePages.map((p) => `${p.id}:${p.height}px`).join(',') || '-';
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.route} -> ${result.expectedId} ms=${result.ms} path=${result.pathname} active=${active} modals=${result.openModals.join(',') || '-'}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }
  const significantResponseFailures = responseFailures.filter((failure) => !isLocalOptionalResponseFailure(failure));
  const significantConsoleErrors = consoleErrors.filter((error) => {
    if (!IS_LOCAL_BASE) return true;
    if (!/Failed to load resource: the server responded with a status of/i.test(error || '')) return true;
    return significantResponseFailures.length > 0;
  });
  if (significantConsoleErrors.length) {
    console.log(`Console errors (${significantConsoleErrors.length}):`);
    significantConsoleErrors.slice(0, 8).forEach((error) => console.log(`  - ${error}`));
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length || significantConsoleErrors.length || significantResponseFailures.length) {
    console.error(`Route transition probe failed: routes=${failed.length}, consoleErrors=${significantConsoleErrors.length}, httpFailures=${significantResponseFailures.length}`);
    process.exit(1);
  }
  console.log(`Route transition probe passed for ${results.length} route transitions against ${BASE_URL}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
