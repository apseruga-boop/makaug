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
  { route: '/', selector: '#nav-off-plan', label: 'Header Off Plan', expectUrl: '/off-plan', marker: 'Off Plan' },
  { route: '/', selector: '#nav-brokers', label: 'Header Brokers', expectUrl: '/brokers', marker: 'Brokers' },
  { route: '/', selector: '#nav-mortgage', label: 'Header Mortgage', expectUrl: '/mortgage', marker: 'Mortgage' },
  { route: '/', selector: '#nav-ai', label: 'Header AI Chatbot', expectUrl: '/discover-ai-chatbot', marker: 'AI' },
  { route: '/', selector: '#nav-about', label: 'Header About Us', expectUrl: '/about', marker: 'About' },
  { route: '/', selector: '#top-signin-link', label: 'Header Sign In opens drawer', expectDrawer: '#account-access-drawer', marker: 'Sign in or create your makaug.com account' },
  { route: '/', selector: '#top-saved-link', label: 'Saved logged out opens drawer', expectDrawer: '#account-access-drawer', marker: 'Sign in or create your makaug.com account' },
  { route: '/student-accommodation', selector: '#student-login-cta', label: 'Student Login opens student drawer', expectDrawer: '#account-access-drawer', marker: 'Students can save campus searches' },
  { route: '/list-property', selector: '#list-choice-online-btn', label: 'List Property online choice opens form', expectSamePageAction: true, marker: 'Property Details' },
  { route: '/list-property', selector: '#lp-whatsapp-option-btn', label: 'List Property WhatsApp option', expectPopup: true, marker: 'List via WhatsApp' },
  { route: '/discover-ai-chatbot', selector: '[data-ask-ai-inline-context="discover"] [data-ai-submit]', label: 'AI chatbot prompt action', expectSamePageAction: true, marker: 'makaug AI', fill: { selector: '[data-ask-ai-inline-context="discover"] [data-ai-message]', value: 'Help me search for a rental in Kampala' } },
  { route: '/off-plan', selector: '#off-plan-list-view button[onclick="openOffPlanContactModal()"]', label: 'List Off Plan opens contact choices', expectDrawer: '#off-plan-contact-modal', marker: 'How would you like the team to contact you?' },
  { route: '/', selector: '#footer-link-list-free', label: 'Footer List Property', expectUrl: '/list-property', marker: 'List Property' },
  { route: '/', selector: '#footer-link-advertise', label: 'Footer Advertise', expectUrl: '/advertise', marker: 'Advertise' },
  { route: '/', selector: '#footer-link-help', label: 'Footer Help', expectUrl: '/help', marker: 'Help' },
  { route: '/', selector: '#footer-link-safety', label: 'Footer Safety', expectUrl: '/safety', marker: 'Safety' }
];

const AUDIT_ROUTE_PAGE_IDS = {
  '/': 'page-home',
  '/to-rent': 'page-rent',
  '/for-sale': 'page-sale',
  '/land': 'page-land',
  '/off-plan': 'page-off-plan',
  '/student-accommodation': 'page-students',
  '/commercial': 'page-commercial',
  '/brokers': 'page-brokers',
  '/list-property': 'page-list-property',
  '/advertise': 'page-advertise',
  '/mortgage': 'page-mortgage',
  '/login': 'page-login',
  '/about': 'page-about',
  '/help': 'page-help',
  '/safety': 'page-safety',
  '/anti-fraud': 'page-fraud'
};

