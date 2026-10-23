'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isKnownPublicRoute, isProtectedPath, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');
const { resolvePublicPathAlias } = require('../services/publicPathAliases');
const { renderPublicNotFoundPage, notFoundLanguageFromRequest, NOT_FOUND_LANGS, PHRASES } = require('../services/publicNotFoundPage');

const root = path.join(__dirname, '..');

test('common property paths redirect to the SPA view that already owns them', () => {
  const cases = [
    ['/search', '/'],
    ['/Search/', '/'],
    ['/find', '/'],
    ['/properties', '/'],
    ['/listings', '/'],
    ['/homes', '/'],
    ['/search?search=Ntinda', '/for-sale?q=Ntinda'],
    ['/search?search=ntinda&type=rent&bedrooms=2', '/to-rent?q=ntinda&bedrooms=2'],
    ['/search?type=short-term&search=entebbe', '/short-term?q=entebbe'],
    ['/search?type=office', '/commercial?commercial_type=office'],
    ['/properties?listing_type=land&search=mukono', '/land?q=mukono'],
    ['/properties?listing_type=land&area=Mukono', '/land?area=Mukono'],
    ['/search?utm_source=ad', '/?utm_source=ad'],
    ['/buy', '/for-sale'],
    ['/buying', '/for-sale'],
    ['/buy/kampala?bedrooms=3', '/for-sale/kampala?bedrooms=3'],
    ['/properties/for-sale/kampala', '/for-sale/kampala'],
    ['/plots', '/land'],
    ['/land-for-sale', '/land'],
    ['/offices', '/commercial?commercial_type=office'],
    ['/offices/ntinda', '/commercial/ntinda?commercial_type=office'],
    ['/shops', '/commercial?commercial_type=shop_retail'],
    ['/warehouses', '/commercial?commercial_type=warehouse_industrial'],
    ['/agents', '/brokers'],
    ['/find-agents', '/brokers'],
    ['/agent/abc-123?lang=lg', '/agents/abc-123?lang=lg'],
    ['/shortterm', '/short-term'],
    ['/short-stays', '/short-term'],
    ['/hotels', '/short-term'],
    ['/hotels?search=jinja', '/short-term?q=jinja'],
    ['/hotels/jinja', '/short-term?q=jinja'],
    ['/airbnb', '/short-term'],
    ['/holiday-lets', '/short-term'],
    ['/vacation-rentals', '/short-term'],
    ['/shortterm/list-your-place', '/short-term/list-your-place'],
    ['/shortterm/hotel/speke', '/short-term/hotel/speke'],
    ['/hostels', '/student-accommodation'],
    ['/student', '/student-accommodation'],
    ['/offplan', '/off-plan'],
    ['/to-let', '/to-rent'],
    ['/rentals', '/to-rent'],
    ['/contact?x=1&x=2', '/help?x=1&x=2'],
    ['/faq', '/help'],
    ['/privacy', '/privacy-policy'],
    ['/legal/terms', '/terms'],
    ['/pricing', '/about']
  ];
  for (const [from, to] of cases) {
    const pathname = from.split('?')[0];
    assert.equal(resolvePublicPathAlias(pathname, from), to, from);
  }
});

test('paths that already have a page, and lookalikes, are not swallowed', () => {
  for (const pathName of ['/for-sale', '/to-rent', '/rent', '/sale', '/land', '/commercial', '/short-term', '/brokers', '/hostels/makerere', '/for-rent', '/for-rental', '/blog', '/random-xyz', '/api/properties']) {
    assert.equal(resolvePublicPathAlias(pathName, pathName), '', pathName);
  }
});

