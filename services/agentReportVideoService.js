'use strict';

// Animated "your week on makaug" recap video (720×720 MP4, ~20 s) for an
// agent's weekly report. Frames are drawn as SVG, rasterised with sharp and
// piped into ffmpeg. Style: cream ground, outlined chat bubbles with offset
// shadows, confetti, stats that count up, a country scene and a closing card.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SIZE = 720;
const FPS = 15;
const FONT = "'Noto Sans', 'DejaVu Sans', Arial, sans-serif";
const CACHE_DIR = path.join(os.tmpdir(), 'makaug-report-videos');
const inflight = new Map();
const lastErrors = new Map(); // report id -> last render failure, for the admin desk
const RENDER_TIMEOUT_MS = Number(process.env.AGENT_REPORT_VIDEO_TIMEOUT_MS || 150000);

const K = {
  cream: '#FBF6EE',
  peach: '#FFE7D3',
  ink: '#15213A',
  line: '#15213A',
  white: '#FFFFFF',
  orange: '#E8662A',
  green: '#1F9D63',
  red: '#D14343',
  purple: '#8B6CF6',
  teal: '#35CFAE',
  yellow: '#FFC83D',
  muted: '#6B7280'
};

function ffmpegPath() {
  if (process.env.AGENT_REPORT_FFMPEG_PATH) return process.env.AGENT_REPORT_FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static');
    return p && fs.existsSync(p) ? p : '';
  } catch (_) {
    return '';
  }
}

