'use strict';
// The agents' brief (Morning Brief): five property stories in 30 seconds, from an edition JSON file.
// See README.md. Needs Playwright (Chromium) and the Noto Color Emoji font; render.sh needs ffmpeg.
// Each scene is a 1080x1920 HTML page screenshotted to JPEG; render.sh does the rest.
// Story scenes come in two states: A (the story) and B (the story + "what it means for you").
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FONTS = path.join(__dirname, '..', '..', 'assets', 'fonts', 'share-card');
// Usage: node scenes.js <edition.json> [buildDir]
const EDITION_FILE = process.argv[2];
if (!EDITION_FILE) throw new Error('Usage: node scripts/agent-brief/scenes.js <edition.json> [buildDir]');
const EDITION = JSON.parse(fs.readFileSync(EDITION_FILE, 'utf8'));
const BUILD_DIR = path.resolve(process.argv[3] || path.join(__dirname, 'build'));

// Progress bars: five segments, the current one is filled by ffmpeg (render.sh uses the same numbers).
const BAR = { left: 48, top: 46, w: 187, gap: 12, h: 10 };

const STORIES = EDITION.stories;
const LABEL = EDITION.label || 'MORNING BRIEF';
if (!Array.isArray(STORIES) || STORIES.length !== 5) throw new Error('An edition needs exactly 5 stories');

const CSS = `
@font-face{font-family:PJS;src:url("file://${FONTS}/PlusJakartaSans-Regular.ttf");font-weight:400}
@font-face{font-family:PJS;src:url("file://${FONTS}/PlusJakartaSans-SemiBold.ttf");font-weight:500 600}
@font-face{font-family:PJS;src:url("file://${FONTS}/PlusJakartaSans-Bold.ttf");font-weight:700 900}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1920px;overflow:hidden}
body{position:relative;font-family:PJS,"Noto Color Emoji",sans-serif;color:#15213A;background:#F1F7F2}
body.dark{background:#0F3D2A;color:#fff}
.bars{position:absolute;left:${BAR.left}px;top:${BAR.top}px;display:flex;gap:${BAR.gap}px}
.bars i{display:block;width:${BAR.w}px;height:${BAR.h}px;border-radius:2px;background:rgba(21,33,58,.14)}
.bars i.full{background:#15803D}
.dark .bars i{background:rgba(255,255,255,.22)}
.dark .bars i.full{background:#F5B400}
.top{position:absolute;left:64px;right:64px;top:104px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:18px}
.mark{width:76px;height:76px}
.mark svg{width:76px;height:76px;display:block}
.word{font-size:46px;font-weight:700;letter-spacing:-.5px}
.word b{color:#F5B400;font-weight:700}
.ed{text-align:right}
.ed .k{font-size:25px;font-weight:800;letter-spacing:4px;color:#15803D}
.dark .ed .k{color:#F5B400}
.ed .d{font-size:27px;font-weight:600;color:#5B6475;margin-top:4px}
.dark .ed .d{color:#BBF7D0}
.meta{position:absolute;left:64px;right:64px;top:290px;display:flex;align-items:center;gap:26px}
.no{font-weight:800;line-height:1;color:#15803D}
.no b{font-size:120px;font-weight:800;letter-spacing:-4px}
.no span{font-size:44px;color:#9AA3B2;font-weight:700;margin-left:4px}
.chip{background:#F5B400;color:#15213A;font-weight:800;font-size:30px;letter-spacing:3px;padding:12px 26px;border-radius:999px}
.emo{margin-left:auto;width:168px;height:168px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:96px;box-shadow:0 8px 24px rgba(15,61,42,.12)}
h1{position:absolute;left:64px;right:64px;top:505px;font-size:100px;line-height:1.06;font-weight:800;letter-spacing:-2px;text-wrap:balance}
.storyblock{position:absolute;left:64px;right:64px;top:790px}
.label{font-size:29px;font-weight:800;letter-spacing:4px;color:#15803D}
.txt{text-wrap:pretty;margin-top:18px;font-size:54px;line-height:1.3;color:#3A4458;font-weight:500}
.txt b{color:#15213A;font-weight:800}
.you{position:absolute;left:48px;right:48px;top:1265px;background:#15803D;color:#fff;border-radius:44px;padding:50px 52px 56px;box-shadow:0 18px 40px rgba(15,61,42,.22)}
.you .label{color:#F5B400;font-size:30px}
.you p{text-wrap:pretty;margin-top:20px;font-size:64px;line-height:1.2;font-weight:800;letter-spacing:-.5px}
.you .hl{color:#FDE68A}
.hide{visibility:hidden}
.foot{position:absolute;left:64px;right:64px;bottom:58px;display:flex;justify-content:space-between;gap:24px;font-size:26px;color:#5B6475;font-weight:600}
.foot .s{flex:1;min-width:0}
.foot .m{color:#15803D;font-weight:800}
.center{position:absolute;left:72px;right:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.pill{align-self:flex-start;background:#F5B400;color:#15213A;font-weight:800;font-size:34px;letter-spacing:4px;padding:12px 30px;border-radius:999px}
`;

