'use strict';

// PR G8: no "free forever" wording anywhere a customer or agent reads it.
// Free trials ("first 7 days free") and free search are fine; a free
// platform, free listing or "lists for free" is not.

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir, filter, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, filter, out);
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

const FILES = [
  ...walk('routes', (f) => f.endsWith('.js')),
  ...walk('services', (f) => f.endsWith('.js')),
  'server.js',
  'index.html',
  'assets/makaug-app.js',
  ...walk('assets', (f) => /^assets\/short-term[^/]*\.js$/.test(f)),
  'assets/about-advertise-i18n.js',
  ...walk('assets/i18n', (f) => f.endsWith('.json')),
  ...walk('assets/marketing', (f) => /\.(html|svg)$/.test(f)),
  ...walk('packages/shared-country-core', (f) => /\.(js|html|json)$/.test(f)),
  ...walk('scripts/listing-explainer-video', (f) => f.endsWith('.html')),
  ...walk('db/manual/pricing', () => true)
].filter((f) => fs.existsSync(path.join(ROOT, f)));

const FREE_FOREVER = /free (property )?(platform|portal)|free to list|list(ing)? (property )?(for )?free\b|free listing|no listing (fee|charge)|without (a )?listing fee|for good|lists for free|free_default|remains free/i;
const TRANSLATED = [/bure la mali/i, /ya bwereere/i, /olwa bwerere/i, /obwereere/i, /rw'ubuntu/i, /ነፃ የንብረት/, /Listing bure/i, /(مجاني|المجانية)[^\n"']{0,20}(منصة|عقار|إدراج)|(منصة|عقار|إدراج)[^\n"']{0,20}(مجاني|المجانية)/];
const ALLOWED = [/first 7 days free/gi, /7 days free/gi, /first week free/gi, /Free to search/gi, /free account/gi, /Free registration/gi, /Free guide/gi, /No commission/gi,
  // "free account" in Luganda/Runyankole ("account ey'obwereere"): an account, not a listing.
  /(?:account|akaunti)(?: [a-z']+){0,3} (?:eya |ey'|y')?o?bwereere/gi, /Account ya Bwereere/gi];

// Code that is not copy: comments about timers, input-only intent regexes.
const NOT_COPY = [
  /hold the queue for good/i,
  /Everyone remains Free by|remains Free by default/, // db/manual/pricing/197 removes this text
  /Uganda's first completely free property platform/, // dead KE/ZA rewrite rules for text Uganda no longer has
  /free property\)\\b\/i\.test\(clean\)/ // "free property" is an input-only intent (G3)
];

function offending(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (NOT_COPY.some((re) => re.test(line))) return;
    let clean = line;
    for (const re of ALLOWED) clean = clean.replace(re, '');
    if (FREE_FOREVER.test(clean) || TRANSLATED.some((re) => re.test(clean))) out.push(`${i + 1}: ${line.trim().slice(0, 150)}`);
  });
  return out;
}

// Site phrase packs are { English: translation }: a translation of an allowed
// English phrase ("free account", "7 days free") is allowed too.
function offendingPhrasePack(text) {
  const pack = JSON.parse(text);
  const out = [];
  for (const [english, translated] of Object.entries(pack.phrases || {})) {
    let clean = english;
    for (const re of ALLOWED) clean = clean.replace(re, '');
    if (clean !== english && !FREE_FOREVER.test(clean)) continue;
    const hit = offending(`${english}\n${translated}`);
    if (hit.length) out.push(`${english} => ${String(translated).slice(0, 80)}`);
  }
  return out;
}

test('no free-forever wording in the source', () => {
  const found = FILES.flatMap((f) => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hits = /^assets\/i18n\/site-[a-z]+\.json$/.test(f) ? offendingPhrasePack(text) : offending(text);
    return hits.map((hit) => `${f}:${hit}`);
  });
  assert.deepEqual(found, [], found.join('\n'));
});

test('every WhatsApp welcome, in every language, passes', () => {
  const whatsapp = fs.readFileSync(path.join(ROOT, 'routes', 'whatsapp.js'), 'utf8');
  const welcomes = whatsapp.match(/\bwelcome: [`'"][^\n]+/g) || [];
  assert.ok(welcomes.length >= 9, `found ${welcomes.length} welcome messages`);
  for (const line of welcomes) assert.deepEqual(offending(line), [], line);
});

test('rendered pages carry no free-forever wording', async () => {
  const { spawn } = require('child_process');
  const net = require('net');
  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test', MEMORY_LOG: 'off' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 180; i += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const page of ['/', '/about', '/how-it-works', '/terms', '/list-property', '/advertise']) {
      const res = await fetch(base + page);
      assert.equal(res.status, 200, page);
      // The inlined rate card script is data, not copy.
      const text = (await res.text()).replace(/<script[^>]*data-makaug-pricing[\s\S]*?<\/script>/, '');
      assert.deepEqual(offending(text), [], page);
    }
  } finally {
    child.kill('SIGTERM');
  }
});
