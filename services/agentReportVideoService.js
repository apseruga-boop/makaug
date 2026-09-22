'use strict';

// Animated "your week on makaug" recap video (720×720 MP4, ~13 s) for an
// agent's weekly report. Frames are drawn as SVG, rasterised with sharp and
// piped into ffmpeg. Style: cream ground, outlined chat bubbles with offset
// shadows, confetti, stats that count up, a country scene and a closing card.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SIZE = 720;
const FPS = 24;
const DURATION = 13;
const FONT = "'Noto Sans', 'DejaVu Sans', Arial, sans-serif";
const CACHE_DIR = path.join(os.tmpdir(), 'makaug-report-videos');
const inflight = new Map();
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
    const rot = (t * 40 + i * 50 + seedShift) % 360;
    const bob = Math.sin(t * 2 + i) * 6;
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

function buildScenes(report) {
  const a = report.agent || {};
  const m = report.metrics || {};
  const p = report.previous_metrics || {};
  const enquiries = (Number(m.enquiries) || 0) + (Number(m.whatsapp_clicks) || 0);
  const prevEnq = (Number(p.enquiries) || 0) + (Number(p.whatsapp_clicks) || 0);
  const firstName = String(a.full_name || '').trim().split(/\s+/)[0] || 'Agent';
  const initials = String(a.full_name || 'M A').trim().split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const countries = (Array.isArray(report.top_countries) ? report.top_countries : []).slice(0, 4);
  const totalC = countries.reduce((s, c) => s + (Number(c.visitors) || 0), 0) || 1;
  const top = (Array.isArray(report.top_listings) ? report.top_listings : [])[0] || null;
  const weekText = (() => {
    try {
      const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
      return `${new Date(`${report.week_start}T00:00:00Z`).toLocaleDateString('en-GB', o)} – ${new Date(`${report.week_end}T00:00:00Z`).toLocaleDateString('en-GB', o)}`;
    } catch (_) { return ''; }
  })();

  return (t) => {
    const parts = [];
    // Scene 1: title card (0 – 2.2 s)
    if (t < 2.4) {
      parts.push(patternBg(t, 'WEEKLY'));
      parts.push(confetti(t));
      const s = pop(t, 0.2, 2.1, 0.45);
      parts.push(bubble(360, 330, [{ text: 'Your week on', size: 34, weight: 600 }, { text: 'makaug.com', size: 60, weight: 900, fill: K.orange }], { scale: s, pad: 34 }));
      parts.push(bubble(360, 470, [{ text: weekText, size: 26, weight: 700 }], { scale: pop(t, 0.6, 2.1), fill: K.yellow, tail: 'right' }));
      return parts.join('');
    }
    parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="${K.cream}"/>`);
    parts.push(confetti(t, 90));

    // Scene 2: who (2.4 – 4.6 s)
    if (t < 4.8) {
      parts.push(avatar(160, 250, 58, initials, K.orange, pop(t, 2.5, 4.6)));
      parts.push(bubble(410, 230, [{ text: `Hi ${clip(firstName, 14)}!`, size: 50, weight: 900 }], { scale: pop(t, 2.7, 4.6) }));
      if (a.makaug_agent_number) {
        parts.push(bubble(400, 380, [{ text: 'Agent ID', size: 22, weight: 600, fill: K.muted }, { text: a.makaug_agent_number, size: 36, weight: 900, fill: K.orange }], { scale: pop(t, 3.0, 4.6), tail: 'right' }));
      }
      parts.push(bubble(300, 520, [{ text: `${num(m.active_listings)} live listings`, size: 34, weight: 800 }], { scale: pop(t, 3.3, 4.6), fill: K.peach }));
      return parts.join('');
    }

    // Scene 3: stats that count up (4.8 – 8.0 s)
    if (t < 8.2) {
      const stats = [
        { y: 150, x: 330, label: 'listing views', value: m.views, change: changeTag(pct(m.views, p.views)), start: 4.9, tail: 'left', av: ['V', K.purple, 90] },
        { y: 310, x: 390, label: 'people visited', value: m.visitors, change: changeTag(pct(m.visitors, p.visitors)), start: 5.5, tail: 'right', av: ['P', K.teal, 640] },
        { y: 470, x: 330, label: enquiries === 1 ? 'enquiry' : 'enquiries', value: enquiries, change: changeTag(pct(enquiries, prevEnq)), start: 6.1, tail: 'left', av: ['E', K.orange, 90] },
        { y: 615, x: 400, label: m.saves === 1 ? 'save' : 'saves', value: m.saves, change: null, start: 6.7, tail: 'right', av: ['S', K.yellow, 650] }
      ];
      stats.forEach((st) => {
        const s = pop(t, st.start, 8.0);
        const lines = [{ text: `${countUp(st.value, t, st.start).toLocaleString('en-GB')} ${st.label}`, size: 40, weight: 900 }];
        if (st.change) lines.push({ text: st.change.text, size: 22, weight: 700, fill: st.change.fill });
        parts.push(avatar(st.av[2], st.y, 34, st.av[0], st.av[1], s));
        parts.push(bubble(st.x, st.y, lines, { scale: s, tail: st.tail, minW: 300 }));
      });
      return parts.join('');
    }

    // Scene 4: countries (8.2 – 10.6 s)
    if (t < 10.8) {
      parts.push(globe(360, 380, 230, 0.9 * clamp01((t - 8.2) / 0.4)));
      parts.push(bubble(360, 90, [{ text: 'Where your visitors are', size: 34, weight: 900 }], { scale: pop(t, 8.25, 10.6), fill: K.peach }));
      if (countries.length) {
        const spots = [[330, 230, 'left', 110], [400, 360, 'right', 640], [320, 490, 'left', 100], [410, 620, 'right', 650]];
        const SHORT = { 'United Arab Emirates': 'UAE', 'United Kingdom': 'United Kingdom', 'United States': 'USA', 'DR Congo': 'DR Congo' };
        countries.forEach((c, i) => {
          const [x, y, tail, ax] = spots[i];
          c = { ...c, name: SHORT[c.name] || c.name };
          const s = pop(t, 8.6 + i * 0.35, 10.6);
          const share = Math.round(((Number(c.visitors) || 0) / totalC) * 100);
          parts.push(avatar(ax, y, 32, (c.code || c.name || '?').slice(0, 2).toUpperCase(), AVATAR_COLORS[i % AVATAR_COLORS.length], s));
          parts.push(bubble(x, y, [{ text: clip(c.name, 18), size: 34, weight: 900 }, { text: `${num(c.visitors)} visitors · ${share}%`, size: 22, weight: 700, fill: K.muted }], { scale: s, tail, minW: 280 }));
        });
      } else {
        parts.push(bubble(360, 360, [{ text: 'Visitor countries', size: 36, weight: 900 }, { text: 'start in next week’s report', size: 28, weight: 700, fill: K.muted }], { scale: pop(t, 8.6, 10.6) }));
      }
      return parts.join('');
    }

    // Scene 5: top property (10.8 – 11.9 s)
    if (t < 12.0 && top) {
      parts.push(bubble(360, 200, [{ text: 'Your top property', size: 32, weight: 800, fill: K.muted }], { scale: pop(t, 10.85, 11.9), fill: K.peach }));
      parts.push(bubble(360, 360, [{ text: clip(top.title, 26), size: 38, weight: 900 }, { text: `${num(top.views)} views · ${num(top.enquiries)} enquiries`, size: 26, weight: 700, fill: K.orange }], { scale: pop(t, 11.0, 11.9), pad: 30 }));
      return parts.join('');
    }

    // Scene 6: close
    const s = pop(t, top ? 12.0 : 10.8, Infinity, 0.45);
    parts.push(`<circle cx="360" cy="330" r="${(150 * s).toFixed(1)}" fill="${K.orange}" stroke="${K.line}" stroke-width="4"/>`);
    parts.push(`<g transform="translate(360 330) scale(${s.toFixed(3)}) translate(-360 -330)">${textEl(360, 350, 'makaug', { size: 54, weight: 900, fill: K.white, anchor: 'middle' })}</g>`);
    parts.push(bubble(360, 560, [{ text: 'Full report: tap the link below', size: 30, weight: 800 }], { scale: pop(t, (top ? 12.0 : 10.8) + 0.25) }));
    return parts.join('');
  };
}

function frameSvg(scene, t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${scene(t)}</svg>`;
}

function cachePath(reportId, version) {
  return path.join(CACHE_DIR, `${String(reportId).replace(/[^a-z0-9-]/gi, '')}-${String(version).replace(/\D/g, '')}.mp4`);
}

async function encodeVideo(report, outFile) {
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
  const scene = buildScenes(report);
  const frames = Math.round(DURATION * FPS);
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  try {
    for (let i = 0; i < frames; i += 1) {
      if (failed) throw failed;
      if (Date.now() > deadline) throw new Error('Video render took too long');
      const raw = await sharp(Buffer.from(frameSvg(scene, i / FPS))).ensureAlpha().raw().toBuffer();
      if (failed) throw failed;
      if (!ff.stdin.write(raw)) {
        // Never wait on a pipe whose reader has died: race drain against exit.
        await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), done]);
      }
    }
    ff.stdin.end();
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('ffmpeg did not finish')), 30000))]);
    fs.renameSync(tmp, outFile);
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
    inflight.set(key, encodeVideo(report, file).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

function reportVideoUrl(report, baseUrl) {
  const cards = require('./agentReportCardService');
  const version = cards.cardVersion(report);
  const token = cards.cardToken(`${report.id}:video`, version);
  if (!token) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}/api/agents/report-video/${encodeURIComponent(report.id)}.mp4?v=${version}&t=${token}`;
}

module.exports = {
  DURATION,
  buildScenes,
  ensureReportVideo,
  frameSvg,
  isVideoRenderingAvailable,
  reportVideoUrl
};