async function go(page, route) {
  const targetUrl = `${BASE_URL}${route}?v=${Date.now()}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(180);
  const expectedPageId = AUDIT_ROUTE_PAGE_IDS[route] || '';
  const expectedPath = route.replace(/\/+$/, '') || '/';
  const routeReady = async (timeout = 2500) => page.waitForFunction(({ expectedPageId, expectedPath }) => {
    if (!expectedPageId) return true;
    const path = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    const pageEl = document.getElementById(expectedPageId);
    return path === expectedPath && pageEl?.classList.contains('active') && !pageEl.classList.contains('route-fragment-loading');
  }, { expectedPageId, expectedPath }, { timeout }).then(() => true).catch(() => false);
  if (expectedPageId && !(await routeReady())) {
    await page.evaluate((targetRoute) => {
      if (typeof window.navigatePublicRoute === 'function') window.navigatePublicRoute(targetRoute);
    }, route).catch(() => {});
    await routeReady(7000);
  }
  if (process.env.CLICK_PROBE_DEBUG_ROUTE === '1') {
    console.log(`DEBUG go route=${route} target=${targetUrl} final=${page.url()}`);
  }
}

async function visibleText(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
    } catch (error) {
      const message = error?.message || String(error);
      if (!/Execution context was destroyed|Cannot find context|Target page/i.test(message) || attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(180);
    }
  }
  return '';
}

async function waitForMapIfPresent(page, route) {
  const pageId = AUDIT_ROUTE_PAGE_IDS[route] || '';
  const scope = pageId ? `#${pageId}` : '.page.active';
  const hasMap = await page.locator(`${scope} #map-home:visible, ${scope} #map-sale:visible, ${scope} #map-rent:visible, ${scope} #map-students:visible, ${scope} #map-commercial:visible, ${scope} #map-land:visible, ${scope} #map-brokers:visible`).count();
  if (!hasMap) return false;
  await page.evaluate((expectedPageId) => {
    const activePage = document.getElementById(expectedPageId) || document.querySelector('.page.active') || document;
    const map = activePage.querySelector('#map-home, #map-sale, #map-rent, #map-students, #map-commercial, #map-land, #map-brokers');
    if (map) map.scrollIntoView({ block: 'center', inline: 'center' });
  }, pageId).catch(() => {});
  await page.waitForTimeout(3400);
  await page.waitForFunction(() => {
    const loading = typeof publicListingsApiLoading !== 'undefined' && publicListingsApiLoading;
    const deepTimers = typeof publicCategoryDeepHydrationTimers !== 'undefined' ? publicCategoryDeepHydrationTimers.size : 0;
    const activeHydrations = typeof publicActiveCategoryHydrationPromises !== 'undefined' ? publicActiveCategoryHydrationPromises.size : 0;
    return !loading && deepTimers === 0 && activeHydrations === 0;
  }, { timeout: 15000 }).catch(() => {});
  return true;
}

async function visiblePublicMapId(page, route) {
  return page.evaluate((expectedPageId) => {
    const activePage = document.getElementById(expectedPageId) || document.querySelector('.page.active') || document;
    return Array.from(activePage.querySelectorAll('#map-home, #map-sale, #map-rent, #map-students, #map-commercial, #map-land, #map-brokers'))
      .map((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          id: el.id,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 120 && rect.height > 120
        };
      })
      .find((item) => item.visible)?.id || '';
  }, AUDIT_ROUTE_PAGE_IDS[route] || '').catch(() => '');
}

async function triggerGoogleMarkerObject(page, mapId) {
  if (!mapId) return false;
  const triggered = await page.evaluate((activeMapId) => {
    try {
      if (typeof window.__makaugOpenFirstPublicMapMarker === 'function') {
        return window.__makaugOpenFirstPublicMapMarker(activeMapId);
      }
      if (!window.google?.maps?.event) return false;
      const registry = typeof markers !== 'undefined' ? markers : {};
      const candidate = (registry?.[activeMapId] || []).find((marker) => marker && typeof marker.getMap === 'function' && marker.getMap());
      if (!candidate) return false;
      window.google.maps.event.trigger(candidate, 'click');
      return true;
    } catch (error) {
      return false;
    }
  }, mapId).catch(() => false);
  if (!triggered) return false;
  await page.waitForSelector('.gm-style-iw:visible, [data-map-marker-popup]:visible', { timeout: 1600 }).catch(() => {});
  return Boolean(await page.locator('.gm-style-iw:visible, [data-map-marker-popup]:visible').count());
}