const MARK = '<svg viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#15803D"/><path d="M126 365V147h59l71 115 71-115h59v218h-59V237l-54 87h-34l-54-87v128z" fill="#fff"/></svg>';
const bars = (filled) => `<div class="bars">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < filled ? 'full' : ''}"></i>`).join('')}</div>`;
const top = (dark) => `<div class="top"><div class="brand"><div class="mark">${MARK}</div><div class="word" style="color:${dark ? '#fff' : '#15213A'}">makaug<b>.com</b></div></div>
  <div class="ed"><div class="k">${LABEL}</div><div class="d">${EDITION.short}</div></div></div>`;
const page = (body, cls = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body class="${cls}">${body}</body></html>`;

function storyPage(s, i, reveal) {
  return page(`${bars(i)}${top(false)}
  <div class="meta"><div class="no"><b>${i + 1}</b><span>/5</span></div><div class="chip">${s.chip}</div><div class="emo">${s.emoji}</div></div>
  <h1>${s.title}</h1>
  <div class="storyblock"><div class="label">THE STORY</div><p class="txt">${s.story}</p></div>
  <section class="you${reveal ? '' : ' hide'}"><div class="label">👉 WHAT IT MEANS FOR YOU</div><p>${s.you}</p></section>
  <div class="foot"><span class="s">${s.source}</span><span class="m">makaug.com</span></div>`);
}

const intro = page(`${bars(0)}${top(true)}
  <div class="center">
    <div style="font-size:150px;line-height:1">${EDITION.emoji || '☀️'}</div>
    <div class="pill" style="margin-top:46px">${LABEL}</div>
    <div style="margin-top:30px;font-size:44px;font-weight:600;color:#BBF7D0">${EDITION.long}</div>
    <div style="margin-top:34px;font-size:98px;line-height:1.04;font-weight:800;letter-spacing:-2.5px">5 property stories that affect your business today</div>
    <div style="margin-top:40px;font-size:46px;line-height:1.35;color:#BBF7D0;font-weight:500;text-wrap:balance">What happened, and <b style="color:#fff">what it means for you</b></div>
  </div>
  <div class="foot" style="color:#86EFAC"><span>For makaug agents · 30 seconds</span><span style="color:#F5B400;font-weight:800">makaug.com</span></div>`, 'dark');

const outro = page(`${bars(5)}${top(true)}
  <div class="center">
    <div style="font-size:120px;line-height:1">✅</div>
    <div style="margin-top:40px;font-size:96px;line-height:1.05;font-weight:800;letter-spacing:-2px">That’s today’s brief</div>
    <div style="margin-top:36px;font-size:50px;line-height:1.32;color:#BBF7D0;font-weight:500">Read the full stories — the links are in the message below 👇</div>
    <div style="margin-top:70px;font-size:44px;line-height:1.35;font-weight:700;text-wrap:balance">New listing? Send it to makaug on WhatsApp. It goes live with your name and number.</div>
  </div>
  <div class="foot" style="color:#86EFAC"><span>See you tomorrow morning ☀️</span><span style="color:#F5B400;font-weight:800">makaug.com</span></div>`, 'dark');

(async () => {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const pages = [['s00', intro]];
  STORIES.forEach((s, i) => {
    const n = String(i + 1).padStart(2, '0');
    pages.push([`s${n}a`, storyPage(s, i, false)], [`s${n}b`, storyPage(s, i, true)]);
  });
  pages.push(['s06', outro]);
  const browser = await chromium.launch();
  const page_ = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  for (const [name, html] of pages) {
    const file = path.join(BUILD_DIR, `${name}.html`);
    fs.writeFileSync(file, html);
    await page_.goto(`file://${file}`);
    await page_.evaluate(() => document.fonts.ready);
    await page_.waitForTimeout(120);
    // Overflow guard: nothing may run past the panel or the footer.
    const clash = await page_.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
      const h1 = r('h1'); const sb = r('.storyblock'); const you = r('.you'); const foot = r('.foot');
      const out = [];
      if (h1 && sb && h1.bottom > sb.top - 20) out.push(`h1 bottom ${Math.round(h1.bottom)} > story top ${Math.round(sb.top)}`);
      if (sb && you && sb.bottom > you.top - 30) out.push(`story bottom ${Math.round(sb.bottom)} > panel top ${Math.round(you.top)}`);
      if (you && foot && you.bottom > foot.top - 30) out.push(`panel bottom ${Math.round(you.bottom)} > foot top ${Math.round(foot.top)}`);
      return out;
    });
    if (clash.length) console.log(name, 'LAYOUT:', clash.join('; '));
    await page_.screenshot({ path: path.join(BUILD_DIR, `${name}.jpg`), type: 'jpeg', quality: 92 });
  }
  await browser.close();
  console.log('rendered', pages.length, 'stills');
})();
