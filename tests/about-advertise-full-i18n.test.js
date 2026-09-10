#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const packSource = read('assets/about-advertise-i18n.js');

function extractFrozenObject(source, name) {
  const marker = `const ${name} = Object.freeze({`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = start + marker.length;
  const end = source.indexOf('\n});', bodyStart);
  assert(end > bodyStart, `${name} should have a closing marker`);
  const body = source.slice(bodyStart, end);
  const values = {};
  const pattern = /"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(body))) values[match[1]] = JSON.parse(`"${match[2]}"`);
  return values;
}

const english = {
  ...extractFrozenObject(app, 'ABOUT_PAGE_I18N_EN'),
  ...extractFrozenObject(app, 'ADVERTISING_UI_I18N_EN')
};
const context = { window: {} };
vm.createContext(context);
vm.runInContext(packSource, context, { filename: 'about-advertise-i18n.js' });
const packs = context.window.__MAKAUG_ABOUT_ADVERTISE_I18N__;
const languages = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];

assert(packs && typeof packs === 'object', 'generated About/Advertise language pack should load');
assert(html.includes('/assets/about-advertise-i18n.js?v=about-advertise-i18n-20260910-v1'), 'page should load the generated language pack');
assert(html.indexOf('/assets/about-advertise-i18n.js') < html.indexOf('/assets/makaug-app.js'), 'language pack should load before the main app');

const placeholderTokens = (value) => Array.from(String(value).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g), (match) => match[1]).sort();
const markupTokens = (value) => Array.from(String(value).matchAll(/<\/?[a-z][^>]*>/gi), (match) => match[0]).sort();
for (const code of languages) {
  assert(packs[code], `${code} language pack should exist`);
  for (const [key, englishValue] of Object.entries(english)) {
    const translated = packs[code][key];
    assert.strictEqual(typeof translated, 'string', `${code}:${key} should be a string`);
    assert(translated.trim(), `${code}:${key} should not be empty`);
    assert.deepStrictEqual(placeholderTokens(translated), placeholderTokens(englishValue), `${code}:${key} should preserve template placeholders`);
    assert.deepStrictEqual(markupTokens(translated), markupTokens(englishValue), `${code}:${key} should preserve markup tokens`);
  }
  [
    'about.title',
    'about.subtitle',
    'about.missionText',
    'about.featuredText',
    'about.reportText',
    'advertise.title',
    'advertise.subtitle',
    'advertise.chooseTitle',
    'advertise.dashboardText',
    'advertise.previewDisclaimer',
    'advertise.package.featured_property_boost.copy'
  ].forEach((key) => assert.notStrictEqual(packs[code][key], english[key], `${code}:${key} should change language`));
}

const aboutStart = html.indexOf('<div id="page-about"');
const aboutEnd = html.indexOf('<div id="page-admin-docs"', aboutStart);
const advertiseStart = html.indexOf('<div id="page-advertise"');
const advertiseEnd = html.indexOf('<div id="page-valuation"', advertiseStart);
assert(aboutStart >= 0 && aboutEnd > aboutStart, 'About page block should exist');
assert(advertiseStart >= 0 && advertiseEnd > advertiseStart, 'Advertise page block should exist');
const translatableMarkup = `${html.slice(aboutStart, aboutEnd)}\n${html.slice(advertiseStart, advertiseEnd)}`;
const markupKeys = Array.from(translatableMarkup.matchAll(/data-content-i18n(?:-placeholder|-aria|-alt)?="([^"]+)"/g), (match) => match[1]);
assert(markupKeys.length > 100, 'About and Advertise should expose comprehensive language bindings');
for (const key of new Set(markupKeys)) {
  assert(english[key], `English dictionary should cover markup key ${key}`);
  for (const code of languages) {
    assert(packs[code][key], `${code} should cover markup key ${key}`);
    const sameValueAllowed = [
      'about.discoveryYoutubeTitle',
      'about.discoveryTikTokTitle',
      'about.discoveryGoogleTitle',
      'advertise.targetAreasPlaceholder',
      'advertise.contactWhatsapp',
      'advertise.whatsappOption'
    ].includes(key);
    if (!sameValueAllowed && /[A-Za-z]/.test(english[key])) {
      assert.notStrictEqual(packs[code][key], english[key], `${code}:${key} visible UI should change language`);
    }
  }
}

assert(app.includes('window.__MAKAUG_ABOUT_ADVERTISE_I18N__?.[code] || {}'), 'generated language pack should be merged for every supported language');
assert(!app.includes('Object.assign({}, CONTENT_I18N[code] || {}, ABOUT_PAGE_I18N_EN)'), 'English defaults must not overwrite a selected language');
assert(app.includes('[data-content-i18n-placeholder]'), 'translated placeholders should be applied');
assert(app.includes('[data-content-i18n-aria]'), 'translated accessibility labels should be applied');
assert(app.includes('[data-content-i18n-alt]'), 'translated image alternatives should be applied');
assert(app.includes('function applyAdvertisingLanguageUI()'), 'Advertise dynamic content should rerender on language changes');
assert(app.includes('renderAdvertisingPackageOptions();'), 'Advertise package cards should rerender on language changes');
assert(app.includes('previewModal?.classList.contains("open")'), 'language switching should detect the real open modal state');
assert(app.includes('openAdvertisingPlacementPreview(advertisingPlacementPreviewKey, null, false)'), 'an open placement modal should rerender on language changes');

const packageFields = ['label', 'description', 'copy', 'locations', 'bestFor', 'headline', 'capture'];
const packageKeys = Array.from(app.matchAll(/^\s{2}([a-z_]+): \{$/gm), (match) => match[1])
  .filter((key) => app.includes(`"advertise.package.${key}.label"`));
assert(packageKeys.length >= 10, 'all advertising packages should have localized dynamic copy');
for (const packageKey of packageKeys) {
  for (const field of packageFields) {
    const key = `advertise.package.${packageKey}.${field}`;
    assert(english[key], `English dictionary should cover ${key}`);
    for (const code of languages) {
      assert(packs[code][key], `${code} should cover ${key}`);
      if (/[A-Za-z]/.test(english[key])) assert.notStrictEqual(packs[code][key], english[key], `${code}:${key} should change language`);
    }
  }
}

const previewImages = Array.from(app.matchAll(/screenshot: "(\/assets\/advertising-previews\/[^"]+)"/g), (match) => match[1]);
assert(previewImages.length >= 8, 'website placement types should use live-site screenshot previews');
for (const imagePath of new Set(previewImages)) {
  assert(fs.existsSync(path.join(root, imagePath.replace(/^\//, ''))), `preview asset should exist: ${imagePath}`);
}
assert(html.includes('The dashboard is for returning advertisers to manage submitted campaigns'), 'support and dashboard roles should be explained separately');
assert(html.includes('class="advertise-sidebar-dashboard"'), 'dashboard action should be positioned inside the support sidebar');

console.log(`About/Advertise full i18n passed (${Object.keys(english).length} keys × ${languages.length} translated languages; ${new Set(markupKeys).size} bound UI keys)`);
