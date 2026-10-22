'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');
const { compactUgx } = require('../utils/compactUgx');
const { realPhotoRejection } = require('../utils/realListingPhoto');
const { composeAgentBio } = require('./agentPublicProfileService');

const ROOT = path.join(__dirname, '..');
const WIDTH = 1200;
const HEIGHT = 630;
const PHOTO_DIR = path.join(ROOT, 'assets', 'og', 'photos');
const LOGO_PATH = path.join(ROOT, 'assets', 'icons', 'makaug-icon-512.png');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
const SHARE_LANGS = Object.freeze(['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']);
const SHARE_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

const FONT_FILES = [
  path.join(FONT_DIR, 'share-card', 'PlusJakartaSans-Regular.ttf'),
  path.join(FONT_DIR, 'share-card', 'PlusJakartaSans-SemiBold.ttf'),
  path.join(FONT_DIR, 'share-card', 'PlusJakartaSans-Bold.ttf'),
  path.join(FONT_DIR, 'NotoSansArabic-Variable.ttf'),
  path.join(FONT_DIR, 'NotoSansEthiopic-Variable.ttf')
];

const CATEGORIES = Object.freeze({
  sale: {
    title: 'For sale',
    subtitle: 'Houses and apartments for sale',
    alt: 'Houses and property for sale on makaug',
    photos: ['house']
  },
  rent: {
    title: 'Rentals',
    subtitle: 'Houses and apartments to rent',
    alt: 'Houses and property to rent on makaug',
    photos: ['rental']
  },
  land: {
    title: 'Land',
    subtitle: 'Plots and acreage',
    alt: 'Land for sale on makaug',
    photos: ['land']
  },
  commercial: {
    title: 'Commercial',
    subtitle: 'Offices, shops and warehouses',
    alt: 'Commercial property on makaug',
    photos: ['office', 'shop', 'warehouse']
  },
  'short-stay': {
    title: 'Short stays',
    subtitle: 'Stays by the night',
    alt: 'Short stays on makaug',
    photos: ['hotel']
  },
  students: {
    title: 'Student rooms',
    subtitle: 'Rooms near campus',
    alt: 'Student rooms on makaug',
    photos: ['apartment']
  },
  marketplace: {
    title: 'Marketplace',
    subtitle: 'Surveyors, lawyers and builders',
    alt: 'Property services marketplace on makaug',
    photos: ['shop']
  },
  value: {
    title: 'Property value',
    subtitle: 'What a property is worth',
    alt: 'Property value guide on makaug',
    photos: ['house']
  },
  mortgage: {
    title: 'Mortgage finder',
    subtitle: 'Compare home-loan repayments',
    alt: 'Mortgage finder on makaug',
    photos: ['house']
  },
  brokers: {
    title: 'Brokers directory',
    subtitle: 'Agents across Uganda',
    alt: 'Brokers directory on makaug',
    photos: ['house', 'office']
  },
  discover: {
    title: 'Discover',
    subtitle: 'Find property in your own words',
    alt: 'Discover property on makaug',
    photos: ['house', 'land', 'shop']
  }
});

const HOME_ALT = 'makaug — houses, apartments, land, rentals and commercial property in Uganda';
const HOME_TAGLINE = 'Houses, apartments, land, rentals and commercial property';

const PATH_CARDS = Object.freeze({
  '/for-sale': 'sale',
  '/sale': 'sale',
  '/to-rent': 'rent',
  '/rent': 'rent',
  '/land': 'land',
  '/commercial': 'commercial',
  '/student-accommodation': 'students',
  '/students': 'students',
  '/short-term': 'short-stay',
  '/marketplace': 'marketplace',
  '/valuation': 'value',
  '/property-valuation': 'value',
  '/mortgage': 'mortgage',
  '/mortgage-finder': 'mortgage',
  '/brokers': 'brokers',
  '/find-brokers': 'brokers',
  '/discover-ai-chatbot': 'discover',
  '/ai-chatbot': 'discover'
});

