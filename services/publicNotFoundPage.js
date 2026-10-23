'use strict';

const fs = require('fs');
const path = require('path');
const {
  LANGUAGE_REGISTRY,
  LEGACY_TO_CANONICAL,
  ALIAS_TO_CANONICAL
} = require('../config/languageRegistry');

const NOT_FOUND_LANGS = Object.freeze(['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']);

const PHRASES = Object.freeze({
  title: 'Page not found',
  body: "We couldn't find that page. It may have moved, or the link may be wrong.",
  searchLabel: 'Search properties',
  searchPlaceholder: 'City, area, suburb or landmark',
  searchButton: 'Search',
  home: 'Home',
  forSale: 'For Sale',
  toRent: 'To Rent',
  land: 'Land',
  commercial: 'Commercial',
  shortTerm: 'Short Term',
  students: 'Student Accommodation',
  brokers: 'Find Brokers',
  help: 'Help Centre',
  language: 'Language',
  brandSubtitle: 'UGANDA PROPERTY'
});

const LINKS = Object.freeze([
  ['/', 'home'],
  ['/for-sale', 'forSale'],
  ['/to-rent', 'toRent'],
  ['/land', 'land'],
  ['/commercial', 'commercial'],
  ['/short-term', 'shortTerm'],
  ['/student-accommodation', 'students'],
  ['/brokers', 'brokers'],
  ['/help', 'help']
]);

const packCache = new Map();

function knownLegacyLanguage(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (!raw) return '';
  if (LANGUAGE_REGISTRY[raw]) return LANGUAGE_REGISTRY[raw].legacyCode;
  const canonical = LEGACY_TO_CANONICAL[raw] || ALIAS_TO_CANONICAL[raw];
  if (canonical && LANGUAGE_REGISTRY[canonical]) return LANGUAGE_REGISTRY[canonical].legacyCode;
  return '';
}

function notFoundLanguageFromRequest(req = {}) {
  const queryLang = knownLegacyLanguage(req.query && req.query.lang);
  if (queryLang) return queryLang;
  const cookie = String((req.headers && (req.headers.cookie || req.headers.Cookie)) || '');
  const match = cookie.match(/(?:^|; )makaug_lang=([^;]+)/);
  const cookieLang = knownLegacyLanguage(match ? decodeURIComponent(match[1]) : '');
  if (cookieLang) return cookieLang;
  const accept = String((req.headers && req.headers['accept-language']) || '');
  for (const part of accept.split(',')) {
    const tag = part.split(';')[0];
    const lang = knownLegacyLanguage(tag);
    if (lang) return lang;
  }
  return 'en';
}

function loadPack(lang) {
  if (lang === 'en') return null;
  if (packCache.has(lang)) return packCache.get(lang);
  const file = path.join(__dirname, '..', 'assets', 'i18n', `site-${lang}.json`);
  let phrases = null;
  try {
    phrases = JSON.parse(fs.readFileSync(file, 'utf8')).phrases || {};
  } catch (_error) {
    phrases = {};
  }
  packCache.set(lang, phrases);
  return phrases;
}