async function clickGoogleMarkerCandidate(page, mapId) {
  if (await triggerGoogleMarkerObject(page, mapId)) return true;
  const candidates = await page.evaluate((activeMapId) => {
    const root = document.getElementById(activeMapId) || document;
    const blocked = /^(Map|Satellite)$|keyboard|terms|report|fullscreen|street view|zoom|pegman|map data|imagery/i;
    return Array.from(root.querySelectorAll('.gm-style [role="button"], .gm-style img[alt], .gm-style [title]'))
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
  }, mapId || '');
  for (const candidate of candidates) {
    await page.mouse.click(candidate.x, candidate.y).catch(() => {});
    await page.waitForSelector('.gm-style-iw:visible, [data-map-marker-popup]:visible', { timeout: 1300 }).catch(() => {});
    const opened = await page.locator('.gm-style-iw:visible, [data-map-marker-popup]:visible').count();
    if (opened) return true;
  }
  return triggerGoogleMarkerObject(page, mapId);
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
  ].join(', ')).last();
  if (!(await popupLink.count())) {
    checks.push('map popup opened but has no View Property/View Broker action');
    return;
  }
  const href = await popupLink.getAttribute('href').catch(() => '') || '';
  const label = await popupLink.innerText().catch(() => '') || '';
  const expectedProperty = href.includes('/property/') || /View Property/i.test(label);
  const expectedBroker = href.includes('/agents/') || /View Broker/i.test(label);
  await popupLink.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const clickTarget = await popupLink.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      x,
      y,
      clickable: top === el || el.contains(top)
    };
  }).catch(() => null);
  if (!clickTarget?.clickable) {
    checks.push('map popup detail action is obscured or detached');
  } else {
    await page.mouse.click(clickTarget.x, clickTarget.y).catch((error) => {
      checks.push(`map popup detail click failed: ${error.message}`);
    });
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(({ expectedProperty, expectedBroker }) => {
    const path = window.location.pathname || '/';
    const text = document.body?.innerText || '';
    if (expectedProperty) return path.startsWith('/property/') || /Back to results|Book Viewing|Request Callback|WhatsApp Contact|Send enquiry/i.test(text);
    if (expectedBroker) return path.startsWith('/agents/') || /Back to Brokers|Broker profile|Verified broker|Share Broker Card/i.test(text);
    return true;
  }, { expectedProperty, expectedBroker }, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(180);
  const text = await visibleText(page);
  const path = new URL(page.url()).pathname;
  if (expectedProperty && !path.startsWith('/property/') && !/Back to results|Book Viewing|Request Callback|WhatsApp Contact|Send enquiry/i.test(text)) {
    checks.push(`map popup View Property did not open a listing detail route/view (path ${path})`);
  }
  if (expectedBroker && !path.startsWith('/agents/') && !/Back to Brokers|Broker profile|Verified broker|Share Broker Card/i.test(text)) {
    checks.push(`map popup View Broker did not open a broker profile route/view (path ${path})`);
  }
}

async function auditVisibleActions(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => {
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
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        describedBy: el.getAttribute('aria-describedby') || ''
      }))
      .filter((item) => item.label || item.id);
      });
    } catch (error) {
      const message = error?.message || String(error);
      if (!/Execution context was destroyed|Cannot find context|Target page/i.test(message) || attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(180);
    }
  }
  return [];
}

