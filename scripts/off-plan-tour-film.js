#!/usr/bin/env node
'use strict';

/**
 * Films the guided tour of one home from an off-plan project's 3D tour page
 * (assets/off-plan/<slug>/tour.html) and writes the film and its poster next
 * to that page, as tour-<home>.mp4 and tour-<home>-poster.jpg.
 *
 *   node scripts/off-plan-tour-film.js <slug> <home> <style> [clock]
 *   node scripts/off-plan-tour-film.js vanta-house 2bhk scandi 8.6
 *
 *   home    1bhk | 2bhk | 3bhk            style   modern | scandi | luxury
 *   clock   the hour the walk starts at (8.6 is 8:36 am). The day then runs
 *           on to evening while the camera circles above the home at the end.
 *
 * The page is opened with ?capture=1, which hides the buttons, and every frame
 * is asked for by its time (window.__vantaTour.film), so the film comes out the
 * same on any machine however fast it draws. The music is made by the page too.
 *
 * It needs Google Chrome and a real graphics card: about a fifth of a second a
 * frame on a laptop, many seconds a frame without one.
 *
 *   CHROME_PATH    Chrome, when it is not where Playwright looks for it
 *   FFMPEG         an ffmpeg to use instead of the one in node_modules
 *   CRF, MAXRATE   the size of the finished file (25 and 1100k)
 *   STILLS=stops   write sheets of stills (two per stop) to look at first,
 *                  instead of a film; STILLS=3,12.5,40 for chosen seconds
 *   ENCODE=1       make the finished file again from the kept master picture
 *                  (say with another CRF) without filming again
 *   LIMIT=5        film only the first 5 seconds (to try the set-up)
 *   TOUR_FILM_DIR  where the master picture, music and stills are kept
 *                  (a folder in the system's temporary directory otherwise)
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const [slug, home, style = 'modern', clockArg] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '') || !/^[a-z0-9]+$/.test(home || '') || !/^[a-z]+$/.test(style)) {
  console.error('usage: node scripts/off-plan-tour-film.js <slug> <home> <style> [clock]');
  process.exit(2);
}
const PROJECT_DIR = path.join(ROOT, 'assets', 'off-plan', slug);
const TOUR_PAGE = path.join(PROJECT_DIR, 'tour.html');
if (!fs.existsSync(TOUR_PAGE)) {
  console.error(`no tour page at ${path.relative(ROOT, TOUR_PAGE)}`);
  process.exit(2);
}

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = Number(process.env.SCALE || 2); // drawn at twice the size, then scaled down: clean edges on thin lines
const ORBIT_SECONDS = 6.5; // the slow turn above the home after the camera has risen
const CRF = process.env.CRF || '25';
const MAXRATE = process.env.MAXRATE || '1100k';
const WORK = path.join(process.env.TOUR_FILM_DIR || path.join(os.tmpdir(), 'makaug-tour-film'), slug);
fs.mkdirSync(WORK, { recursive: true });
const master = path.join(WORK, `master-${home}.mp4`);
const music = path.join(WORK, `music-${home}.wav`);
const film = path.join(PROJECT_DIR, `tour-${home}.mp4`);
const posterFile = path.join(PROJECT_DIR, `tour-${home}-poster.jpg`);

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    const bundled = require('ffmpeg-static');
    return bundled && fs.existsSync(bundled) ? bundled : 'ffmpeg'; // the bundled one is only there after a full install
  } catch (error) { return 'ffmpeg'; }
}
const FFMPEG = ffmpegPath();

/* Picture and music joined at the size people will download. Written under a
 * temporary name first: a stopped run can leave a short file that still plays. */
function encode() {
  const tmp = path.join(WORK, `final-${home}.mp4`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', master, '-i', music, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slower', '-crf', CRF, '-maxrate', MAXRATE, '-bufsize', `${parseInt(MAXRATE, 10) * 2}k`,
    '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', '90',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-shortest', '-movflags', '+faststart', tmp], { stdio: 'inherit' });
  fs.copyFileSync(tmp, film);
  fs.unlinkSync(tmp);
  console.log(`film: ${path.relative(ROOT, film)}  ${(fs.statSync(film).size / 1e6).toFixed(2)} MB (crf ${CRF}, at most ${MAXRATE})`);
}

/* The tour page and the files it loads, on a port of their own. The listing
 * is not served, so the page shows the facts written into it. */
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = null;
    if (url.pathname === `/off-plan/${slug}/tour`) file = TOUR_PAGE;
    else if (url.pathname.startsWith('/assets/')) {
      const wanted = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)));
      if (wanted.startsWith(path.join(ROOT, 'assets') + path.sep)) file = wanted;
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openBrowser(chromium) {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu', '--hide-scrollbars', '--mute-audio'];
  if (process.platform === 'darwin') args.push('--use-angle=metal');
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args });
  try { return await chromium.launch({ channel: 'chrome', headless: true, args }); } catch (error) { return chromium.launch({ headless: true, args }); }
}

