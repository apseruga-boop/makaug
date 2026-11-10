'use strict';

/**
 * The "Pay with MTN MoMo" card: makaug's merchant code as a picture.
 *
 * Arthur, 10 Nov 2026: payers should see the merchant code the way they see it
 * on the yellow MoMo stickers in shops — the code in boxes, the merchant name,
 * *165*3# — because a code on a card looks like a business, and a phone number
 * in a chat looks like a person. It goes with every WhatsApp that asks for
 * money and sits on the payment page.
 *
 * It is makaug's own card: the makaug mark, our merchant name and code, and
 * MTN's menu steps in plain words. It does not use MTN's logo.
 *
 * Pure: no database. Rendered with resvg and the bundled Plus Jakarta Sans,
 * the same way as the share cards, so it looks the same on every server.
 */

const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { momoMerchantCode, momoMerchantName } = require('../config/momoMerchant');

const ROOT = path.join(__dirname, '..');
const FONT_FILES = [
  path.join(ROOT, 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Regular.ttf'),
  path.join(ROOT, 'assets', 'fonts', 'share-card', 'PlusJakartaSans-SemiBold.ttf'),
  path.join(ROOT, 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Bold.ttf')
];
const FONT = 'Plus Jakarta Sans';
// Bumped whenever the design changes, so WhatsApp and browsers fetch it again.
const CARD_VERSION = '1';

const W = 1080;
const H = 1350;
const PAD = 72;
const C = Object.freeze({
  yellow: '#FFCB05',
  ink: '#15213A',
  inkSoft: '#3A4458',
  white: '#FFFFFF',
  green: '#15803D'
});

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function ugx(n) {
  return `UGX ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
}

function text(x, y, content, { size = 32, weight = 600, fill = C.ink, anchor = 'start', spacing = 0 } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : '';
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${xml(content)}</text>`;
}

/** Split a description into at most two lines of about `max` characters. */
function twoLines(value, max = 44) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [''];
  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current) lines[lines.length - 1] = word;
    else if (`${current} ${word}`.length <= max) lines[lines.length - 1] = `${current} ${word}`;
    else if (lines.length < 2) lines.push(word);
    else { lines[1] = `${lines[1].slice(0, max - 1).trimEnd()}…`; break; }
  }
  if (lines[1] && lines[1].length > max) lines[1] = `${lines[1].slice(0, max - 1).trimEnd()}…`;
  return lines.filter(Boolean);
}

/** What the card says. Everything is passed in, so a test can pin it. */
function cardContent({ amountUgx = null, description = '', audience = 'business', env = process.env, settings = {} } = {}) {
  const code = momoMerchantCode(env);
  const amount = Number(amountUgx) > 0 ? ugx(amountUgx) : '';
  return {
    code,
    digits: code.split(''),
    merchantName: momoMerchantName(settings, env),
    amount,
    // "makaug …" is already on the card; say what it is for, from its first word.
    forWhat: String(description || '').trim().replace(/^makaug\s+/i, '').replace(/^./, (ch) => ch.toUpperCase()),
    steps: [
      ['Dial', '*165*3#'],
      ['Select', '1: Merchant Code'],
      ['Enter', code],
      ['Enter', amount || 'the amount'],
      ['Confirm, then your', 'MoMo PIN']
    ],
    // Private listers and hosts are people; agents are businesses.
    after: audience === 'person'
      ? 'After paying, reply on WhatsApp with your name.'
      : 'After paying, reply on WhatsApp with your business name.',
    contact: 'makaug.com  ·  WhatsApp +256 780 863 394'
  };
}

