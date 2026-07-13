const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const frontend = read('assets/makaug-app.js');
const server = read('server.js');

const aboutStart = html.indexOf('<div id="page-about"');
const aboutEnd = html.indexOf('<div id="page-admin-docs"', aboutStart);
assert(aboutStart >= 0 && aboutEnd > aboutStart, 'About page block should exist before admin docs');
const aboutBlock = html.slice(aboutStart, aboutEnd);
const normalizedAbout = aboutBlock.replace(/\s+/g, ' ');

assert(html.includes('about-page-full-copy-20260713'), 'HTML app version should include about-page-full-copy marker');
assert(server.includes("aboutPageFullCopyVersion = 'about-page-full-copy-20260713'"), 'server should include about page release marker');
assert(server.includes('aboutPageFullCopyVersion'), 'server public app suffix list should include the about page marker');

[
  'Every property in Uganda, finally in one place',
  'We find every property, so you don\'t have to',
  'Discovered by AI · checked by our team · live for buyers',
  'Everything you can do',
  'Property made simple — whoever you are',
  'From search to sorted, in three steps',
  'Find and list land — without pretending to clear titles',
  'Trust comes first',
  'Why people choose makaug',
  'Ready to find your place?'
].forEach((copy) => {
  assert(normalizedAbout.includes(copy), `/about is missing approved copy: ${copy}`);
});

[
  'Property in Uganda should be easier to find, easier to list, and safer to trust.',
  'Who we are',
  'Our mission',
  'Why makaug exists',
  'How we support trust and safety'
].forEach((oldCopy) => {
  assert(!normalizedAbout.includes(oldCopy), `/about still renders old copy: ${oldCopy}`);
});

assert(aboutBlock.includes('id="about-live-listing-count"'), 'About page should include a live listings count node');
assert(aboutBlock.includes('data-about-stat-count="146"'), 'About stats should include count-up district metric');
assert(aboutBlock.includes('data-about-stat-count="9"'), 'About stats should include count-up language metric');
assert(aboutBlock.includes('about-ai-pipeline'), 'About page should include the animated AI pipeline');
assert(aboutBlock.includes('data-about-persona="renters"'), 'About page should include persona selector buttons');
assert(aboutBlock.includes('onclick="setAboutPersona(\'businesses\')"'), 'About persona selector should be interactive');

const aboutKeys = [...new Set([...aboutBlock.matchAll(/data-content-i18n="([^"]+)"/g)].map((match) => match[1]))];
assert(aboutKeys.length >= 90, 'About page should wire all visible copy through content i18n');
aboutKeys.forEach((key) => {
  assert(frontend.includes(`"${key}"`), `content i18n dictionary missing About key: ${key}`);
});

[
  'ABOUT_PAGE_I18N_EN',
  'function setAboutPersona',
  'ABOUT_PERSONA_ROUTES',
  'function updateAboutPageUi',
  'function animateAboutStatNumber',
  'updateAboutPageUi(stats)',
  'CONTENT_I18N[code] = Object.assign({}, CONTENT_I18N[code] || {}, ABOUT_PAGE_I18N_EN)'
].forEach((needle) => {
  assert(frontend.includes(needle), `frontend missing About page wiring: ${needle}`);
});

[
  'lg',
  'sw',
  'ac',
  'ny',
  'rn',
  'sm',
  'am',
  'ar'
].forEach((code) => {
  assert(frontend.includes(`"${code}"`), `About i18n fallback should cover ${code}`);
});

assert(frontend.includes('window.setAboutPersona = setAboutPersona'), 'persona selector should expose the handler for inline buttons');
assert(frontend.includes('document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr"'), 'Arabic RTL support should remain wired');

console.log('About page full-copy regression checks passed.');
