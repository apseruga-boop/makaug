'use strict';

/** S5: "Listed on makaug.com" badge: assets, /badge page, dashboard snippet. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { agentBadgeSnippet, genericBadgeSnippet, renderBadgePage, escapeHtml } = require('../services/agentBadge');
const { sitemapEntries } = require('../services/publicSeoService');

const FILES = ['light', 'dark'].flatMap((v) => ['.png', '@2x.png', '@3x.png', '.svg'].map((ext) => `makaug-listed-badge-${v}${ext}`));

test('all eight badge files are committed under assets/badge and look like images', () => {
  for (const file of FILES) {
    const full = path.join(root, 'assets/badge', file);
    assert.ok(fs.existsSync(full), file);
    const head = fs.readFileSync(full).subarray(0, 8);
    if (file.endsWith('.png')) assert.strictEqual(head.toString('latin1', 1, 4), 'PNG', file);
    else assert.match(fs.readFileSync(full, 'utf8'), /^<svg/);
  }
  for (const file of FILES.filter((f) => f.endsWith('.svg'))) {
    assert.ok(!/<script|onload=|href=/i.test(read(`assets/badge/${file}`)), `${file} has no active content`);
  }
});

test('/badge is a public indexable page that contains the snippet and is routed and in the sitemap', () => {
  const html = renderBadgePage();
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /<link rel="canonical" href="https:\/\/makaug\.com\/badge">/);
  assert.ok(html.includes(escapeHtml(genericBadgeSnippet('light'))), 'light snippet is shown as code');
  assert.ok(html.includes('makaug-listed-badge-dark@3x.png'));
  assert.doesNotMatch(html, /nofollow|sponsored/);
  assert.match(read('server.js'), /app\.get\('\/badge'/);
  const entries = sitemapEntries({}, 'https://makaug.com');
  assert.ok(entries.some((e) => e.loc === 'https://makaug.com/badge'));
});

test('/brokers links to /badge in its server HTML', () => {
  const brokers = read('index.html').split('id="page-brokers"')[1].split('id="brokers-grid"')[0];
  assert.match(brokers, /href="\/badge"/);
});

test('agent snippet has the agent id, utm link, srcset, size and no nofollow', () => {
  const html = agentBadgeSnippet({ agentId: 'abc-123', agencyName: 'Acme Homes' });
  assert.ok(html.includes('href="https://makaug.com/agents/abc-123?utm_source=agent_badge&utm_medium=referral&utm_campaign=badge"'));
  assert.ok(html.includes('title="Acme Homes on makaug.com"'));
  assert.ok(html.includes('srcset="https://makaug.com/assets/badge/makaug-listed-badge-light@2x.png 2x, https://makaug.com/assets/badge/makaug-listed-badge-light@3x.png 3x"'));
  assert.ok(html.includes('width="239" height="64"'));
  assert.doesNotMatch(html, /nofollow|sponsored|rel=/);
});

test('agency names are HTML-escaped', () => {
  const html = agentBadgeSnippet({ agentId: 'x', agencyName: '"><script>alert(1)</script> & Co' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(html.includes('&amp; Co on makaug.com'));
});

test('the dashboard builds exactly the same snippet as the server', () => {
  const app = read('assets/makaug-app.js');
  const grab = (name) => {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start > -1, name);
    let depth = 0; let i = app.indexOf('{', start);
    for (; i < app.length; i += 1) {
      if (app[i] === '{') depth += 1;
      if (app[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    return app.slice(start, i + 1);
  };
  const ctx = vm.createContext({});
  vm.runInContext(`${grab('brokerBadgeEscape')}\n${grab('brokerBadgeSnippet')}`, ctx);
  for (const variant of ['light', 'dark']) {
    for (const name of ['Acme Homes', "O'Neil & <Sons>", '']) {
      assert.strictEqual(
        ctx.brokerBadgeSnippet('id-9', name, variant),
        agentBadgeSnippet({ agentId: 'id-9', agencyName: name, variant })
      );
    }
  }
});

test('the card only renders for approved agents with a live listing', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('function renderBrokerBadgeCard(');
  const body = app.slice(start, start + 700);
  assert.match(body, /status !== "approved"/);
  assert.match(body, /liveCount > 0/);
  assert.ok(read('assets/build/makaug-app.min.js').includes('renderBrokerBadgeCard'));
});

test('/agents/:id is index,follow with a utm-free self-canonical', () => {
  const server = read('server.js');
  const idx = server.indexOf("const profilePath = `/agents/${encodeURIComponent(row.id)}`");
  assert.ok(idx > -1, 'canonical is built from the agent id, never from the request URL');
  assert.match(server.slice(idx, idx + 4000), /canonical: absolutePublicUrl\(profilePath\)/);
  const route = server.slice(server.indexOf("app.get('/agents/:id'"), server.indexOf("app.get('/agents/:id'") + 1800);
  assert.doesNotMatch(route, /noindex/);
  assert.match(read('index.html'), /<meta name="robots" content="index,follow/);
});