test('the not-found page is branded, searchable, and translated in all nine languages', () => {
  const packs = {};
  for (const lang of NOT_FOUND_LANGS.filter((code) => code !== 'en')) {
    packs[lang] = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'i18n', `site-${lang}.json`), 'utf8')).phrases;
  }
  for (const lang of NOT_FOUND_LANGS) {
    const html = renderPublicNotFoundPage({
      path: '/missing-page',
      query: lang === 'en' ? {} : { lang },
      headers: {}
    });
    assert.match(html, /<meta name="robots" content="noindex">/, lang);
    assert.match(html, /<form action="\/search" method="get" role="search">/, lang);
    assert.match(html, /name="search"/, lang);
    assert.match(html, new RegExp(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`), lang);
    for (const href of ['href="/"', 'href="/for-sale"', 'href="/to-rent"', 'href="/land"', 'href="/commercial"', 'href="/short-term"', 'href="/student-accommodation"', 'href="/brokers"', 'href="/help"']) {
      assert.ok(html.includes(href), `${lang} ${href}`);
    }
    for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) {
      assert.equal(html.includes(forbidden), false, `${lang} leaked ${forbidden}`);
    }
    const title = lang === 'en' ? PHRASES.title : packs[lang][PHRASES.title];
    const body = lang === 'en' ? PHRASES.body : packs[lang][PHRASES.body];
    assert.ok(title && title !== (lang === 'en' ? '' : PHRASES.title), `${lang} title`);
    assert.ok(html.includes(title), `${lang} shows ${title}`);
    assert.ok(html.includes(body.replace(/'/g, '&#39;')) || html.includes(body), `${lang} body`);
    assert.ok(html.includes(`href="/missing-page?lang=${lang}"`), `${lang} keeps its own language link`);
  }
  assert.equal(notFoundLanguageFromRequest({ headers: { cookie: 'makaug_lang=sw' }, query: {} }), 'sw');
  assert.equal(notFoundLanguageFromRequest({ headers: { 'accept-language': 'ar-UG,ar;q=0.8,en;q=0.5' }, query: {} }), 'ar');
  assert.equal(notFoundLanguageFromRequest({ headers: { cookie: 'makaug_lang=sw', 'accept-language': 'ar' }, query: { lang: 'lg' } }), 'lg');
});

test('nav, templates, sitemap hubs and app links do not target a dead path', () => {
  const dedicated = new Set(['/badge', '/sitemap.xml', '/robots.txt', '/site.webmanifest', '/favicon.ico', '/config.js', '/healthz']);
  function consider(file, href) {
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api') || href.startsWith('/assets') || href.startsWith('/legal/') || href.startsWith('/og/') || href.startsWith('/pay')) return;
    if (href.includes('${') || href.includes('{')) return;
    const pathName = href.split('?')[0].replace(/\/+$/, '') || '/';
    if (/\.[a-z0-9]{2,5}$/i.test(pathName)) return;
    if (isKnownPublicRoute(pathName) || isProtectedPath(pathName) || resolvePublicPathAlias(pathName, pathName) || dedicated.has(pathName)) return;
    assert.fail(`${file} links to ${pathName}, which would 404`);
  }
  const files = [
    'index.html',
    'assets/makaug-app.js',
    'assets/short-term.js',
    'assets/off-plan.js',
    'assets/makaug-site-i18n.js',
    'packages/shared-country-core/components/footer.html',
    'packages/shared-country-core/components/topbar-nav.html',
    'packages/shared-country-core/components/hero-search.html',
    'assets/marketing/makaug-agent-welcome.html'
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const re = /href\s*=\s*["'](\/[^"'#\s]*)/g;
    let match;
    while ((match = re.exec(text))) consider(file, match[1]);
  }
  const seo = fs.readFileSync(path.join(root, 'services/publicSeoService.js'), 'utf8');
  const hubs = [...seo.matchAll(/loc: `\$\{root\}(\/[a-z0-9./_-]*)`/g)].map((match) => match[1] || '/');
  assert.ok(hubs.includes('/about') && hubs.includes('/brokers') && hubs.includes('/badge'), 'sitemap hub scan saw the static entries');
  for (const hub of hubs) {
    const pathName = hub.replace(/\/+$/, '') || '/';
    if (pathName === '/badge') continue;
    assert.equal(isKnownPublicRoute(pathName), true, `sitemap ${pathName}`);
  }
});

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

function request(port, requestPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        location: res.headers.location || '',
        body: Buffer.concat(chunks).toString('utf8'),
        type: res.headers['content-type'] || '',
        robots: res.headers['x-robots-tag'] || ''
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the running server redirects alias paths and answers unknown paths with HTTP 404', { timeout: 120000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      MEMORY_LOG: 'off',
      STARTUP_DATA_REPAIRS: 'off',
      DATABASE_URL: process.env.DATABASE_URL || '',
      EVENT_LOOP_LAG_LOG: 'off'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  try {
    for (let i = 0; i < 240; i += 1) {
      try {
        const ready = await request(port, '/help', { Host: 'makaug.com' });
        if (ready.status === 200) break;
      } catch (_error) {}
      if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
      if (i === 239) throw new Error(`server did not start: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const checks = [
      ['/search', 301, '/'],
      ['/properties', 301, '/'],
      ['/buy', 301, '/for-sale'],
      ['/rent', 200, ''],
      ['/sale', 200, ''],
      ['/for-sale', 200, ''],
      ['/to-rent', 200, ''],
      ['/for-rent', 301, '/to-rent'],
      ['/for-rental', 404, ''],
      ['/short-term', 200, ''],
      ['/shortterm', 301, '/short-term'],
      ['/short-stays', 301, '/short-term'],
      ['/hotels?search=jinja', 301, '/short-term?q=jinja'],
      ['/agents', 301, '/brokers'],
      ['/land', 200, ''],
      ['/plots', 301, '/land'],
      ['/commercial', 200, ''],
      ['/offices', 301, '/commercial?commercial_type=office'],
      ['/hostels', 301, '/student-accommodation'],
      ['/offplan', 301, '/off-plan'],
      ['/blog', 404, ''],
      ['/contact?from=nav', 301, '/help?from=nav']
    ];
    for (const [requestPath, status, location] of checks) {
      const res = await request(port, requestPath, { Host: 'makaug.com' });
      assert.equal(res.status, status, requestPath);
      if (location) assert.equal(res.location, location, requestPath);
    }
    const missing = await request(port, '/this-page-is-not-real', { Host: 'makaug.com', Cookie: 'makaug_lang=lg' });
    assert.equal(missing.status, 404);
    assert.match(missing.robots, /noindex/);
    assert.match(missing.type, /html/);
    assert.match(missing.body, /Page not found|Omuko teguzuuliddwa/);
    assert.match(missing.body, /Omuko teguzuuliddwa/);
    assert.match(missing.body, /action="\/search"/);
    const head = await request(port, '/this-page-is-not-real', { Host: 'makaug.com' }, 'HEAD');
    assert.equal(head.status, 404);
    assert.equal(head.body, '');
    const api = await request(port, '/api/unknown-route-xyz', { Host: 'makaug.com' });
    assert.equal(api.status, 404);
    assert.match(api.type, /json/);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
});