function cardSvg(options = {}) {
  const c = cardContent(options);
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.yellow}"/>`);
  // A quiet band of diagonal stripes, so the card does not read as a flat block.
  parts.push(`<g opacity="0.05">${Array.from({ length: 14 }, (_, i) => `<rect x="${-200 + i * 120}" y="-40" width="40" height="${H + 80}" fill="${C.ink}" transform="rotate(18 ${-200 + i * 120} 0)"/>`).join('')}</g>`);

  // Brand row: the makaug mark and name, and what this is.
  const mark = 76;
  parts.push(`<g transform="translate(${PAD} ${PAD}) scale(${mark / 512})"><rect width="512" height="512" rx="112" fill="${C.green}"/><path d="M126 365V147h59l71 115 71-115h59v218h-59V237l-54 87h-34l-54-87v128z" fill="${C.white}"/></g>`);
  parts.push(text(PAD + mark + 22, PAD + 54, 'makaug', { size: 50, weight: 700 }));
  const pillW = 330;
  parts.push(`<rect x="${W - PAD - pillW}" y="${PAD + 12}" width="${pillW}" height="54" rx="27" fill="none" stroke="${C.ink}" stroke-width="3"/>`);
  parts.push(text(W - PAD - pillW / 2, PAD + 48, 'Official payment details', { size: 24, weight: 700, anchor: 'middle' }));

  // Heading.
  parts.push(text(PAD, 262, 'Pay with', { size: 58, weight: 600 }));
  parts.push(text(PAD - 4, 374, 'MTN MoMo', { size: 128, weight: 700, spacing: -3 }));

  // The merchant code, one digit per box.
  parts.push(text(PAD, 452, 'MERCHANT CODE', { size: 28, weight: 700, spacing: 6, fill: C.inkSoft }));
  const gap = 14;
  const n = c.digits.length;
  const boxW = Math.floor((W - PAD * 2 - gap * (n - 1)) / n);
  const boxH = 140;
  const top = 476;
  c.digits.forEach((digit, i) => {
    const x = PAD + i * (boxW + gap);
    parts.push(`<rect x="${x}" y="${top}" width="${boxW}" height="${boxH}" rx="18" fill="${C.white}" stroke="${C.ink}" stroke-width="5"/>`);
    parts.push(text(x + boxW / 2, top + 101, digit, { size: 96, weight: 700, anchor: 'middle' }));
  });
  parts.push(text(PAD, top + boxH + 62, c.merchantName, { size: 38, weight: 700 }));

  // MTN's menu, in five steps, on an ink panel.
  const panelTop = 724;
  const rowH = 64;
  const panelH = 28 + c.steps.length * rowH;
  parts.push(`<rect x="${PAD}" y="${panelTop}" width="${W - PAD * 2}" height="${panelH}" rx="34" fill="${C.ink}"/>`);
  c.steps.forEach(([verb, what], i) => {
    const cy = panelTop + 14 + i * rowH + rowH / 2;
    parts.push(`<circle cx="${PAD + 60}" cy="${cy}" r="24" fill="${C.yellow}"/>`);
    parts.push(text(PAD + 60, cy + 10, String(i + 1), { size: 28, weight: 700, anchor: 'middle' }));
    parts.push(`<text x="${PAD + 106}" y="${cy + 12}" font-family="${FONT}" font-size="36" fill="${C.white}"><tspan font-weight="400">${xml(verb)} </tspan><tspan font-weight="700" fill="${C.yellow}">${xml(what)}</tspan></text>`);
  });

  // What it is for, when this card belongs to one payment; then what to do after.
  let y = panelTop + panelH + 58;
  if (c.forWhat) {
    // Two lines only if the line below still clears the footer.
    let lines = twoLines(c.forWhat, 50);
    if (y + lines.length * 40 + 22 > H - 140) lines = twoLines(c.forWhat, 50).slice(0, 1).map((l) => (twoLines(c.forWhat, 50).length > 1 ? `${l.replace(/[…]$/, '')}…` : l));
    lines.forEach((line, i) => parts.push(`<text x="${PAD}" y="${y + i * 40}" font-family="${FONT}" font-size="30" fill="${C.ink}">${i === 0 ? '<tspan font-weight="700">For: </tspan>' : ''}<tspan font-weight="400">${xml(line)}</tspan></text>`));
    y += lines.length * 40 + 14;
  }
  parts.push(text(PAD, y + 8, c.after, { size: 30, weight: 700 }));
  parts.push(`<line x1="${PAD}" y1="${H - 100}" x2="${W - PAD}" y2="${H - 100}" stroke="${C.ink}" stroke-opacity="0.25" stroke-width="2"/>`);
  parts.push(text(PAD, H - 58, c.contact, { size: 28, weight: 600, fill: C.inkSoft }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

const cache = new Map();

/** The card as a PNG. Small (flat colours), cached by what it shows. */
function renderMomoCard(options = {}) {
  const c = cardContent(options);
  const key = JSON.stringify([CARD_VERSION, c.code, c.merchantName, c.amount, c.forWhat, c.after]);
  if (cache.has(key)) return cache.get(key);
  const resvg = new Resvg(cardSvg(options), {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONT }
  });
  const png = resvg.render().asPng();
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}

/** Where WhatsApp (and the page) fetch it. A link's own card carries its amount. */
function momoCardUrl({ code = '', base = '' } = {}) {
  const site = String(base || process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
  const clean = String(code || '').trim().toUpperCase();
  return clean ? `${site}/pay/${encodeURIComponent(clean)}/momo-card.png?v=${CARD_VERSION}` : `${site}/pay/momo-card.png?v=${CARD_VERSION}`;
}

module.exports = {
  CARD_VERSION,
  cardContent,
  cardSvg,
  renderMomoCard,
  momoCardUrl,
  twoLines
};
