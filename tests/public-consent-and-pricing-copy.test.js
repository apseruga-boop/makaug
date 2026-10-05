'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');

const root = path.resolve(__dirname, '..');
const sourceHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function render(pathname) {
  return sanitizePublicHtml(sourceHtml, { pathname });
}

test('rendered guest privacy policy discloses granular measurement and OpenAI attribution', () => {
  const html = render('/privacy-policy');

  assert.match(html, /Last updated: 5 October 2026/);
  assert.match(html, /Optional analytics is used only with analytics consent/);
  assert.match(html, /Optional advertising measurement is used only with advertising consent/);
  assert.match(html, /OpenAI referral identifier \(<strong>oppref<\/strong>\)/);
  assert.match(html, /Meta, Google, and OpenAI/);
  assert.match(html, /Use Cookie settings in the site footer/);
  assert.doesNotMatch(html, /Last updated: 25 July 2026/);
});

test('rendered guest cookie policy opens granular Cookie settings without requiring login', () => {
  const html = render('/cookie-policy');

  assert.match(html, /Optional analytics/);
  assert.match(html, /Optional advertising measurement/);
  assert.match(html, /OpenAI referral parameter \(<strong>oppref<\/strong>\)/);
  assert.match(html, /advertising consent is granted/);
  assert.match(html, /onclick="openMakaugCookieSettings\(\); return false;"/);
  assert.doesNotMatch(html, /login\?next=%2Faccount%3Ftab%3Dpreferences/);
});

test('rendered public pricing copy states the trial, fee, and separate agent plans', () => {
  for (const pathname of ['/how-it-works', '/terms']) {
    const html = render(pathname);
    assert.match(html, /first 7 days/i, `${pathname} must state the private-listing trial`);
    assert.match(html, /UGX 25,000 per property\/month/, `${pathname} must state the private-listing monthly price`);
    assert.match(html, /Agent plans[^.]*priced separately/i, `${pathname} must separate agent-plan pricing`);
    assert.doesNotMatch(html, /guided free listing form/i, `${pathname} must not promise an unlimited free listing`);
  }
});