function isVideoRenderingAvailable() {
  return Boolean(ffmpegPath());
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clip(value, max) {
  const t = String(value ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

function num(v) {
  const n = Number(v);
  return (Number.isFinite(n) && n > 0 ? Math.round(n) : 0).toLocaleString('en-GB');
}

function pct(c, p) {
  const a = Number(c) || 0;
  const b = Number(p) || 0;
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

// Scale for an element that pops in at `start` and out at `end` (seconds).
function pop(t, start, end = Infinity, dur = 0.38) {
  if (t < start) return 0;
  if (t > end) return clamp01(1 - (t - end) / 0.22);
  return Math.max(0, easeOutBack(clamp01((t - start) / dur)));
}

function textEl(x, y, content, { size = 28, weight = 700, fill = K.ink, anchor = 'start' } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`;
}

function approxWidth(content, size, weight = 700) {
  return String(content).length * size * (weight >= 700 ? 0.58 : 0.54);
}

// Outlined bubble with offset shadow and a small tail, scaled around its centre.
function bubble(cx, cy, lines, { scale = 1, size = 30, fill = K.white, tail = 'left', color = K.ink, pad = 22, minW = 0, extra = '' } = {}) {
  if (scale <= 0.001) return '';
  const lineH = size * 1.25;
  const w = Math.max(minW, ...lines.map((l) => approxWidth(l.text, l.size || size, l.weight || 700))) + pad * 2;
  const h = lines.reduce((s, l) => s + (l.size || size) * 1.25, 0) + pad * 1.3;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const tailPath = tail === 'left'
    ? `M${x + 26} ${y + h - 2} l-16 22 l34 -20 z`
    : `M${x + w - 26} ${y + h - 2} l16 22 l-34 -20 z`;
  let ty = y + pad * 0.65;
  const texts = lines.map((l) => {
    const s = l.size || size;
    ty += s * 1.05;
    const out = textEl(cx, ty, l.text, { size: s, weight: l.weight || 700, fill: l.fill || color, anchor: 'middle' });
    ty += s * 0.2;
    return out;
  }).join('');
  return `<g transform="translate(${cx} ${cy}) scale(${scale.toFixed(3)}) translate(${-cx} ${-cy})">
    <rect x="${x + 6}" y="${y + 6}" width="${w}" height="${h}" rx="22" fill="${K.line}"/>
    <path d="${tailPath}" fill="${fill}" stroke="${K.line}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${fill}" stroke="${K.line}" stroke-width="3"/>
    ${texts}${extra}
  </g>`;
}

function avatar(cx, cy, r, label, color, scale = 1) {
  if (scale <= 0.001) return '';
  return `<g transform="translate(${cx} ${cy}) scale(${scale.toFixed(3)})">
    <circle r="${r + 3}" fill="${K.line}"/><circle r="${r}" fill="${color}"/>
    ${textEl(0, r * 0.36, label, { size: r * 0.9, weight: 800, fill: K.white, anchor: 'middle' })}
  </g>`;
}

function sparkle(cx, cy, r, color, rot, scale = 1) {
  if (scale <= 0.001) return '';
  const p = `M0 ${-r} Q${r * 0.18} ${-r * 0.18} ${r} 0 Q${r * 0.18} ${r * 0.18} 0 ${r} Q${-r * 0.18} ${r * 0.18} ${-r} 0 Q${-r * 0.18} ${-r * 0.18} 0 ${-r} Z`;
  return `<g transform="translate(${cx} ${cy}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(3)})"><path d="${p}" fill="${color}" stroke="${K.line}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
}

function blob(cx, cy, r, color, rot, scale = 1) {
  if (scale <= 0.001) return '';
  return `<g transform="translate(${cx} ${cy}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(3)})"><rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.55}" fill="${color}" stroke="${K.line}" stroke-width="2.5"/></g>`;
}

function confetti(t, seedShift = 0) {
  const items = [
    [90, 110, 18, K.orange, 'sparkle'], [640, 90, 16, K.yellow, 'blob'], [620, 600, 20, K.teal, 'sparkle'],
    [70, 610, 16, K.purple, 'sparkle'], [360, 60, 10, K.teal, 'blob'], [680, 360, 12, K.purple, 'blob']
  ];
  return items.map(([x, y, r, c, kind], i) => {
    const q = Math.floor(t * 3) / 3; // step motion so neighbouring frames repeat
    const rot = (q * 40 + i * 50 + seedShift) % 360;
    const bob = Math.sin(q * 2 + i) * 6;
    const s = pop(t, 0.1 + i * 0.08);
    return kind === 'sparkle' ? sparkle(x, y + bob, r, c, rot, s) : blob(x, y + bob, r * 0.8, c, rot, s);
  }).join('');
}

function globe(cx, cy, r, opacity) {
  return `<g opacity="${opacity.toFixed(2)}" fill="none" stroke="#F3C99F" stroke-width="14">
    <circle cx="${cx}" cy="${cy}" r="${r}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r * 0.45}" ry="${r}"/>
    <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}"/>
    <path d="M${cx - r * 0.87} ${cy - r * 0.5} Q${cx} ${cy - r * 0.62} ${cx + r * 0.87} ${cy - r * 0.5}"/>
    <path d="M${cx - r * 0.87} ${cy + r * 0.5} Q${cx} ${cy + r * 0.62} ${cx + r * 0.87} ${cy + r * 0.5}"/>
  </g>`;
}

function patternBg(t, word) {
  const rows = [];
  const shift = (t * 60) % 400;
  for (let i = 0; i < 6; i += 1) {
    const dir = i % 2 ? 1 : -1;
    const x = -400 + dir * shift;
    rows.push(`<text x="${x}" y="${40 + i * 128}" font-family="${FONT}" font-size="128" font-weight="900" fill="none" stroke="${K.orange}" stroke-width="2.5" opacity="0.55">${esc(`${word} ${word} ${word} ${word} ${word}`)}</text>`);
  }
  return `<rect width="${SIZE}" height="${SIZE}" fill="${K.peach}"/>${rows.join('')}`;
}

function countUp(value, t, start, dur = 0.9) {
  const v = Number(value) || 0;
  return Math.round(v * easeOutCubic(clamp01((t - start) / dur)));
}

function changeTag(p) {
  if (p === null) return null;
  return { text: `${p > 0 ? '▲ +' : p < 0 ? '▼ ' : ''}${p}% vs last week`, fill: p > 0 ? K.green : p < 0 ? K.red : K.muted };
}

const AVATAR_COLORS = [K.orange, K.purple, K.teal, K.yellow, K.green];

const SHORT_NAMES = { 'United Arab Emirates': 'UAE', 'United States': 'USA', 'United Kingdom': 'UK', 'Saudi Arabia': 'Saudi Arabia' };
const SOURCE_NAMES = { direct: 'Direct / typed in', google: 'Google', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', tiktok: 'TikTok', x: 'X (Twitter)', twitter: 'X (Twitter)', youtube: 'YouTube', linkedin: 'LinkedIn', bing: 'Bing', referral: 'Other websites', chatgpt: 'ChatGPT' };

function sourceName(value) {
  const key = String(value || 'direct').toLowerCase().replace(/^www\./, '').replace(/\.(com|co\.ug|org|net)$/, '');
  return SOURCE_NAMES[key] || clip(String(value || 'Direct'), 18);
}

// Timeline of scenes; each draws with local time `lt` (0..dur) and global `t`.
function buildTimeline(report) {
  const a = report.agent || {};
  const m = report.metrics || {};
  const p = report.previous_metrics || {};
  const x = report.extras || {};
  const enquiries = (Number(m.enquiries) || 0) + (Number(m.whatsapp_clicks) || 0);
  const prevEnq = (Number(p.enquiries) || 0) + (Number(p.whatsapp_clicks) || 0);
  const firstName = String(a.full_name || '').trim().split(/\s+/)[0] || 'Agent';
  const initials = String(a.full_name || 'M A').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  let countries = (Array.isArray(report.top_countries) ? report.top_countries : []).slice(0, 4);
  let countryLabel = 'Where your visitors are';
  if (!countries.length && Array.isArray(x.countries_so_far) && x.countries_so_far.length) {
    countries = x.countries_so_far.slice(0, 4);
    countryLabel = 'Visitors so far this week';
  }
  const totalC = countries.reduce((sum, c) => sum + (Number(c.visitors) || 0), 0) || 1;
  const sources = (Array.isArray(x.traffic_sources) ? x.traffic_sources : []).slice(0, 4);
  const totalS = sources.reduce((sum, c) => sum + (Number(c.visitors) || 0), 0) || 1;
  const listings = (Array.isArray(report.top_listings) ? report.top_listings : []).slice(0, 3);
  const weekText = (() => {
    try {
      const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
      return `${new Date(`${report.week_start}T00:00:00Z`).toLocaleDateString('en-GB', o)} – ${new Date(`${report.week_end}T00:00:00Z`).toLocaleDateString('en-GB', o)}`;
    } catch (_) { return ''; }
  })();
  const out = (lt, dur) => (dur - lt < 0.25 ? dur - 0.25 : Infinity);

  const scenes = [];
  scenes.push({ dur: 2.3, title: true, draw: (lt, t, dur) => [
    patternBg(t, 'WEEKLY'), confetti(t),
    bubble(360, 320, [{ text: 'Your week on', size: 34, weight: 600 }, { text: 'makaug.com', size: 60, weight: 900, fill: K.orange }], { scale: pop(lt, 0.15, out(lt, dur), 0.45), pad: 34 }),
    bubble(360, 470, [{ text: weekText, size: 26, weight: 700 }], { scale: pop(lt, 0.55, out(lt, dur)), fill: K.yellow, tail: 'right' })
  ] });

  scenes.push({ dur: 2.6, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const r = [
      avatar(150, 200, 58, initials, K.orange, pop(lt, 0.05, e)),
      bubble(410, 185, [{ text: `Hi ${clip(firstName, 14)}!`, size: 50, weight: 900 }], { scale: pop(lt, 0.25, e) })
    ];
    if (a.makaug_agent_number) r.push(bubble(400, 330, [{ text: 'Agent ID', size: 22, weight: 600, fill: K.muted }, { text: a.makaug_agent_number, size: 36, weight: 900, fill: K.orange }], { scale: pop(lt, 0.55, e), tail: 'right' }));
    r.push(bubble(270, 470, [{ text: `${num(m.active_listings)} live listings`, size: 34, weight: 800 }], { scale: pop(lt, 0.85, e), fill: K.peach }));
    if (Number(x.new_listings) > 0) r.push(bubble(460, 590, [{ text: `+${num(x.new_listings)} added this week`, size: 28, weight: 800, fill: K.green }], { scale: pop(lt, 1.1, e), tail: 'right' }));
    return r;
  } });

  const statScene = (items) => ({ dur: 0.9 + items.length * 0.55 + 1.0, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const r = [];
    items.forEach((st, i) => {
      const y = 130 + i * (470 / Math.max(1, items.length - 1 || 1));
      const left = i % 2 === 0;
      const start = 0.1 + i * 0.55;
      const sc = pop(lt, start, e);
      const valueText = st.raw ? st.raw : `${countUp(st.value, lt, start).toLocaleString('en-GB')}${st.suffix || ''}`;
      const lines = [{ text: `${valueText} ${st.label}`, size: 36, weight: 900 }];
      if (st.change) lines.push({ text: st.change.text, size: 22, weight: 700, fill: st.change.fill });
      r.push(avatar(left ? 80 : 640, y, 32, st.icon, st.color, sc));
      r.push(bubble(left ? 340 : 380, y, lines, { scale: sc, tail: left ? 'left' : 'right', minW: 320 }));
    });
    return r;
  } });

  scenes.push(statScene([
    { label: 'listing views', value: m.views, change: changeTag(pct(m.views, p.views)), icon: 'V', color: K.purple },
    { label: 'people visited', value: m.visitors, change: changeTag(pct(m.visitors, p.visitors)), icon: 'P', color: K.teal },
    { label: enquiries === 1 ? 'enquiry' : 'enquiries', value: enquiries, change: changeTag(pct(enquiries, prevEnq)), icon: 'E', color: K.orange },
    { label: Number(m.whatsapp_clicks) === 1 ? 'WhatsApp tap' : 'WhatsApp taps', value: m.whatsapp_clicks, change: changeTag(pct(m.whatsapp_clicks, p.whatsapp_clicks)), icon: 'W', color: K.green }
  ]));

  const second = [{ label: m.saves === 1 ? 'save' : 'saves', value: m.saves, change: changeTag(pct(m.saves, p.saves)), icon: 'S', color: K.yellow }];
  if (x.rank && x.rank.position) second.push({ raw: `#${num(x.rank.position)} of ${num(x.rank.total)}`, label: 'agents by views', icon: '#', color: K.purple });
  if (m.visitors) second.push({ raw: `${(Math.round((enquiries / Math.max(1, m.visitors)) * 1000) / 10).toLocaleString('en-GB')}%`, label: 'of visitors got in touch', icon: '%', color: K.teal });
  if (x.views_per_listing) second.push({ raw: `${x.views_per_listing}`, label: 'views per listing', icon: 'L', color: K.orange });
  scenes.push(statScene(second));

  scenes.push({ dur: 1.0 + Math.max(1, countries.length) * 0.4 + 1.1, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const r = [globe(360, 390, 230, 0.9 * clamp01(lt / 0.4)), bubble(360, 90, [{ text: countryLabel, size: 34, weight: 900 }], { scale: pop(lt, 0.05, e), fill: K.peach })];
    if (countries.length) {
      const spots = [[340, 225, 'left', 95], [390, 355, 'right', 640], [330, 485, 'left', 90], [400, 615, 'right', 645]];
      countries.forEach((c, i) => {
        const [cx, cy, tail, ax] = spots[i];
        const sc = pop(lt, 0.4 + i * 0.4, e);
        const share = Math.round(((Number(c.visitors) || 0) / totalC) * 100);
        r.push(avatar(ax, cy, 32, String(c.code || c.name || '?').slice(0, 2).toUpperCase(), AVATAR_COLORS[i % AVATAR_COLORS.length], sc));
        r.push(bubble(cx, cy, [{ text: clip(SHORT_NAMES[c.name] || c.name, 16), size: 34, weight: 900 }, { text: `${num(c.visitors)} visitor${Number(c.visitors) === 1 ? '' : 's'} · ${share}%`, size: 22, weight: 700, fill: K.muted }], { scale: sc, tail, minW: 280 }));
      });
    } else {
      r.push(bubble(360, 380, [{ text: 'Visitor countries', size: 36, weight: 900 }, { text: 'show from next week’s report', size: 28, weight: 700, fill: K.muted }], { scale: pop(lt, 0.4, e) }));
    }
    return r;
  } });

  if (sources.length) {
    scenes.push({ dur: 1.0 + sources.length * 0.4 + 1.0, draw: (lt, t, dur) => {
      const e = out(lt, dur);
      const r = [bubble(360, 90, [{ text: 'How people found you', size: 34, weight: 900 }], { scale: pop(lt, 0.05, e), fill: K.peach })];
      sources.forEach((src, i) => {
        const cy = 220 + i * 130;
        const sc = pop(lt, 0.4 + i * 0.4, e);
        const share = Math.round(((Number(src.visitors) || 0) / totalS) * 100);
        const barW = Math.max(20, (share / 100) * 420);
        r.push(bubble(i % 2 ? 390 : 330, cy, [{ text: `${sourceName(src.source)} · ${share}%`, size: 32, weight: 900 }], { scale: sc, tail: i % 2 ? 'right' : 'left', minW: 380 }));
        if (sc > 0.9) r.push(`<rect x="150" y="${cy + 52}" width="420" height="12" rx="6" fill="#F3DDC9"/><rect x="150" y="${cy + 52}" width="${(barW * clamp01((lt - 0.4 - i * 0.4) / 0.6)).toFixed(1)}" height="12" rx="6" fill="${K.orange}"/>`);
      });
      return r;
    } });
  }

  if (x.busiest_day || x.peak_hour) {
    scenes.push({ dur: 2.4, draw: (lt, t, dur) => {
      const e = out(lt, dur);
      const r = [bubble(360, 110, [{ text: 'When buyers are looking', size: 34, weight: 900 }], { scale: pop(lt, 0.05, e), fill: K.peach })];
      if (x.busiest_day) r.push(avatar(110, 290, 40, 'D', K.purple, pop(lt, 0.4, e)), bubble(390, 290, [{ text: `Busiest day: ${x.busiest_day.day}`, size: 34, weight: 900 }, { text: `${num(x.busiest_day.views)} views`, size: 24, weight: 700, fill: K.muted }], { scale: pop(lt, 0.4, e), minW: 360 }));
      if (x.peak_hour) r.push(avatar(610, 470, 40, 'T', K.teal, pop(lt, 0.8, e)), bubble(330, 470, [{ text: `Peak time: ${x.peak_hour.label}`, size: 34, weight: 900 }, { text: 'reply fast around then', size: 24, weight: 700, fill: K.muted }], { scale: pop(lt, 0.8, e), tail: 'right', minW: 360 }));
      return r;
    } });
  }

  if (listings.length) {
    scenes.push({ dur: 1.0 + listings.length * 0.45 + 1.2, draw: (lt, t, dur) => {
      const e = out(lt, dur);
      const r = [bubble(360, 100, [{ text: 'Your best properties', size: 34, weight: 900 }], { scale: pop(lt, 0.05, e), fill: K.peach })];
      listings.forEach((l, i) => {
        const cy = 240 + i * 150;
        const sc = pop(lt, 0.4 + i * 0.45, e);
        r.push(avatar(i % 2 ? 640 : 80, cy, 30, String(i + 1), AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length], sc));
        r.push(bubble(i % 2 ? 380 : 340, cy, [{ text: clip(l.title, 24), size: 32, weight: 900 }, { text: `${num(l.views)} views · ${num(l.enquiries)} enquiries`, size: 22, weight: 700, fill: K.orange }], { scale: sc, tail: i % 2 ? 'right' : 'left', minW: 380 }));
      });
      return r;
    } });
  }

  scenes.push({ dur: 2.0, draw: (lt) => {
    const sc = pop(lt, 0.05, Infinity, 0.45);
    return [
      `<circle cx="360" cy="320" r="${(150 * sc).toFixed(1)}" fill="${K.orange}" stroke="${K.line}" stroke-width="4"/>`,
      `<g transform="translate(360 320) scale(${sc.toFixed(3)}) translate(-360 -320)">${textEl(360, 340, 'makaug', { size: 54, weight: 900, fill: K.white, anchor: 'middle' })}</g>`,
      bubble(360, 560, [{ text: 'Full report: tap the link below', size: 30, weight: 800 }], { scale: pop(lt, 0.3) })
    ];
  } });

  let at = 0;
  scenes.forEach((sc) => { sc.start = at; at += sc.dur; });
  return { scenes, duration: at };
}

function buildScenes(report) {
  const { scenes } = buildTimeline(report);
  return (t) => {
    const sc = scenes.find((s) => t < s.start + s.dur) || scenes[scenes.length - 1];
    const lt = t - sc.start;
    const parts = sc.title ? [] : [`<rect width="${SIZE}" height="${SIZE}" fill="${K.cream}"/>`, confetti(t, 90)];
    return parts.concat(sc.draw(lt, t, sc.dur)).join('');
  };
}

function videoDuration(report) {
  return buildTimeline(report).duration;
}

function frameSvg(scene, t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${scene(t)}</svg>`;
}

function cachePath(id, version, prefix = '') {
  return path.join(CACHE_DIR, `${prefix}${String(id).replace(/[^a-z0-9-]/gi, '')}-${String(version).replace(/\D/g, '')}.mp4`);
}

async function encodeVideo({ scene, duration, label }, outFile) {
  const bin = ffmpegPath();
  if (!bin) throw new Error('Video rendering is not available on this server');
  require('./agentReportCardService').ensureFontconfig();
  const sharp = require('sharp');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.${process.pid}.tmp.mp4`;
  const ff = spawn(bin, [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SIZE}x${SIZE}`, '-r', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    tmp
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  let failed = null;
  ff.stderr.on('data', (d) => { stderr += d.toString(); });
  ff.stdin.on('error', (error) => { failed = failed || error; });
  const done = new Promise((resolve, reject) => {
    ff.on('error', (error) => { failed = failed || error; reject(error); });
    ff.on('close', (code) => {
      if (code === 0) return resolve();
      const error = new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`);
      failed = failed || error;
      return reject(error);
    });
  });
  done.catch(() => {});
  const frames = Math.round(duration * FPS);
  let lastSvg = '';
  let lastRaw = null;
  const started = Date.now();
  console.log(`[agent-report] video render start ${label} frames=${frames}`);
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  try {
    for (let i = 0; i < frames; i += 1) {
      if (failed) throw failed;
      if (Date.now() > deadline) throw new Error('Video render took too long');
      const svg = frameSvg(scene, i / FPS);
      const raw = svg === lastSvg && lastRaw ? lastRaw : await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
      lastSvg = svg;
      lastRaw = raw;
      if (failed) throw failed;
      if (!ff.stdin.write(raw)) {
        // Never wait on a pipe whose reader has died: race drain against exit.
        await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), done]);
      }
    }
    ff.stdin.end();
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('ffmpeg did not finish')), 30000))]);
    fs.renameSync(tmp, outFile);
    console.log(`[agent-report] video render done ${label} ms=${Date.now() - started}`);
  } catch (error) {
    try { ff.kill('SIGKILL'); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw error;
  }
  return outFile;
}