function phrase(lang, key) {
  const english = PHRASES[key] || '';
  if (!lang || lang === 'en') return english;
  const translated = loadPack(lang)[english];
  return translated || english;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function safePath(pathname = '/') {
  const pathName = String(pathname || '/').split('?')[0].split('#')[0];
  if (!pathName.startsWith('/') || pathName.startsWith('//') || pathName.includes('\\')) return '/';
  return pathName;
}

function languageByLegacy(code) {
  return Object.values(LANGUAGE_REGISTRY).find((language) => language.legacyCode === code) || null;
}

function renderPublicNotFoundPage(req = {}) {
  const requested = notFoundLanguageFromRequest(req);
  const lang = NOT_FOUND_LANGS.includes(requested) ? requested : 'en';
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const brandName = String(req.brand || 'makaug.com').trim() || 'makaug.com';
  const brand = escapeHtml(brandName);
  const makaug = /makaug/i.test(brandName);
  const pathName = safePath(req.path || '/');
  const t = (key) => escapeHtml(phrase(lang, key));
  const links = LINKS.map(([href, key]) => (
    `<a href="${href}">${t(key)}</a>`
  )).join('');
  const languages = NOT_FOUND_LANGS.map((code) => {
    const name = languageByLegacy(code)?.nativeName || code;
    const current = code === lang ? ' aria-current="true"' : '';
    return `<a href="${escapeHtml(`${pathName}?lang=${code}`)}" hreflang="${code}" lang="${code}"${current}>${escapeHtml(name)}</a>`;
  }).join('');
  const extraFont = lang === 'am'
    ? '&family=Noto+Sans+Ethiopic:wght@400;700'
    : lang === 'ar'
      ? '&family=Noto+Naskh+Arabic:wght@400;700'
      : '';

  return `<!doctype html>
<html lang="${lang}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${t('title')} | ${brand}</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800${extraFont}&amp;display=swap">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "Plus Jakarta Sans", "Noto Sans Ethiopic", "Noto Naskh Arabic", system-ui, sans-serif;
      background: #f4f7f4;
      color: #14251b;
    }
    a { color: inherit; }
    .top {
      background: #14532d;
      color: #fff;
    }
    .top-inner, main {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
    }
    .top-inner {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 14px 0;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      min-width: 0;
    }
    .brand img { width: 42px; height: 42px; border-radius: 12px; flex: none; }
    .brand strong { display: block; font-size: 22px; line-height: 1; letter-spacing: -0.03em; }
    .brand strong span { color: #f5c451; }
    .brand small { display: block; margin-top: 3px; color: #bbf7d0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
    .langs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .langs a {
      color: #dcfce7;
      text-decoration: none;
      border: 1px solid transparent;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .langs a[aria-current="true"] { background: #166534; border-color: #86efac; color: #fff; }
    main { padding: 28px 0 48px; }
    .card {
      background: #fff;
      border: 1px solid #d9e7dc;
      border-radius: 28px;
      padding: 28px 22px 24px;
      box-shadow: 0 18px 50px rgba(20, 83, 45, 0.08);
    }
    .code { margin: 0; color: #b45309; font-weight: 800; letter-spacing: 0.14em; font-size: 13px; }
    h1 { margin: 8px 0 10px; font-size: clamp(32px, 5vw, 48px); line-height: 1.05; letter-spacing: -0.04em; }
    .lead { margin: 0; max-width: 62ch; color: #3f5348; font-size: 17px; line-height: 1.5; }
    form {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 22px;
    }
    label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    input[type="search"] {
      flex: 1 1 240px;
      min-width: 0;
      height: 52px;
      border-radius: 14px;
      border: 1px solid #bbf7d0;
      padding: 0 14px;
      font: inherit;
      font-size: 16px;
      background: #f8faf8;
    }
    input[type="search"]:focus { outline: 3px solid #bbf7d0; border-color: #166534; }
    button {
      height: 52px;
      border: 0;
      border-radius: 14px;
      background: #166534;
      color: #fff;
      font: inherit;
      font-weight: 800;
      padding: 0 18px;
      cursor: pointer;
    }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
    nav a {
      text-decoration: none;
      background: #f0fdf4;
      color: #14532d;
      border: 1px solid #bbf7d0;
      border-radius: 999px;
      padding: 10px 14px;
      font-weight: 800;
      font-size: 14px;
    }
    nav a[href="/"] { background: #166534; color: #fff; border-color: #166534; }
    @media (max-width: 640px) {
      .top-inner, main { width: min(100% - 24px, 1080px); }
      .langs { justify-content: flex-start; }
      form { flex-direction: column; }
      button, input[type="search"] { width: 100%; }
      .card { padding: 22px 16px 18px; border-radius: 22px; }
    }
    @media (min-width: 1440px) {
      .top-inner, main { width: min(1120px, calc(100% - 64px)); }
    }
  </style>
</head>
<body>
  <header class="top">
    <div class="top-inner">
      <a class="brand" href="/">
        ${makaug ? '<img src="/assets/icons/makaug-mark.svg" alt="">' : ''}
        <span><strong>${makaug ? 'makaug<span>.com</span>' : brand}</strong>${makaug ? `<small>${t('brandSubtitle')}</small>` : ''}</span>
      </a>
      <nav class="langs" aria-label="${t('language')}">${languages}</nav>
    </div>
  </header>
  <main>
    <section class="card">
      <p class="code">404</p>
      <h1>${t('title')}</h1>
      <p class="lead">${t('body')}</p>
      <form action="/search" method="get" role="search">
        <label for="not-found-q">${t('searchLabel')}</label>
        <input id="not-found-q" name="search" type="search" placeholder="${t('searchPlaceholder')}" autocomplete="off">
        <button type="submit">${t('searchButton')}</button>
      </form>
      <nav aria-label="${t('home')}">${links}</nav>
    </section>
  </main>
</body>
</html>`;
}

module.exports = {
  NOT_FOUND_LANGS,
  PHRASES,
  notFoundLanguageFromRequest,
  renderPublicNotFoundPage,
  phrase
};
