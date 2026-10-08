'use strict';

// PR G3: the About dictionaries held ~145 keys nothing rendered (old "free
// listing" copy among them). They were deleted; this keeps every remaining
// about.* key one that index.html, the bundle or the server actually uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('every about.* dictionary key is rendered somewhere', () => {
  const app = read('assets/makaug-app.js');
  const definition = /^\s*"(about\.[A-Za-z0-9_.]+)":\s/;
  const keys = new Set();
  const usage = [];
  for (const line of app.split('\n')) {
    const match = line.match(definition);
    if (match) keys.add(match[1]);
    else usage.push(line);
  }
  for (const match of read('assets/about-advertise-i18n.js').matchAll(/"(about\.[A-Za-z0-9_.]+)":/g)) keys.add(match[1]);
  const corpus = [usage.join('\n'), read('index.html'), read('server.js'),
    ...fs.readdirSync(path.join(ROOT, 'services')).filter((f) => f.endsWith('.js')).map((f) => read(`services/${f}`))].join('\n');
  const dead = [...keys].filter((key) => !corpus.includes(`"${key}"`) && !corpus.includes(`'${key}'`));
  assert.deepEqual(dead, [], `about.* keys nothing renders:\n${dead.join('\n')}`);
});

test('the deleted free-listing copy is gone', () => {
  for (const file of ['assets/makaug-app.js', 'assets/about-advertise-i18n.js']) {
    const text = read(file);
    for (const key of ['about.valueFreeTitle', 'about.valueFreeText', 'about.chooseFreeTitle', 'about.chooseFreeText', 'about.adsTitle', 'about.adSeparationText', 'about.ownersText', 'about.contactText']) {
      assert.ok(!text.includes(`"${key}"`), `${file} still defines ${key}`);
    }
  }
});