// Returns a path to the MP4 for this report version, rendering once and caching.
async function ensureReportVideo(report, version) {
  const file = cachePath(report.id, version);
  if (fs.existsSync(file)) return file;
  const key = file;
  if (!inflight.has(key)) {
    inflight.set(key, encodeVideo({ scene: buildScenes(report), duration: videoDuration(report), label: `report=${report.id}` }, file)
      .then((result) => { lastErrors.delete(report.id); return result; })
      .catch((error) => {
        lastErrors.set(report.id, `${error.message}`.slice(0, 300));
        console.error('[agent-report] video render failed', report.id, error);
        throw error;
      })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

function lastVideoError(reportId) {
  return lastErrors.get(reportId) || null;
}

// Welcome film for an agent who has just joined: what makaug is, how big the
// audience is, who is watching from abroad, and why listings belong here.
function buildWelcomeTimeline({ agent = {}, stats = {} } = {}) {
  const firstName = String(agent.full_name || '').trim().split(/\s+/)[0] || 'there';
  const initials = String(agent.full_name || 'M A').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const countries = (Array.isArray(stats.top_countries) ? stats.top_countries : []).slice(0, 4);
  const out = (lt, dur) => (dur - lt < 0.25 ? dur - 0.25 : Infinity);
  const scenes = [];

  scenes.push({ dur: 2.4, title: true, draw: (lt, t, dur) => [
    patternBg(t, 'WELCOME'), confetti(t),
    bubble(360, 310, [{ text: 'Welcome to', size: 34, weight: 600 }, { text: 'makaug.com', size: 60, weight: 900, fill: K.orange }], { scale: pop(lt, 0.15, out(lt, dur), 0.45), pad: 34 }),
    bubble(360, 460, [{ text: `Hi ${clip(firstName, 16)} — you’re in`, size: 28, weight: 700 }], { scale: pop(lt, 0.6, out(lt, dur)), fill: K.yellow, tail: 'right' })
  ] });

  scenes.push({ dur: 2.8, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const r = [
      avatar(140, 190, 54, initials, K.orange, pop(lt, 0.05, e)),
      bubble(420, 175, [{ text: 'Uganda’s property', size: 34, weight: 900 }, { text: 'discovery platform', size: 34, weight: 900, fill: K.orange }], { scale: pop(lt, 0.2, e) })
    ];
    const tags = ['Rent', 'Buy', 'Land', 'Commercial', 'Students', 'Off Plan', 'Short stays'];
    tags.forEach((tag, i) => {
      const cx = 150 + (i % 3) * 210 + (Math.floor(i / 3) % 2 ? 60 : 0);
      const cy = 360 + Math.floor(i / 3) * 120;
      r.push(bubble(cx, cy, [{ text: tag, size: 28, weight: 800 }], { scale: pop(lt, 0.5 + i * 0.14, e), fill: i % 2 ? K.white : K.peach, tail: i % 2 ? 'right' : 'left' }));
    });
    return r;
  } });

  scenes.push({ dur: 3.4, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const items = [
      { value: stats.live_listings, label: 'live listings', icon: 'L', color: K.purple },
      { value: stats.agents, label: 'agents & brokers', icon: 'A', color: K.teal },
      { value: stats.views_30d, label: 'listing views a month', icon: 'V', color: K.orange },
      { value: stats.visitors_30d, label: 'people a month', icon: 'P', color: K.green }
    ].filter((item) => Number(item.value) > 0);
    return items.map((item, i) => {
      const y = 150 + i * (460 / Math.max(1, items.length - 1 || 1));
      const left = i % 2 === 0;
      const sc = pop(lt, 0.1 + i * 0.55, e);
      return [
        avatar(left ? 80 : 640, y, 32, item.icon, item.color, sc),
        bubble(left ? 340 : 380, y, [{ text: `${countUp(item.value, lt, 0.1 + i * 0.55).toLocaleString('en-GB')} ${item.label}`, size: 34, weight: 900 }], { scale: sc, tail: left ? 'left' : 'right', minW: 340 })
      ].join('');
    });
  } });

  scenes.push({ dur: 1.2 + Math.max(1, countries.length) * 0.4 + 1.2, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const r = [globe(360, 390, 230, 0.9 * clamp01(lt / 0.4)),
      bubble(360, 90, [{ text: 'Uganda’s buyers are everywhere', size: 30, weight: 900 }], { scale: pop(lt, 0.05, e), fill: K.peach })];
    if (countries.length) {
      const spots = [[340, 230, 'left', 95], [390, 355, 'right', 640], [330, 485, 'left', 90], [400, 610, 'right', 645]];
      countries.forEach((c, i) => {
        const [cx, cy, tail, ax] = spots[i];
        const sc = pop(lt, 0.4 + i * 0.4, e);
        r.push(avatar(ax, cy, 32, String(c.code || c.name || '?').slice(0, 2).toUpperCase(), AVATAR_COLORS[i % AVATAR_COLORS.length], sc));
        r.push(bubble(cx, cy, [{ text: clip(SHORT_NAMES[c.name] || c.name, 16), size: 32, weight: 900 }], { scale: sc, tail, minW: 260 }));
      });
    } else {
      r.push(bubble(360, 380, [{ text: 'Diaspora buyers search', size: 32, weight: 900 }, { text: 'from the UK, UAE, USA and beyond', size: 24, weight: 700, fill: K.muted }], { scale: pop(lt, 0.4, e) }));
    }
    return r;
  } });

  const reasons = [
    ['Your number, your deal', 'buyers call you direct, no commission'],
    ['Found by search & AI', 'Google, Ask AI and WhatsApp send buyers'],
    ['Video-first listings', 'diaspora buyers decide from a video'],
    ['Free to start', 'first 7 days free on every listing']
  ];
  reasons.forEach(([head, sub], i) => {
    scenes.push({ dur: 1.9, draw: (lt, t, dur) => {
      const e = out(lt, dur);
      return [
        avatar(i % 2 ? 620 : 100, 250, 38, String(i + 1), AVATAR_COLORS[i % AVATAR_COLORS.length], pop(lt, 0.05, e)),
        bubble(360, 330, [{ text: head, size: 38, weight: 900 }], { scale: pop(lt, 0.1, e), pad: 28 }),
        bubble(360, 470, [{ text: clip(sub, 40), size: 24, weight: 700, fill: K.muted }], { scale: pop(lt, 0.4, e), fill: K.peach, tail: i % 2 ? 'right' : 'left' })
      ];
    } });
  });

  scenes.push({ dur: 2.6, draw: (lt, t, dur) => {
    const e = out(lt, dur);
    const steps = ['Add photos or a video', 'Set a clear price and area', 'Reply here to get help'];
    const r = [bubble(360, 110, [{ text: 'Your first listing in 3 steps', size: 32, weight: 900 }], { scale: pop(lt, 0.05, e), fill: K.peach })];
    steps.forEach((step, i) => {
      const cy = 260 + i * 140;
      const sc = pop(lt, 0.3 + i * 0.4, e);
      r.push(avatar(i % 2 ? 640 : 80, cy, 30, String(i + 1), AVATAR_COLORS[(i + 2) % AVATAR_COLORS.length], sc));
      r.push(bubble(i % 2 ? 380 : 340, cy, [{ text: step, size: 30, weight: 900 }], { scale: sc, tail: i % 2 ? 'right' : 'left', minW: 360 }));
    });
    return r;
  } });

  scenes.push({ dur: 2.2, draw: (lt) => {
    const sc = pop(lt, 0.05, Infinity, 0.45);
    const r = [
      `<circle cx="360" cy="300" r="${(150 * sc).toFixed(1)}" fill="${K.orange}" stroke="${K.line}" stroke-width="4"/>`,
      `<g transform="translate(360 300) scale(${sc.toFixed(3)}) translate(-360 -300)">${textEl(360, 320, 'makaug', { size: 54, weight: 900, fill: K.white, anchor: 'middle' })}</g>`
    ];
    if (agent.makaug_agent_number) r.push(bubble(360, 520, [{ text: 'Your Agent ID', size: 22, weight: 600, fill: K.muted }, { text: agent.makaug_agent_number, size: 34, weight: 900, fill: K.orange }], { scale: pop(lt, 0.3) }));
    r.push(bubble(360, 640, [{ text: 'makaug.com', size: 28, weight: 800 }], { scale: pop(lt, 0.55), fill: K.peach, tail: 'right' }));
    return r;
  } });

  let at = 0;
  scenes.forEach((sc) => { sc.start = at; at += sc.dur; });
  return { scenes, duration: at };
}

