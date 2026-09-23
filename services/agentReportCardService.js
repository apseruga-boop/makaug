'use strict';

// Renders an agent's weekly report as a shareable PNG card (1080 wide, height fits the content) for
// WhatsApp. SVG is drawn here and rasterised with sharp; text uses the Noto Sans
// file bundled in assets/fonts so the card looks the same on any server.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let fontconfigReady = false;

function ensureFontconfig() {
  if (fontconfigReady) return;
  fontconfigReady = true;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-fc-'));
    const file = path.join(dir, 'fonts.conf');
    fs.writeFileSync(file, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <dir>/usr/share/fonts</dir>
  <cachedir>${path.join(dir, 'cache')}</cachedir>
</fontconfig>
`);
    if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = file;
  } catch (_) {
    // Fall back to whatever fonts the host has.
  }
}

const C = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  ink: '#15213A',
  muted: '#5E6878',
  line: '#E1E4EA',
  accent: '#E36A2E',
  accentSoft: '#FCEBE1',
  up: '#1F8A5B',
  down: '#C23B3B',
  track: '#EEF0F3'
};

const FONT = "'Noto Sans', 'DejaVu Sans', Arial, sans-serif";

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function num(value) {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? Math.round(n) : 0).toLocaleString('en-GB');
}

function change(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!p) return null;
  return Math.round(((c - p) / p) * 100);
}

function weekLabel(start, end) {
  try {
    const a = new Date(`${start}T00:00:00Z`);
    const b = new Date(`${end}T00:00:00Z`);
    const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
    return `${a.toLocaleDateString('en-GB', o)} – ${b.toLocaleDateString('en-GB', { ...o, year: 'numeric' })}`;
  } catch (_) {
    return '';
  }
}

function text(x, y, content, { size = 28, weight = 400, fill = C.ink, anchor = 'start', spacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(content)}</text>`;
}

function kpiTile(x, y, w, h, label, value, pct) {
  const deltaColor = pct === null ? C.muted : pct > 0 ? C.up : pct < 0 ? C.down : C.muted;
  const deltaText = pct === null ? (value !== '0' ? 'new this week' : 'none last week either') : `${pct > 0 ? '▲ +' : pct < 0 ? '▼ ' : ''}${pct}% vs last week`;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
    ${text(x + 28, y + 48, label, { size: 26, fill: C.muted })}
    ${text(x + 28, y + 118, value, { size: 64, weight: 800 })}
    ${text(x + 28, y + 160, deltaText, { size: 24, weight: 600, fill: deltaColor })}`;
}

function buildReportCardSvg(report = {}) {
  const W = 1080;
  const a = report.agent || {};
  const m = report.metrics || {};
  const p = report.previous_metrics || {};
  const enquiries = (Number(m.enquiries) || 0) + (Number(m.whatsapp_clicks) || 0);
  const prevEnquiries = (Number(p.enquiries) || 0) + (Number(p.whatsapp_clicks) || 0);
  const tiles = [
    ['Listing views', num(m.views), change(m.views, p.views)],
    ['Unique visitors', num(m.visitors), change(m.visitors, p.visitors)],
    ['Enquiries', num(enquiries), change(enquiries, prevEnquiries)],
    ['Saves', num(m.saves), change(m.saves, p.saves)]
  ];

  const pad = 60;
  const inner = W - pad * 2;
  let y = 0;
  const parts = [];

  // Header band
  parts.push(`<rect x="0" y="0" width="${W}" height="330" fill="${C.ink}"/>`);
  parts.push(text(pad, 92, 'makaug.com  ·  WEEKLY REPORT', { size: 26, weight: 700, fill: C.accent, spacing: 3 }));
  parts.push(text(pad, 180, clip(a.full_name || 'makaug agent', 26), { size: 76, weight: 800, fill: '#FFFFFF' }));
  const idText = a.makaug_agent_number ? `Agent ID ${a.makaug_agent_number}` : 'makaug agent';
  const chipW = Math.min(inner, 44 + idText.length * 15);
  parts.push(`<rect x="${pad}" y="214" width="${chipW}" height="52" rx="26" fill="${C.accent}"/>`);
  parts.push(text(pad + 22, 250, idText, { size: 26, weight: 700, fill: '#FFFFFF' }));
  parts.push(text(pad + chipW + 24, 250, `${weekLabel(report.week_start, report.week_end)}  ·  ${num(m.active_listings)} live listings`, { size: 26, fill: '#C9D0DC' }));
  y = 370;

  // KPI tiles 2×2
  const gap = 24;
  const tw = (inner - gap) / 2;
  const th = 190;
  tiles.forEach(([label, value, pct], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    parts.push(kpiTile(pad + col * (tw + gap), y + row * (th + gap), tw, th, label, value, pct));
  });
  y += th * 2 + gap + 24;

  // Highlights strip: rank, busiest day, peak time, top source
  const x = report.extras || {};
  const chips = [];
  if (x.rank && x.rank.position) chips.push(['Rank', `#${num(x.rank.position)} of ${num(x.rank.total)}`]);
  if (x.busiest_day) chips.push(['Busiest day', x.busiest_day.day]);
  if (x.peak_hour) chips.push(['Peak time', x.peak_hour.label]);
  if (x.traffic_sources && x.traffic_sources[0]) chips.push(['Top source', clip(x.traffic_sources[0].source === 'direct' ? 'Direct' : x.traffic_sources[0].source, 12)]);
  if (chips.length) {
    const cw = (inner - gap * (chips.length - 1)) / chips.length;
    chips.forEach(([label, value], i) => {
      const cx = pad + i * (cw + gap);
      parts.push(`<rect x="${cx}" y="${y}" width="${cw}" height="110" rx="18" fill="${C.accentSoft}"/>`);
      parts.push(text(cx + 20, y + 40, label, { size: 22, fill: C.muted }));
      parts.push(text(cx + 20, y + 84, value, { size: chips.length > 3 ? 26 : 30, weight: 800 }));
    });
    y += 110 + 60;
  } else {
    y += 36;
  }

  // Top countries (falls back to this week so far while tracking is new)
  let countries = (Array.isArray(report.top_countries) ? report.top_countries : []).slice(0, 3);
  let countryTitle = 'Top countries';
  if (!countries.length && Array.isArray(x.countries_so_far) && x.countries_so_far.length) {
    countries = x.countries_so_far.slice(0, 3);
    countryTitle = 'Top countries (so far this week)';
  }
  parts.push(text(pad, y, countryTitle, { size: 34, weight: 800 }));
  y += 22;
  if (countries.length) {
    const total = countries.reduce((s, c) => s + (Number(c.visitors) || 0), 0) || 1;
    const max = Math.max(1, ...countries.map((c) => Number(c.visitors) || 0));
    countries.forEach((c, i) => {
      const rowY = y + 30 + i * 62;
      parts.push(text(pad, rowY + 18, `${i + 1}`, { size: 24, fill: C.muted }));
      parts.push(text(pad + 40, rowY + 18, clip(c.name, 28), { size: 28, weight: 600 }));
      parts.push(text(W - pad, rowY + 18, `${num(c.visitors)}  ·  ${Math.round((Number(c.visitors) || 0) / total * 100)}%`, { size: 26, weight: 700, anchor: 'end' }));
      parts.push(`<rect x="${pad + 40}" y="${rowY + 32}" width="${inner - 40}" height="10" rx="5" fill="${C.track}"/>`);
      parts.push(`<rect x="${pad + 40}" y="${rowY + 32}" width="${Math.max(10, ((Number(c.visitors) || 0) / max) * (inner - 40)).toFixed(1)}" height="10" rx="5" fill="${C.accent}"/>`);
    });
    y += 30 + countries.length * 62 + 30;
  } else {
    parts.push(`<rect x="${pad}" y="${y + 18}" width="${inner}" height="70" rx="16" fill="${C.accentSoft}"/>`);
    parts.push(text(pad + 24, y + 62, 'Visitor countries appear from next week’s report.', { size: 26, fill: C.ink }));
    y += 18 + 70 + 50;
  }

  // Best properties
  parts.push(text(pad, y, 'Your best-performing properties', { size: 34, weight: 800 }));
  y += 20;
  const listings = (Array.isArray(report.top_listings) ? report.top_listings : []).slice(0, 3);
  if (listings.length) {
    listings.forEach((l, i) => {
      const rowY = y + 16 + i * 84;
      parts.push(`<rect x="${pad}" y="${rowY}" width="${inner}" height="72" rx="16" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>`);
      parts.push(`<circle cx="${pad + 40}" cy="${rowY + 36}" r="20" fill="${C.accentSoft}"/>`);
      parts.push(text(pad + 40, rowY + 45, `${i + 1}`, { size: 24, weight: 800, fill: C.accent, anchor: 'middle' }));
      parts.push(text(pad + 80, rowY + 46, clip(l.title, 34), { size: 27, weight: 600 }));
      parts.push(text(W - pad - 24, rowY + 46, `${num(l.views)} views · ${num(l.enquiries)} enq.`, { size: 24, fill: C.muted, anchor: 'end' }));
    });
    y += 16 + listings.length * 84;
  } else {
    parts.push(text(pad, y + 40, 'None of your listings were opened this week.', { size: 26, fill: C.muted }));
    y += 60;
  }

  // Footer
  const H = Math.max(1080, Math.round(y + 50 + 110));
  parts.push(`<rect x="0" y="${H - 110}" width="${W}" height="110" fill="${C.accent}"/>`);
  parts.push(text(W / 2, H - 45, 'Tap the link below for your full interactive report', { size: 30, weight: 700, fill: '#FFFFFF', anchor: 'middle' }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  ${parts.join('\n  ')}
</svg>`;
}

// A share card the agent can post on their WhatsApp status: their name, their
// makaug agent ID, how many properties they have live, and a QR code that
// opens their public profile.
function buildAgentShareCardSvg({ agent = {}, listings = 0, qrSvgPath = '', qrModules = 29, profileUrl = '' } = {}) {
  const W = 1080;
  const H = 1920;
  const name = clip(agent.full_name || 'makaug agent', 22);
  const initials = String(agent.full_name || 'M A').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.ink}"/>`);
  parts.push(`<circle cx="${W - 60}" cy="180" r="300" fill="#1C2B4A"/>`);
  parts.push(`<circle cx="40" cy="${H - 220}" r="260" fill="#1C2B4A"/>`);

  parts.push(text(80, 150, 'makaug.com', { size: 44, weight: 800, fill: C.accent }));
  parts.push(text(80, 200, 'UGANDA’S PROPERTY DISCOVERY PLATFORM', { size: 22, weight: 700, fill: '#93A0B5', spacing: 2 }));

  // Agent identity
  parts.push(`<circle cx="180" cy="420" r="110" fill="${C.accent}"/>`);
  parts.push(text(180, 455, initials, { size: 86, weight: 800, fill: '#FFFFFF', anchor: 'middle' }));
  parts.push(text(320, 400, name, { size: 64, weight: 800, fill: '#FFFFFF' }));
  if (agent.company_name && String(agent.company_name).trim().toLowerCase() !== String(agent.full_name || '').trim().toLowerCase()) {
    parts.push(text(320, 456, clip(agent.company_name, 28), { size: 30, fill: '#93A0B5' }));
  }
  if (agent.makaug_agent_number) {
    parts.push(`<rect x="320" y="482" width="${44 + String(agent.makaug_agent_number).length * 17}" height="56" rx="28" fill="#1C2B4A" stroke="${C.accent}" stroke-width="2"/>`);
    parts.push(text(342, 520, agent.makaug_agent_number, { size: 28, weight: 700, fill: C.accent }));
  }

  parts.push(text(80, 680, 'Find all my properties', { size: 58, weight: 800, fill: '#FFFFFF' }));
  parts.push(text(80, 750, 'on makaug.com', { size: 58, weight: 800, fill: C.accent }));
  if (listings > 0) {
    parts.push(text(80, 830, `${num(listings)} live listing${listings === 1 ? '' : 's'} · rent · buy · land · commercial`, { size: 28, fill: '#93A0B5' }));
  }

  // QR panel
  const qrBox = 520;
  const qrX = (W - qrBox) / 2;
  const qrY = 930;
  parts.push(`<rect x="${qrX - 40}" y="${qrY - 40}" width="${qrBox + 80}" height="${qrBox + 190}" rx="40" fill="#FFFFFF"/>`);
  if (qrSvgPath) {
    parts.push(`<g transform="translate(${qrX} ${qrY}) scale(${(qrBox / Math.max(1, qrModules)).toFixed(4)})">${qrSvgPath}</g>`);
  }
  parts.push(text(W / 2, qrY + qrBox + 70, 'Scan to see my properties', { size: 34, weight: 800, anchor: 'middle' }));
  if (profileUrl) parts.push(text(W / 2, qrY + qrBox + 120, clip(profileUrl.replace(/^https?:\/\//, ''), 42), { size: 24, fill: C.muted, anchor: 'middle' }));

  const phone = String(agent.whatsapp || agent.phone || '').trim();
  if (phone) {
    parts.push(`<rect x="80" y="${H - 260}" width="${W - 160}" height="96" rx="48" fill="${C.accent}"/>`);
    parts.push(text(W / 2, H - 198, `Call or WhatsApp ${phone}`, { size: 34, weight: 800, fill: '#FFFFFF', anchor: 'middle' }));
  }
  parts.push(text(W / 2, H - 90, 'makaug.com — every home, every plot, one place', { size: 26, fill: '#93A0B5', anchor: 'middle' }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('\n')}</svg>`;
}

async function renderAgentShareCardPng({ agent, listings = 0, profileUrl }) {
  ensureFontconfig();
  const sharp = require('sharp');
  let qrSvgPath = '';
  let qrModules = 29;
  try {
    const qrcode = require('qrcode');
    const svg = await qrcode.toString(profileUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#15213A', light: '#FFFFFF' } });
    qrSvgPath = (svg.match(/<path[^>]*\/>/g) || []).join('');
    const box = svg.match(/viewBox="0 0 (\d+) \d+"/);
    if (box) qrModules = Number(box[1]) || 29;
  } catch (_) {
    qrSvgPath = '';
  }
  const svg = buildAgentShareCardSvg({ agent, listings, qrSvgPath, qrModules, profileUrl });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

async function renderReportCardPng(report) {
  ensureFontconfig();
  const sharp = require('sharp');
  return sharp(Buffer.from(buildReportCardSvg(report))).png({ compressionLevel: 9 }).toBuffer();
}

function cardSecret() {
  return String(process.env.AGENT_REPORT_CARD_SECRET || process.env.JWT_SECRET || process.env.WHATSAPP_WEB_BRIDGE_TOKEN || '');
}

// Card URLs are public (WhatsApp's servers must fetch them) but unguessable:
// each carries an HMAC of the report id and its last update time.
function cardToken(reportId, version = '') {
  const secret = cardSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`${reportId}:${version}`).digest('hex').slice(0, 32);
}

function verifyCardToken(reportId, version, token) {
  const expected = cardToken(reportId, version);
  const given = String(token || '');
  if (!expected || expected.length !== given.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

function cardVersion(report) {
  const value = report?.updated_at ? new Date(report.updated_at).getTime() : 0;
  return Number.isFinite(value) ? String(value) : '0';
}

function reportCardUrl(report, baseUrl) {
  const version = cardVersion(report);
  const token = cardToken(report.id, version);
  if (!token) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}/api/agents/report-card/${encodeURIComponent(report.id)}.png?v=${version}&t=${token}`;
}

module.exports = {
  buildAgentShareCardSvg,
  renderAgentShareCardPng,
  buildReportCardSvg,
  ensureFontconfig,
  cardToken,
  cardVersion,
  renderReportCardPng,
  reportCardUrl,
  verifyCardToken
};
