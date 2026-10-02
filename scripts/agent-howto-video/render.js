#!/usr/bin/env node
// Renders scene.html to a vertical 1080x1920 MP4 for WhatsApp.
//   node scripts/agent-howto-video/render.js [out.mp4] [--fps 30] [--still 14.5]
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const out = args.find((a) => a.endsWith('.mp4') || a.endsWith('.png')) || path.join(__dirname, 'makaug-agent-how-to-post-v2.mp4');
const fps = Number(args[args.indexOf('--fps') + 1]) || 30;
const stillIdx = args.indexOf('--still');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(__dirname, 'scene.html'));
  await page.evaluate(() => document.fonts.ready);
  if (stillIdx >= 0) {
    const times = args.slice(stillIdx + 1).filter((a) => /^[\d.]+$/.test(a)).map(Number);
    for (const t of times) {
      await page.evaluate((x) => window.renderAt(x), t);
      await page.screenshot({ path: out.replace(/\.png$/, '') + `-${t}.png` });
    }
    await browser.close();
    return;
  }
  const duration = await page.evaluate(() => window.DURATION);
  const frames = Math.ceil(duration * fps);
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-shortest', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23',
    '-vf', 'scale=720:1280', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < frames; f += 1) {
    await page.evaluate((x) => window.renderAt(x), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 150 === 0) process.stderr.write(`frame ${f}/${frames}\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
  console.log('wrote', out);
})().catch((e) => { console.error(e); process.exit(1); });