async function main() {
  if (process.env.ENCODE === '1') { encode(); return; }
  const { chromium } = require('playwright-core');
  const server = await serve();
  const browser = await openBrowser(chromium);
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
    page.on('pageerror', (error) => console.log('[page error]', String(error.stack || error).slice(0, 500)));
    await page.goto(`http://127.0.0.1:${server.address().port}/off-plan/${slug}/tour?capture=1&home=${home}&style=${style}`);
    await page.waitForFunction(() => window.__vantaTour && window.__vantaTour.ready, null, { timeout: 180000 });
    const card = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    console.log(`graphics: ${card}`);
    if (/swiftshader|llvmpipe|software/i.test(card)) console.log('no graphics card is being used: this will be very slow');

    const startClock = Number(clockArg || 8.6);
    const from = await page.evaluate((clock) => window.VANTA_TOUR_SKY.timeOfClock(clock), startClock);
    await page.evaluate(([h, s, t]) => window.__vantaTour.set({ home: h, style: s, time: t }), [home, style, from]);
    const info = await page.evaluate(() => window.__vantaTour.info());
    if (info.home !== home || info.style !== style) throw new Error(`the page shows ${info.home} in ${info.style}, not ${home} in ${style}`);
    const total = info.total + info.rise + ORBIT_SECONDS;
    const options = { dusk: info.rise * 0.5 + ORBIT_SECONDS - 1.2, from, to: 0.93 };
    console.log(`${home}, ${style}: ${total.toFixed(1)} s, ${info.tris} triangles`);
    console.log('stops: ' + info.stopTimes.map((stop) => `${stop[2] || 'end'} ${stop[0].toFixed(1)}-${stop[1].toFixed(1)}`).join(', '));
    const frame = async (time) => {
      await page.evaluate(([t, o]) => window.__vantaTour.film(t, o), [time, options]);
      return page.screenshot({ type: 'jpeg', quality: 93 });
    };

    if (process.env.STILLS) {
      let times = process.env.STILLS.split(',').map(Number).filter((value) => Number.isFinite(value));
      if (process.env.STILLS === 'stops') {
        times = [];
        info.stopTimes.forEach((stop) => { times.push(stop[0] + 0.6, stop[1] - 0.5); });
        times.push(info.total + info.rise + 1, total - 0.5);
      }
      for (let index = 0; index < times.length; index += 1) fs.writeFileSync(path.join(WORK, `still-${home}-${String(index + 1).padStart(2, '0')}.jpg`), await frame(times[index]));
      for (let sheet = 0; sheet * 9 < times.length; sheet += 1) {
        execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-start_number', String(sheet * 9 + 1), '-i', path.join(WORK, `still-${home}-%02d.jpg`), '-frames:v', '1', '-vf', 'scale=660:-2,tile=3x3', '-q:v', '3', path.join(WORK, `sheet-${home}-${sheet}.jpg`)]);
      }
      console.log(`${times.length} stills and their sheets are in ${WORK}`);
      return;
    }

    // 1. The picture, kept at high quality so the finished file can be made again without filming again.
    const seconds = process.env.LIMIT ? Math.min(total, Number(process.env.LIMIT)) : total;
    const frames = Math.round(seconds * FPS);
    const tmpMaster = path.join(WORK, `filming-${home}.mp4`);
    const ffmpeg = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-r', String(FPS), tmpMaster], { stdio: ['pipe', 'inherit', 'inherit'] });
    const encoded = new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopped with ${code}`))));
    });
    const began = Date.now();
    for (let index = 0; index < frames; index += 1) {
      const shot = await frame(index / FPS);
      if (!ffmpeg.stdin.write(shot)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
      if (index % 150 === 0) console.log(`frame ${index} of ${frames} (${((Date.now() - began) / 1000).toFixed(0)} s)`);
    }
    ffmpeg.stdin.end();
    await encoded;
    fs.renameSync(tmpMaster, master);
    console.log(`filmed in ${((Date.now() - began) / 1000).toFixed(0)} s`);

    // 2. The music, made by the page itself, brought across in pieces.
    const bytes = await page.evaluate((length) => window.__vantaTour.music(length), seconds);
    const parts = [];
    for (let offset = 0; offset < bytes; offset += 3000000) parts.push(Buffer.from(await page.evaluate(([start, size]) => window.__vantaTour.musicSlice(start, size), [offset, 3000000]), 'base64'));
    fs.writeFileSync(music, Buffer.concat(parts));

    // 3. The poster: the living room, once the camera has settled there. A few passes, so the lamps settle to that hour.
    const living = info.stopTimes.find((stop) => stop[2] === 'living') || info.stopTimes[Math.min(2, info.stopTimes.length - 1)];
    const posterAt = Number(process.env.POSTER || 0) || living[0] + (living[1] - living[0]) * 0.55;
    let shot = null;
    for (let pass = 0; pass < 4; pass += 1) shot = await frame(posterAt);
    const big = path.join(WORK, `poster-${home}.jpg`);
    fs.writeFileSync(big, shot);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', big, '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`, '-q:v', '3', posterFile]);
    console.log(`poster: ${path.relative(ROOT, posterFile)} (the tour at ${posterAt.toFixed(1)} s)`);

    // 4. The finished file.
    encode();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
