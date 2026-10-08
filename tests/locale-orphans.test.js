'use strict';

// PR G5: a translated phrase that carries a price must translate English text
// that still exists; otherwise an old price (25,000, the 300,000 blast…) lives
// on in a language pack after the English is gone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRICING = require('../config/pricing');

function englishSource() {
  const files = ['index.html', 'assets/makaug-app.js', 'assets/off-plan.js', 'assets/short-term.js', 'assets/short-term-admin.js', 'server.js', 'config/aboutCommercialProducts.js',
    ...fs.readdirSync(path.join(ROOT, 'services')).filter((f) => f.endsWith('.js')).map((f) => `services/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'routes')).filter((f) => f.endsWith('.js')).map((f) => `routes/${f}`)];
  return files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    .replace(/\{\{PRICE:([a-z_]+)\}\}/g, (m, k) => (PRICING[k] ? PRICING.ugx(PRICING[k].amount_ugx) : m))
    .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

test('every site-*.json key with UGX or USh appears verbatim in the English source', () => {
  const source = englishSource();
  const orphans = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'assets/i18n')).filter((f) => /^site-[a-z]+\.json$/.test(f))) {
    const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/i18n', file), 'utf8'));
    for (const key of Object.keys(pack.phrases)) {
      if (/UGX|USh/.test(key) && !source.includes(key.replace(/\s+/g, ' ').trim())) orphans.push(`${file}: ${key.slice(0, 100)}`);
    }
  }
  assert.deepEqual(orphans, [], orphans.join('\n'));
});

test('no old prices and no blast in the language packs', () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'assets/i18n')).filter((f) => /^site-[a-z]+\.json$/.test(f))) {
    const text = fs.readFileSync(path.join(ROOT, 'assets/i18n', file), 'utf8');
    assert.doesNotMatch(text, /25,000|300,000|Email and WhatsApp Campaign/, file);
  }
  const packs = fs.readFileSync(path.join(ROOT, 'assets/about-advertise-i18n.js'), 'utf8');
  assert.doesNotMatch(packs, /email_whatsapp_blast|"about\.periodPost": "[^"]*"[\s\S]{0,0}per post/);
});

test('the trial reads as a week, not minutes or a night (lg, sm, ny, rn)', () => {
  const ctx = { window: {} };
  require('vm').runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/about-advertise-i18n.js'), 'utf8'), ctx);
  const packs = ctx.window.__MAKAUG_ABOUT_ADVERTISE_I18N__;
  for (const code of ['lg', 'sm', 'ny', 'rn']) {
    const text = packs[code]['about.privateTrialTemplate'];
    assert.doesNotMatch(text, /Eddakiika|Ekiro/, code);
    assert.match(text, /\{price\}/, code);
  }
  for (const code of Object.keys(packs)) {
    assert.equal(packs[code]['about.vatIncluded'], PRICING.vat.labels[code], code);
    assert.ok(packs[code]['about.periodProjectThreeMonths'], code);
  }
});
