'use strict';

// PR G8: every price comes from config/pricing.js. Fails if a hard-coded
// rate-card amount comes back anywhere a customer, agent or staff member reads.

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
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(rel, filter, out);
    } else if (filter(rel)) {
      out.push(rel);
    }
  }
  return out;
}

const SCANNED = [
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

const ALLOWED_FILES = new Set(['config/pricing.js']);
// Guard amounts (192–196) and target amounts (191, 197) in the manual SQL;
// the targets are checked against the rate card below.
const GUARD_AMOUNT_FILE = /^db\/manual\/pricing\/19[1-7]/;
// Numbers that are not money but sit next to a money word.
const NOT_MONEY = [
  'assets/makaug-app.js:step="100000"', // mortgage extra-payment input step
  'assets/makaug-app.js:id="admin-marketplace-drip-cap" type="number" min="1" max="100000"', // request cap
  "assets/short-term-admin.js:placeholder: '200000'", // example nightly rate in the intake form
  'packages/shared-country-core/south-africa.js:HERO_PRICE_OPTIONS_UGX' // ZA rand filter options
];

const PRICE_TEXT = /(UGX|USh|Shs)\s?(15|20|25|35|40|50|75|80|100|120|150|160|180|200|220|240|250|300|350|650|950)[,.]?000(?![\d,])/;
const PRICE_NUMBER = /(?<![\d.])(20000|25000|50000|75000|100000|150000|200000)(?![\d])/;
const PRICE_WORD = /fee|price|amount|monthly|ugx|plan|guide/i;

function hits(file) {
  const out = [];
  let source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // data-rate elements are written from the rate card (scripts/render-marketing-prices.js);
  // the test below checks they still match it.
  source = source.replace(/(<([a-z]+)\b[^>]*\sdata-rate="[a-z_]+"[^>]*>)[^<]*(<\/\2>)/g, '$1$3');
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 4000) return; // minified/translation blobs are checked by the text rule only below
    if (NOT_MONEY.some((entry) => { const [f, snippet] = [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)]; return f === file && line.includes(snippet); })) return;
    if (PRICE_TEXT.test(line)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
    // Input attributes (step/min/max/maxlength) are not prices.
    else if (PRICE_NUMBER.test(line.replace(/\b(?:step|min|max|maxlength)="\d+"/g, '')) && PRICE_WORD.test(line) && !GUARD_AMOUNT_FILE.test(file)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  if (lines.some((line) => line.length > 4000)) {
    const text = lines.filter((line) => line.length > 4000).join('\n');
    const m = text.match(new RegExp(PRICE_TEXT.source, 'g'));
    if (m) out.push(`${file}: long line contains ${m.slice(0, 5).join(', ')}`);
  }
  return out;
}

test('no hard-coded rate-card price outside config/pricing.js', () => {
  const found = SCANNED.filter((f) => !ALLOWED_FILES.has(f)).flatMap(hits);
  assert.deepEqual(found, [], `hard-coded prices:\n${found.join('\n')}`);
});

test('the email + WhatsApp blast is gone everywhere outside tests', () => {
  const files = [...SCANNED, ...walk('config', (f) => f.endsWith('.js')), ...walk('utils', (f) => f.endsWith('.js')), ...walk('db/migrations', () => false)];
  const found = files.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('email_whatsapp_blast'));
  assert.deepEqual(found, []);
});

test('SVG marketing prices match the rate card', () => {
  const { renderRates, FILES } = require('../scripts/render-marketing-prices');
  for (const file of FILES) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(renderRates(text), text, `${file} is out of date: run node scripts/render-marketing-prices.js`);
  }
});

test('manual SQL target amounts equal the rate card', () => {
  const PRICING = require('../config/pricing');
  const s191 = fs.readFileSync(path.join(ROOT, 'db/manual/pricing/191_lister_fee_20000.sql'), 'utf8');
  assert.match(s191, new RegExp(`to_jsonb\\(${PRICING.private_listing.amount_ugx}\\)`));
  assert.match(s191, new RegExp(`IS DISTINCT FROM '${PRICING.private_listing.amount_ugx}'`));
  const s197 = fs.readFileSync(path.join(ROOT, 'db/manual/pricing/197_products_off_sale.sql'), 'utf8');
  assert.match(s197, new RegExp(`\\n\\s+${PRICING.boosted.amount_ugx}\\n`));
});

test('only the schema change 190 is in db/migrations for this PR', () => {
  const files = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter((f) => /^1[7-9]\d_/.test(f));
  assert.deepEqual(files, ['190_agent_fee_exempt_until.sql']);
  const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/190_agent_fee_exempt_until.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_exempt_until DATE;/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bINSERT\b|\bDELETE\b|DEFAULT/i);
});