const CATEGORY_ALIASES = Object.freeze({
  sale: 'sale',
  'for-sale': 'sale',
  rent: 'rent',
  rentals: 'rent',
  'to-rent': 'rent',
  land: 'land',
  commercial: 'commercial',
  'short-stay': 'short-stay',
  'short-stays': 'short-stay',
  short_term: 'short-stay',
  'short-term': 'short-stay',
  students: 'students',
  student: 'students',
  'student-rooms': 'students',
  'student-accommodation': 'students',
  marketplace: 'marketplace',
  value: 'value',
  valuation: 'value',
  'property-value': 'value',
  mortgage: 'mortgage',
  'mortgage-finder': 'mortgage',
  brokers: 'brokers',
  'brokers-directory': 'brokers',
  discover: 'discover'
});

const COLLAGE = Object.freeze([
  { key: 'house', label: 'Houses', x: 0, y: 0, w: 460, h: 360 },
  { key: 'apartment', label: 'Apartments', x: 460, y: 0, w: 370, h: 360 },
  { key: 'land', label: 'Land', x: 830, y: 0, w: 370, h: 360 },
  { key: 'rental', label: 'Rentals', x: 0, y: 360, w: 300, h: 270 },
  { key: 'office', label: 'Offices', x: 300, y: 360, w: 300, h: 270 },
  { key: 'shop', label: 'Shops', x: 600, y: 360, w: 300, h: 270 },
  { key: 'warehouse', label: 'Warehouses', x: 900, y: 360, w: 300, h: 270 }
]);

const phraseCache = new Map();
const photoUriCache = new Map();
let logoUri = '';

function normalizeShareLang(value) {
  const code = String(value || 'en').toLowerCase().split('-')[0];
  return SHARE_LANGS.includes(code) ? code : 'en';
}

function categoryKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return CATEGORY_ALIASES[key] || '';
}

function shareCardKeyForPath(pathname = '/') {
  const clean = String(pathname || '/').split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
  if (PATH_CARDS[clean]) return PATH_CARDS[clean];
  if (clean.startsWith('/short-term')) return 'short-stay';
  if (clean.startsWith('/marketplace')) return 'marketplace';
  if (clean.startsWith('/for-sale') || clean.startsWith('/sale/')) return 'sale';
  if (clean.startsWith('/to-rent') || clean.startsWith('/rent/')) return 'rent';
  if (clean.startsWith('/land/')) return 'land';
  if (clean.startsWith('/commercial/')) return 'commercial';
  if (clean.startsWith('/student-accommodation') || clean.startsWith('/students')) return 'students';
  if (clean.startsWith('/valuation')) return 'value';
  if (clean.startsWith('/mortgage')) return 'mortgage';
  if (clean.startsWith('/brokers') || clean.startsWith('/find-brokers')) return 'brokers';
  if (clean.startsWith('/discover')) return 'discover';
  return '';
}

function shareImagePath(kind, id, lang) {
  const code = normalizeShareLang(lang);
  const query = code === 'en' ? '' : `?lang=${code}`;
  if (kind === 'agent') return `/og/agent/${encodeURIComponent(id)}.jpg${query}`;
  if (kind === 'property') return `/og/property/${encodeURIComponent(id)}.jpg${query}`;
  if (kind === 'home' || kind === 'default' || !kind) return `/og/home.jpg${query}`;
  const key = categoryKey(kind) || categoryKey(id) || 'sale';
  return `/og/category/${key}.jpg${query}`;
}

function phrasesFor(lang) {
  const code = normalizeShareLang(lang);
  if (code === 'en') return null;
  if (phraseCache.has(code)) return phraseCache.get(code);
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'i18n', `site-${code}.json`), 'utf8'));
    phraseCache.set(code, raw.phrases || {});
  } catch (_error) {
    phraseCache.set(code, {});
  }
  return phraseCache.get(code);
}

function shareCardText(lang, english) {
  const source = String(english || '');
  const pack = phrasesFor(lang);
  if (!pack || !source) return source;
  return pack[source] || pack[source.toLowerCase()] || source;
}

