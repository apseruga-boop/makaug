'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE_URL = String(process.env.BASE_URL || 'https://makaug.com').replace(/\/$/, '');
const IS_LOCAL_BASE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(BASE_URL);
const OUT_FILE = path.join(__dirname, '..', 'docs', 'performance-audit.md');

const ROUTES = [
  '/',
  '/to-rent',
  '/for-sale',
  '/land',
  '/student-accommodation',
  '/commercial',
  '/brokers',
  '/list-property',
  '/advertise',
  '/mortgage',
  '/login'
];

const EXPECTED_PAGE_IDS = {
  '/': 'page-home',
  '/to-rent': 'page-rent',
  '/for-sale': 'page-sale',
  '/land': 'page-land',
  '/student-accommodation': 'page-students',
  '/commercial': 'page-commercial',
  '/brokers': 'page-brokers',
  '/list-property': 'page-list-property',
  '/advertise': 'page-advertise',
  '/mortgage': 'page-mortgage',
  '/login': 'page-login'
};

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

async function probeRoute(page, route) {
  const consoleIssues = [];
  const responseFailures = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleIssues.push({ kind: 'console', text: msg.text() });
  };
  const onPageError = (err) => consoleIssues.push({ kind: 'pageerror', text: err.message || String(err) });
  const onResponse = (response) => {
    const status = response.status();
    if (status >= 400) responseFailures.push({ status, url: response.url() });
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  const expectedPageId = EXPECTED_PAGE_IDS[route];
  const startedAt = Date.now();
  let response;
  try {
    response = await page.goto(`${BASE_URL}${route}?v=${Date.now()}`, { waitUntil: 'commit', timeout: 30000 });
  } catch (error) {
    if (!/waitUntil/i.test(error.message || '')) throw error;
    response = await page.goto(`${BASE_URL}${route}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForFunction((id) => {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('active')) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 120;
  }, expectedPageId, { timeout: 5000 });
  const visibleMs = Date.now() - startedAt;
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const js = resources.filter((entry) => /\.js(\?|$)/i.test(entry.name));
    const css = resources.filter((entry) => /\.css(\?|$)/i.test(entry.name));
    const transferred = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    return {
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
      htmlTransferBytes: nav ? Math.round(nav.transferSize || 0) : 0,
      resourceCount: resources.length,
      jsCount: js.length,
      cssCount: css.length,
      transferredBytes: Math.round(transferred),
      googleMapsLoaded: resources.some((entry) => entry.name.includes('maps.googleapis.com')) || !!window.google?.maps,
      chatbotLoaded: resources.some((entry) => /whatsapp|chatbot|ai/i.test(entry.name)),
      activeHeight: Math.round(document.querySelector('.page.active')?.getBoundingClientRect().height || 0)
    };
  });

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('response', onResponse);

  const significantResponses = responseFailures.filter((failure) => !isLocalOptionalResponseFailure(failure));
  const consoleErrors = significantConsoleIssues(consoleIssues, responseFailures).map((issue) => issue.text);
  const failures = [];
  if ((response?.status() || 0) !== 200) failures.push(`expected 200, got ${response?.status() || 0}`);
  if (visibleMs > 1500) failures.push(`route body visible after ${visibleMs}ms (target <= 1500ms)`);
  if (significantResponses.length) failures.push(`HTTP failures: ${significantResponses.slice(0, 2).map((f) => `${f.status} ${f.url}`).join(' | ')}`);
  if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.slice(0, 2).join(' | ')}`);
  if (['/', '/advertise', '/mortgage', '/login'].includes(route) && metrics.googleMapsLoaded) {
    failures.push(`Google Maps loaded on ${route} before active map use`);
  }

  return {
    route,
    status: response?.status() || 0,
    visibleMs,
    consoleErrors,
    failures,
    ...metrics
  };
}

function markdown(results) {
  const now = new Date().toISOString();
  const slowest = [...results].sort((a, b) => b.visibleMs - a.visibleMs)[0];
  const rows = results.map((r) => `| \`${r.route}\` | ${r.status} | ${r.visibleMs} | ${r.domContentLoadedMs ?? '-'} | ${r.loadMs ?? '-'} | ${r.resourceCount} | ${r.jsCount} | ${r.cssCount} | ${r.googleMapsLoaded ? 'yes' : 'no'} | ${r.consoleErrors.length} | ${r.failures.length ? r.failures.join('<br>') : 'pass'} |`).join('\n');
  return `# MakaUg Performance Audit

Generated: ${now}

Base URL: ${BASE_URL}

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: \`${slowest?.route || '-'}\` at ${slowest?.visibleMs ?? '-'}ms.

| Route | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
${rows}

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through \`POST /api/analytics/web-vitals\` where browser APIs support them.
`;
}

async function main() {
  const executablePath = chromeExecutable();
  if (!executablePath) throw new Error('No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE.');
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const results = [];
  try {
    for (const route of ROUTES) {
      results.push(await probeRoute(page, route));
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(OUT_FILE, markdown(results));
  for (const result of results) {
    console.log(`${result.failures.length ? 'FAIL' : 'PASS'} ${result.route} status=${result.status} visible=${result.visibleMs}ms dcl=${result.domContentLoadedMs}ms load=${result.loadMs}ms resources=${result.resourceCount} js=${result.jsCount} css=${result.cssCount} maps=${result.googleMapsLoaded ? 'yes' : 'no'} console=${result.consoleErrors.length}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }
  console.log(`Performance audit written to ${OUT_FILE}`);
  const failed = results.filter((result) => result.failures.length);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