async function auditCardsAndMarkers(page, route) {
  const checks = [];
  const pageId = AUDIT_ROUTE_PAGE_IDS[route] || '';
  const cardScope = pageId ? page.locator(`#${pageId}`) : page;
  const card = cardScope.locator('.property-card:visible, [data-property-card]:visible').first();
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
  }
  await go(page, route);
  const hasMap = await waitForMapIfPresent(page, route);
  const activeMapId = await visiblePublicMapId(page, route);
  const markerRoot = activeMapId ? `#${activeMapId}` : '';
  if (hasMap && markerRoot) {
    await page.locator(markerRoot).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(350);
  }
  const markerCount = markerRoot ? await page.locator(`${markerRoot} .leaflet-marker-icon:visible, ${markerRoot} [data-map-marker]:visible`).count() : 0;
  if (markerCount) {
    const markerIndex = await page.evaluate((activeMapId) => {
      const root = document.getElementById(activeMapId) || document;
      const nodes = Array.from(root.querySelectorAll('.leaflet-marker-icon, [data-map-marker]'))
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
    }, activeMapId);
    if (markerIndex < 0) {
      checks.push('no unobstructed map marker was clickable');
    } else {
      const marker = page.locator(`${markerRoot} .leaflet-marker-icon:visible, ${markerRoot} [data-map-marker]:visible`).nth(markerIndex);
      await marker.click({ timeout: 8000 }).catch((error) => {
        checks.push(`map marker click failed: ${error.message}`);
      });
    }
    await page.waitForSelector('.leaflet-popup:visible, #detail-content:visible, [data-map-marker-popup]:visible', { timeout: 1500 }).catch(() => {});
    const popupOrDetail = await page.locator('.leaflet-popup:visible, #detail-content:visible, [data-map-marker-popup]:visible').count();
    if (!popupOrDetail) checks.push('map marker did not open popup/detail');
    else await clickPopupDetailOrBrokerAction(page, checks);
  } else if (hasMap) {
    const googlePopupOpened = await clickGoogleMarkerCandidate(page, activeMapId);
    if (googlePopupOpened) {
      await clickPopupDetailOrBrokerAction(page, checks);
    } else {
      const visibleCards = await page.locator('.property-card:visible, [data-property-card]:visible, .broker-grid-card:visible').count();
      if (visibleCards) {
        const debug = await page.evaluate((expectedPageId) => {
          const activePage = document.getElementById(expectedPageId) || document.querySelector('.page.active') || document;
          const activeMap = Array.from(activePage.querySelectorAll('#map-home, #map-sale, #map-rent, #map-students, #map-commercial, #map-land, #map-brokers'))
            .find((el) => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 120 && rect.height > 120;
            })?.id || '';
          const registry = typeof markers !== 'undefined' ? markers : {};
          const providers = typeof mapProviders !== 'undefined' ? mapProviders : {};
          return {
            href: window.location.href,
            expectedPageId,
            expectedExists: !!document.getElementById(expectedPageId),
            activePages: Array.from(document.querySelectorAll('.page.active')).map((el) => el.id),
            activeMap,
            helper: typeof window.__makaugOpenFirstPublicMapMarker === 'function',
            provider: providers?.[activeMap] || '',
            markerCount: Array.isArray(registry?.[activeMap]) ? registry[activeMap].length : null,
            publicListings: typeof getPublicListings === 'function' ? getPublicListings().length : null
          };
        }, AUDIT_ROUTE_PAGE_IDS[route] || '').catch(() => ({}));
        checks.push(`map has listing/broker cards but no clickable marker popup was found ${JSON.stringify(debug)}`);
      }
    }
  }
  return checks;
}

function actionHasDestination(item) {
  if (item.disabled) return true;
  if (item.describedBy && item.role === 'button') return true;
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
  const watchPage = (targetPage) => {
    targetPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleIssues.push({ kind: 'console', text: msg.text() });
    });
    targetPage.on('pageerror', (err) => consoleIssues.push({ kind: 'pageerror', text: err.message || String(err) }));
    targetPage.on('response', (response) => {
      const status = response.status();
      if (status >= 400) responseFailures.push({ status, url: response.url() });
    });
  };
  watchPage(page);

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
          await page.waitForFunction(({ expectUrl, marker }) => {
            const pathMatches = expectUrl ? window.location.pathname.startsWith(expectUrl) : true;
            const textMatches = marker ? document.body.innerText.toLowerCase().includes(String(marker).toLowerCase()) : true;
            return pathMatches && textMatches;
          }, { expectUrl: action.expectUrl, marker: action.marker || '' }, { timeout: 6000 }).catch(() => {});
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

    const auditRoutes = ['/', '/to-rent', '/for-sale', '/land', '/off-plan', '/student-accommodation', '/commercial', '/brokers', '/list-property', '/advertise', '/mortgage', '/login', '/about', '/help', '/safety', '/anti-fraud'];
    await page.close().catch(() => {});
    const auditContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    for (const route of auditRoutes) {
      const auditPage = await auditContext.newPage();
      watchPage(auditPage);
      try {
        await go(auditPage, route);
        const actions = await auditVisibleActions(auditPage);
        const dead = actions.filter((item) => !actionHasDestination(item));
        const cardMarkerFailures = await auditCardsAndMarkers(auditPage, route);
        results.push({
          label: `Visible action audit ${route}`,
          route,
          selector: `${actions.length} visible actions`,
          ok: dead.length === 0 && cardMarkerFailures.length === 0,
          failures: dead.slice(0, 5).map((item) => `dead visible action: ${item.id || item.label || item.tag}`).concat(cardMarkerFailures)
        });
      } finally {
        await auditPage.close().catch(() => {});
      }
    }
    await auditContext.close().catch(() => {});
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