function shareCardAlt(kind, lang, details = {}) {
  const code = normalizeShareLang(lang);
  const key = kind === 'category' ? categoryKey(details.category || details.key) : categoryKey(kind);
  if (kind === 'agent' || details.agentName) {
    const name = clip(details.agentName || details.name || 'Property agent', 48);
    return `${name} — ${shareCardText(code, 'View profile on makaug.com')}`;
  }
  if (kind === 'property') {
    const place = [details.area, details.district].filter(Boolean).join(', ');
    const label = details.foundOnline ? 'Found online' : 'Verified';
    const tail = place ? `${shareCardText(code, label)} — ${place}` : shareCardText(code, label);
    return `${clip(details.title || details.propertyType || 'Property', 80)} — ${tail}`;
  }
  if (key && CATEGORIES[key]) return shareCardText(code, CATEGORIES[key].alt);
  return shareCardText(code, HOME_ALT);
}

function fontFamily(lang) {
  const code = normalizeShareLang(lang);
  if (code === 'ar') return 'Noto Sans Arabic';
  if (code === 'am') return 'Noto Sans Ethiopic';
  return 'Plus Jakarta Sans';
}

function xml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clip(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

const bioTemplateCache = new Map();

function bioTemplates(lang) {
  const code = normalizeShareLang(lang);
  if (code === 'en') return null;
  if (bioTemplateCache.has(code)) return bioTemplateCache.get(code);
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'i18n', `site-${code}.json`), 'utf8'));
    bioTemplateCache.set(code, raw.templates || null);
  } catch (_error) {
    bioTemplateCache.set(code, null);
  }
  return bioTemplateCache.get(code);
}

function shareCardBioText(agent = {}, lang) {
  const english = String(agent.bio || agent.bioText || '').replace(/\s+/g, ' ').trim();
  const source = agent.bioSource || agent.bio_source || '';
  const parts = agent.bioParts || agent.bio_parts || null;
  if (source === 'agent' || normalizeShareLang(lang) === 'en' || !Array.isArray(parts) || !parts.length) return english;
  return composeAgentBio(parts, bioTemplates(lang)) || english;
}

function ellipsizeShareLines(value, perLine, lines) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const width = Math.max(8, Number(perLine) || 58);
  const limit = Math.max(1, Number(lines) || 2);
  if (!text) return [];
  const words = text.split(' ');
  const result = [];
  let index = 0;
  while (index < words.length && result.length < limit) {
    let line = '';
    while (index < words.length) {
      const next = line ? `${line} ${words[index]}` : words[index];
      if (next.length > width && line) break;
      line = next.length > width ? next.slice(0, width) : next;
      index += 1;
      if (line.length >= width) break;
    }
    result.push(line);
  }
  if (index < words.length && result.length) {
    const last = result.length - 1;
    const trimmed = result[last].replace(/[,:;.\s]+$/g, '').replace(/\s+\S*$/, '');
    const room = Math.max(1, width - 1);
    result[last] = `${(trimmed || result[last]).slice(0, room).replace(/\s+\S*$/, '').replace(/[,:;.\s]+$/g, '')}…`;
  }
  return result.filter(Boolean);
}

function categoryForListing(listing = {}) {
  const type = String(listing.listing_type || listing.listingType || '').toLowerCase();
  if (type === 'student' || type === 'students') return 'students';
  if (type === 'rent' || type === 'rental') return 'rent';
  if (type === 'land') return 'land';
  if (type === 'commercial') return 'commercial';
  if (type === 'short_term' || type === 'short-term' || type === 'short-stay') return 'short-stay';
  return 'sale';
}

function usableListingPhoto(url) {
  return realPhotoRejection(url) === null;
}

function usableAgentPhoto(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (/tiktokcdn|byteimg/.test(lower)) return false;
  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_error) {
    return false;
  }
}

function formatSharePrice(price, pricePeriod) {
  const amount = Number(price);
  if (!(amount > 0)) return '';
  const period = String(pricePeriod || '').toLowerCase();
  let suffix = '';
  if (/night/.test(period)) suffix = '/night';
  else if (/week/.test(period)) suffix = '/wk';
  else if (/year|annum|\byr\b/.test(period)) suffix = '/yr';
  else if (/mo|month/.test(period)) suffix = '/mo';
  return `USh ${compactUgx(amount)}${suffix}`;
}

