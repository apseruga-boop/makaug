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
assert(html.includes('about-page-visual-refine-20260713'), 'HTML app version should include about-page-visual-refine marker');
assert(html.includes('about-cta-primary-20260713'), 'HTML app version should include about CTA primary marker');
assert(html.includes('about-hero-contrast-fix-20260713'), 'HTML app version should include about hero contrast fix marker');
assert(server.includes("aboutPageFullCopyVersion = 'about-page-full-copy-20260713'"), 'server should include about page release marker');
assert(server.includes("aboutPageVisualRefineVersion = 'about-page-visual-refine-20260713'"), 'server should include about visual refine release marker');
assert(server.includes("aboutCtaPrimaryVersion = 'about-cta-primary-20260713'"), 'server should include about CTA primary release marker');
assert(server.includes("aboutHeroContrastFixVersion = 'about-hero-contrast-fix-20260713'"), 'server should include about hero contrast fix release marker');
assert(server.includes('aboutPageFullCopyVersion'), 'server public app suffix list should include the about page marker');
assert(server.includes('aboutPageVisualRefineVersion'), 'server public app suffix list should include the about visual refine marker');
assert(server.includes('aboutCtaPrimaryVersion'), 'server public app suffix list should include the about CTA primary marker');
assert(server.includes('aboutHeroContrastFixVersion'), 'server public app suffix list should include the about hero contrast fix marker');

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
assert(aboutBlock.includes('about-hero-panel bg-[#0f3d2e]'), 'About hero should carry an explicit dark panel class');
assert(aboutBlock.includes('about-vision-panel rounded-xl'), 'About vision block should carry an explicit dark panel class');
assert(html.includes('#page-about .about-hero-panel') && html.includes('#page-about .about-vision-panel'), 'About contrast fix should use scoped hero and vision CSS');
assert(html.includes('background: #0f3d2e'), 'About contrast fix should force the approved deep green background in inline CSS');
assert(aboutBlock.includes('about-hero-cta-primary'), 'About hero primary CTA should have explicit contrast-safe styling');
assert(aboutBlock.includes('about-hero-cta-secondary'), 'About hero secondary CTA should have explicit contrast-safe styling');
assert(aboutBlock.includes('about-hero-cta-social'), 'About hero WhatsApp CTA should have explicit contrast-safe styling');
assert(aboutBlock.includes('about-stat-card rounded-xl border border-[#e4ece8] bg-white'), 'About stat cards should use one uniform white card treatment');
assert(aboutBlock.includes('bg-[#f0f6f2]'), 'final CTA should use the approved green-tint panel');
assert(aboutBlock.includes('about-final-cta-actions'), 'final CTA should have a dedicated three-button action row');
const finalCtaStart = aboutBlock.indexOf('<section class="about-card rounded-[14px] bg-[#f0f6f2]');
const finalCtaEnd = aboutBlock.indexOf('</section>', finalCtaStart);
assert(finalCtaStart >= 0 && finalCtaEnd > finalCtaStart, 'final CTA section should exist');
const finalCtaBlock = aboutBlock.slice(finalCtaStart, finalCtaEnd);
const finalCtaLinks = [...finalCtaBlock.matchAll(/<a\s+([^>]*?)>(.*?)<\/a>/g)].map((match) => ({
  attrs: match[1],
  text: match[2].replace(/<[^>]+>/g, '').trim()
}));
assert.deepStrictEqual(
  finalCtaLinks.slice(0, 3).map((link) => link.text),
  ['Search property', 'List free', 'Chat on WhatsApp'],
  'final CTA buttons should render Search property, List free, Chat on WhatsApp in order'
);
assert(finalCtaLinks[0].attrs.includes('href="/for-sale"'), 'Search property CTA should link to /for-sale');
assert(finalCtaLinks[0].attrs.includes('about-final-cta-primary'), 'Search property CTA should use the solid primary class');
assert(finalCtaLinks[1].attrs.includes('href="/list-property"'), 'List free CTA should link to /list-property');
assert(finalCtaLinks[1].attrs.includes('about-final-cta-secondary'), 'List free CTA should use the outline secondary class');
assert(finalCtaLinks[2].attrs.includes('wa.me/256760112587'), 'WhatsApp CTA should link to makaug WhatsApp');
assert(finalCtaLinks[2].attrs.includes('about-final-cta-secondary'), 'WhatsApp CTA should use the outline secondary class');
assert(!/(?:bg|text|border)-(?:amber|yellow|orange|purple|blue|red)-/.test(aboutBlock), 'About page should not use yellow/multicolour Tailwind palette classes');
assert(!aboutBlock.includes('#d9a441'), 'About page should not use the old gold/yellow accent');
assert.strictEqual((aboutBlock.match(/<section[^>]*bg-\[#0f3d2e\]/g) || []).length, 1, 'Only the vision section should be a dark feature block');
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
  'function fetchAboutPublicListingsTotal',
  'function aboutLiveListingTotal',
  'pagination?.total',
  'PUBLIC_OPPORTUNITY_SUMMARY_PATH',
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
