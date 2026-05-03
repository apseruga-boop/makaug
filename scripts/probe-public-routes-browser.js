'use strict';

const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE_URL = String(process.env.BASE_URL || 'https://makaug.com').replace(/\/$/, '');

const ROUTES = [
  '/',
  '/to-rent',
  '/for-sale',
  '/land',
  '/student-accommodation',
  '/commercial',
  '/brokers',
  '/list-property',
  '/about',
  '/help',
  '/safety',
  '/anti-fraud',
  '/advertise',
  '/mortgage',
  '/login'
];

const MARKERS = {
  '/': ['Find your next home, land, rental, or student room'],
  '/to-rent': ['To Rent', 'Rentals', 'Houses for Rent', 'No rentals'],
  '/for-sale': ['For Sale', 'Houses for Sale', 'Properties for Sale', 'No homes for sale'],
  '/land': ['Land', 'Plot', 'Title', 'Land for Sale'],
  '/student-accommodation': ['Student Accommodation', 'Student Housing', 'Campus', 'Student rooms'],
  '/commercial': ['Commercial', 'Offices', 'Shops', 'Warehouses', 'Business space'],
  '/brokers': ['Brokers', 'Find a Broker', 'Broker directory', 'Verified brokers'],
  '/list-property': ['List Property', 'Find address or place'],
  '/about': ['About', 'MakaUg'],
  '/help': ['Help', 'Help Centre'],
  '/safety': ['Safety', 'Safety Tips'],
  '/anti-fraud': ['Anti-Fraud', 'Report suspicious', 'Fraud'],
  '/advertise': ['Advertise', 'Campaign', 'Sponsored', 'Packages'],
  '/mortgage': ['Mortgage', 'Mortgage Finder', 'repayment'],
  '/login': ['Sign in or create your MakaUg account', 'Email address or phone number']
};

const EXPECTED_PAGE_IDS = {
  '/': 'page-home',
  '/to-rent': 'page-rent',
  '/for-sale': 'page-sale',
  '/land': 'page-land',
  '/student-accommodation': 'page-students',
  '/commercial': 'page-commercial',
  '/brokers': 'page-brokers',
  '/list-property': 'page-list-property',
  '/about': 'page-about',
  '/help': 'page-help',
  '/safety': 'page-safety',
  '/anti-fraud': 'page-fraud',
  '/advertise': 'page-advertise',
  '/mortgage': 'page-mortgage',
  '/login': 'page-login'
};

const FORBIDDEN_VISIBLE_TEXT = [
  'Admin Dashboard',
  'Admin API Key',
  'Property Finder Dashboard',
  'Student Dashboard',
  'Broker Dashboard',
  'Field Agent Dashboard',
  'Advertiser Dashboard',
  'Lead Centre',
  'Recent Users',
  'Motherboard Listing Control',
  'Listing Review',
  'Paste ADMIN_API_KEY',
  'Sign Out'
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

function hasMarker(text, route) {
  const lower = String(text || '').toLowerCase();
  return (MARKERS[route] || []).find((marker) => lower.includes(marker.toLowerCase())) || '';
}

async function probeRoute(page, route) {
  const url = `${BASE_URL}${route === '/' ? '/' : route}?v=${Date.now()}`;
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(700);

  const expectedPageId = EXPECTED_PAGE_IDS[route];
  const data = await page.evaluate(({ expectedPageId, forbidden }) => {
    const text = document.body.innerText.replace(/\s+/g, ' ').trim();
    const expected = document.getElementById(expectedPageId);
    const expectedStyle = expected ? window.getComputedStyle(expected) : null;
    const expectedRect = expected ? expected.getBoundingClientRect() : null;
    const activePages = Array.from(document.querySelectorAll('.page.active')).map((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        id: el.id,
        display: style.display,
        visibility: style.visibility,
        height: Math.round(rect.height),
        width: Math.round(rect.width),
        text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 500)
      };
    });
    return {
      title: document.title,
      text,
      textLength: text.length,
      activePages,
      expected: expected ? {
        id: expected.id,
        active: expected.classList.contains('active'),
        display: expectedStyle.display,
        visibility: expectedStyle.visibility,
        height: Math.round(expectedRect.height),
        width: Math.round(expectedRect.width),
        text: expected.innerText.replace(/\s+/g, ' ').trim().slice(0, 500)
      } : null,
      forbiddenFound: forbidden.filter((item) => text.includes(item))
    };
  }, { expectedPageId, forbidden: FORBIDDEN_VISIBLE_TEXT });

  const failures = [];
  const status = response ? response.status() : 0;
  const marker = hasMarker(data.text, route);
  if (status !== 200) failures.push(`expected 200, got ${status}`);
  if (!data.expected) failures.push(`missing expected page ${expectedPageId}`);
  if (data.expected && !data.expected.active) failures.push(`${expectedPageId} is not active after browser JS`);
  if (data.expected && (data.expected.display === 'none' || data.expected.visibility === 'hidden')) {
    failures.push(`${expectedPageId} is hidden (${data.expected.display}/${data.expected.visibility})`);
  }
  if (data.expected && data.expected.height < 140) failures.push(`${expectedPageId} appears footer-only/too short (${data.expected.height}px)`);
  if (!marker) failures.push(`missing visible route marker (${(MARKERS[route] || []).join(' | ')})`);
  for (const forbidden of data.forbiddenFound) failures.push(`forbidden visible text: ${forbidden}`);
  if (data.text.includes('This area only This area only')) failures.push('duplicate location scope label');

  return {
    route,
    status,
    ok: failures.length === 0,
    marker,
    textLength: data.textLength,
    expected: data.expected,
    activePages: data.activePages,
    failures
  };
}

async function main() {
  const executablePath = chromeExecutable();
  if (!executablePath) {
    throw new Error('No Chrome/Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to run the browser route probe.');
  }
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

  for (const result of results) {
    const expected = result.expected ? `${result.expected.id}:${result.expected.height}px` : 'missing';
    const active = result.activePages.map((pageInfo) => `${pageInfo.id}:${pageInfo.height}px`).join(',') || '-';
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.route} status=${result.status} marker=${result.marker || '-'} expected=${expected} active=${active}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    console.error(`Browser public route probe failed for ${failed.length} route(s).`);
    process.exit(1);
  }
  console.log(`Browser public route probe passed for ${results.length} route(s) against ${BASE_URL}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