function formatPriceRange(minPrice, maxPrice) {
  const min = Number(minPrice);
  const max = Number(maxPrice);
  if (!(min > 0)) return '';
  if (!(max > min)) return `USh ${compactUgx(min)}`;
  return `USh ${compactUgx(min)} – ${compactUgx(max)}`;
}

async function photoDataUri(key, width, height) {
  const cacheKey = `${key}:${width}x${height}`;
  if (photoUriCache.has(cacheKey)) return photoUriCache.get(cacheKey);
  const file = path.join(PHOTO_DIR, `${key}.jpg`);
  const jpeg = await sharp(file)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 74, mozjpeg: true })
    .toBuffer();
  const uri = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  photoUriCache.set(cacheKey, uri);
  return uri;
}

async function logoDataUri(size) {
  if (!logoUri) {
    const png = await sharp(LOGO_PATH).resize(size, size).png().toBuffer();
    logoUri = `data:image/png;base64,${png.toString('base64')}`;
  }
  return logoUri;
}

async function circlePhotoUri(buffer, size) {
  const resized = await sharp(buffer).rotate().resize(size, size, { fit: 'cover', position: 'attention' }).png().toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  const circled = await sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return `data:image/png;base64,${circled.toString('base64')}`;
}

function textEl(x, y, content, options = {}) {
  const size = options.size || 24;
  const weight = options.weight || 600;
  const fill = options.fill || '#ffffff';
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : '';
  const family = options.family;
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${family}"${anchor}>${xml(content)}</text>`;
}

function chip(x, y, label, family) {
  const text = clip(label, 22);
  const width = Math.min(250, Math.max(72, Math.round(text.length * (family.startsWith('Noto') ? 13 : 8.4) + 22)));
  return `<rect x="${x + 14}" y="${y + 14}" width="${width}" height="30" rx="9" fill="#052e16" fill-opacity="0.78"/>
    ${textEl(x + 26, y + 35, text, { size: 15, weight: 700, family })}`;
}