function buildWelcomeScenes(payload) {
  const { scenes } = buildWelcomeTimeline(payload);
  return (t) => {
    const sc = scenes.find((one) => t < one.start + one.dur) || scenes[scenes.length - 1];
    const parts = sc.title ? [] : [`<rect width="${SIZE}" height="${SIZE}" fill="${K.cream}"/>`, confetti(t, 90)];
    return parts.concat(sc.draw(t - sc.start, t, sc.dur)).join('');
  };
}

function welcomeDuration(payload) {
  return buildWelcomeTimeline(payload).duration;
}

async function ensureWelcomeVideo(payload, version) {
  const file = cachePath(payload.agent?.id || 'agent', version, 'welcome-');
  if (fs.existsSync(file)) return file;
  if (!inflight.has(file)) {
    inflight.set(file, encodeVideo({
      scene: buildWelcomeScenes(payload),
      duration: welcomeDuration(payload),
      label: `welcome=${payload.agent?.id || 'agent'}`
    }, file).finally(() => inflight.delete(file)));
  }
  return inflight.get(file);
}

function welcomeVideoUrl(agent, baseUrl, version) {
  const cards = require('./agentReportCardService');
  const stamp = String(version || new Date().toISOString().slice(0, 10).replace(/\D/g, ''));
  const token = cards.cardToken(`${agent.id}:welcome`, stamp);
  if (!token) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}/api/agents/welcome-video/${encodeURIComponent(agent.id)}.mp4?v=${stamp}&t=${token}`;
}

function reportVideoUrl(report, baseUrl) {
  const cards = require('./agentReportCardService');
  const version = cards.cardVersion(report);
  const token = cards.cardToken(`${report.id}:video`, version);
  if (!token) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}/api/agents/report-video/${encodeURIComponent(report.id)}.mp4?v=${version}&t=${token}`;
}

module.exports = {
  buildWelcomeScenes,
  ensureWelcomeVideo,
  welcomeDuration,
  welcomeVideoUrl,
  videoDuration,
  buildScenes,
  ensureReportVideo,
  frameSvg,
  isVideoRenderingAvailable,
  lastVideoError,
  reportVideoUrl
};