async function homeSvg(lang) {
  const family = fontFamily(lang);
  const logo = await logoDataUri(128);
  const tiles = await Promise.all(COLLAGE.map(async (tile) => {
    const href = await photoDataUri(tile.key, tile.w, tile.h);
    return `<image href="${href}" x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" preserveAspectRatio="xMidYMid slice"/>
      ${chip(tile.x, tile.y, shareCardText(lang, tile.label), family)}`;
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#14532d"/>
  ${tiles.join('\n')}
  <defs>
    <linearGradient id="homeFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#052e16" stop-opacity="0"/>
      <stop offset="1" stop-color="#052e16" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <rect x="0" y="430" width="${WIDTH}" height="200" fill="url(#homeFade)"/>
  <rect x="0" y="548" width="${WIDTH}" height="82" fill="#14532d"/>
  <rect x="0" y="544" width="${WIDTH}" height="6" fill="#f6bd38"/>
  <image href="${logo}" x="28" y="558" width="64" height="64"/>
  ${textEl(108, 586, 'makaug', { size: 32, weight: 700, family })}
  ${textEl(108, 614, clip(shareCardText(lang, HOME_TAGLINE), 62), { size: 16, weight: 500, fill: '#bbf7d0', family })}
  ${textEl(1172, 598, 'makaug.com', { size: 26, weight: 700, fill: '#f6bd38', anchor: 'end', family })}
</svg>`;
}

async function categorySvg(key, lang) {
  const category = CATEGORIES[key] || CATEGORIES.sale;
  const family = fontFamily(lang);
  const logo = await logoDataUri(128);
  const title = clip(shareCardText(lang, category.title), 28);
  const subtitle = clip(shareCardText(lang, category.subtitle), 46);
  if (category.photos.length > 1) {
    const band = Math.floor(630 / category.photos.length);
    const photos = await Promise.all(category.photos.map(async (photoKey, index) => {
      const href = await photoDataUri(photoKey, 640, band);
      const y = index * band;
      const labelKey = COLLAGE.find((tile) => tile.key === photoKey)?.label || category.title;
      return `<image href="${href}" x="560" y="${y}" width="640" height="${band}" preserveAspectRatio="xMidYMid slice"/>
        ${chip(560, y, shareCardText(lang, labelKey), family)}`;
    }));
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#14532d"/>
  ${photos.join('\n')}
  <rect x="0" y="0" width="580" height="${HEIGHT}" fill="#14532d"/>
  <image href="${logo}" x="48" y="48" width="84" height="84"/>
  ${textEl(148, 100, 'makaug.com', { size: 24, weight: 700, fill: '#f6bd38', family })}
  ${textEl(48, 280, title, { size: title.length > 16 ? 48 : 60, weight: 700, family })}
  ${textEl(48, 340, subtitle, { size: 24, weight: 500, fill: '#bbf7d0', family })}
  <rect x="48" y="540" width="160" height="6" fill="#f6bd38"/>
</svg>`;
  }
  const href = await photoDataUri(category.photos[0], 1200, 630);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#14532d"/>
  <image href="${href}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>
  <defs>
    <linearGradient id="catFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#052e16" stop-opacity="0.94"/>
      <stop offset="0.55" stop-color="#052e16" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#052e16" stop-opacity="0.05"/>
    </linearGradient>
  </defs>
  <rect width="820" height="${HEIGHT}" fill="url(#catFade)"/>
  <image href="${logo}" x="48" y="44" width="84" height="84"/>
  ${textEl(148, 96, 'makaug.com', { size: 24, weight: 700, fill: '#f6bd38', family })}
  ${textEl(48, 300, title, { size: title.length > 16 ? 52 : 68, weight: 700, family })}
  ${textEl(48, 364, subtitle, { size: 26, weight: 500, fill: '#ecfdf5', family })}
  <rect x="48" y="548" width="180" height="6" fill="#f6bd38"/>
</svg>`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]).join('');
  return (letters || 'M').toUpperCase();
}

async function agentSvg(agent, lang) {
  const family = fontFamily(lang);
  const name = clip(agent.name || 'Property agent', 32);
  const districts = clip(agent.districts || '', 52);
  const range = formatPriceRange(agent.minPrice, agent.maxPrice);
  const rangeLabel = range
    ? `${shareCardText(lang, 'Price range')} ${range}`
    : shareCardText(lang, 'Price on request');
  const perLine = family.startsWith('Noto') ? 42 : 58;
  const bioLines = ellipsizeShareLines(shareCardBioText(agent, lang), perLine, 2);
  const logo = await logoDataUri(96);
  let face = '';
  if (agent.photo) {
    try {
      const uri = await circlePhotoUri(agent.photo, 280);
      face = `<image href="${uri}" x="78" y="154" width="280" height="280"/>`;
    } catch (_error) {
      face = '';
    }
  }
  if (!face) {
    face = `<circle cx="218" cy="294" r="140" fill="#15803d"/>
      ${textEl(218, 310, initials(agent.name), { size: 72, weight: 700, anchor: 'middle', family })}`;
  }
  const verified = agent.verified
    ? `<circle cx="430" cy="268" r="16" fill="#15803d"/>
       <path d="M421 268 l6 6 l12-14" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
       ${textEl(456, 275, shareCardText(lang, 'Verified'), { size: 22, weight: 700, fill: '#15803d', family })}`
    : '';
  const bio = bioLines.map((line, index) => (
    textEl(430, 368 + index * 32, line, { size: 20, weight: 500, fill: '#3f6212', family })
  )).join('\n');
  const rangeWidth = Math.min(660, Math.max(280, Math.round(rangeLabel.length * (family.startsWith('Noto') ? 13 : 11.5) + 40)));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#14532d"/>
  <rect x="36" y="36" width="1128" height="558" rx="32" fill="#ffffff"/>
  <circle cx="218" cy="294" r="148" fill="#dcfce7"/>
  ${face}
  <image href="${logo}" x="1008" y="64" width="72" height="72"/>
  ${textEl(430, 210, name, { size: name.length > 22 ? 40 : 48, weight: 700, fill: '#14532d', family })}
  ${verified}
  ${textEl(430, 324, districts || shareCardText(lang, 'Agents across Uganda'), { size: 24, weight: 600, fill: '#14532d', family })}
  ${bio}
  <rect x="430" y="448" width="${rangeWidth}" height="52" rx="16" fill="#f0fdf4"/>
  ${textEl(450, 481, clip(rangeLabel, 42), { size: 20, weight: 700, fill: '#14532d', family })}
  ${textEl(430, 548, shareCardText(lang, 'View profile on makaug.com'), { size: 22, weight: 700, fill: '#15803d', family })}
</svg>`;
}

async function propertySvg(listing, lang) {
  const family = fontFamily(lang);
  const photo = await sharp(listing.photo).rotate().resize(760, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 76 }).toBuffer();
  const href = `data:image/jpeg;base64,${photo.toString('base64')}`;
  const logo = await logoDataUri(96);
  const price = formatSharePrice(listing.price, listing.pricePeriod) || shareCardText(lang, 'Price on request');
  const type = clip(listing.propertyType || shareCardText(lang, CATEGORIES[categoryForListing(listing)].title), 28);
  const beds = Number(listing.bedrooms) > 0 && categoryForListing(listing) !== 'land'
    ? `${Number(listing.bedrooms)} ${shareCardText(lang, Number(listing.bedrooms) === 1 ? 'Bedroom' : 'Bedrooms')}`
    : '';
  const place = clip([listing.area, listing.district].filter(Boolean).join(', '), 36);
  const badge = shareCardText(lang, listing.foundOnline ? 'Found online' : 'Verified');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#14532d"/>
  <image href="${href}" x="0" y="0" width="760" height="630" preserveAspectRatio="xMidYMid slice"/>
  <rect x="760" y="0" width="440" height="630" fill="#14532d"/>
  <image href="${logo}" x="800" y="40" width="72" height="72"/>
  ${textEl(888, 86, 'makaug.com', { size: 22, weight: 700, fill: '#f6bd38', family })}
  ${textEl(800, 230, clip(price, 18), { size: price.length > 14 ? 36 : 46, weight: 700, fill: '#f6bd38', family })}
  ${textEl(800, 292, type, { size: 28, weight: 700, family })}
  ${beds ? textEl(800, 342, beds, { size: 24, weight: 500, fill: '#bbf7d0', family }) : ''}
  ${place ? textEl(800, 400, place, { size: 24, weight: 600, family }) : ''}
  <rect x="800" y="470" width="${Math.min(360, 36 + badge.length * 14)}" height="48" rx="24" fill="#f6bd38"/>
  ${textEl(824, 502, badge, { size: 20, weight: 700, fill: '#14532d', family })}
</svg>`;
}

async function svgToJpeg(svg, lang) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: fontFamily(lang)
    }
  });
  const png = resvg.render().asPng();
  let quality = 82;
  let jpeg = await sharp(png).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  while (jpeg.length > 300 * 1024 && quality > 52) {
    quality -= 8;
    jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  return jpeg;
}

async function renderShareCard(input = {}) {
  const lang = normalizeShareLang(input.lang);
  const kind = String(input.kind || 'home');
  if (kind === 'agent') {
    return svgToJpeg(await agentSvg(input.agent || input, lang), lang);
  }
  if (kind === 'property') {
    const listing = input.listing || input;
    if (!listing.photo) {
      return renderShareCard({ kind: 'category', category: categoryForListing(listing), lang });
    }
    try {
      return await svgToJpeg(await propertySvg(listing, lang), lang);
    } catch (_error) {
      return renderShareCard({ kind: 'category', category: categoryForListing(listing), lang });
    }
  }
  if (kind === 'category') {
    const key = categoryKey(input.category || input.key) || 'sale';
    return svgToJpeg(await categorySvg(key, lang), lang);
  }
  return svgToJpeg(await homeSvg(lang), lang);
}

module.exports = {
  WIDTH,
  HEIGHT,
  SHARE_LANGS,
  SHARE_CACHE_CONTROL,
  CATEGORIES,
  HOME_ALT,
  HOME_TAGLINE,
  normalizeShareLang,
  categoryKey,
  categoryForListing,
  shareCardKeyForPath,
  shareImagePath,
  shareCardText,
  shareCardAlt,
  usableListingPhoto,
  usableAgentPhoto,
  formatSharePrice,
  formatPriceRange,
  shareCardBioText,
  ellipsizeShareLines,
  renderShareCard
};
