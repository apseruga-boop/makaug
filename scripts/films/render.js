#!/usr/bin/env node
/*
 * Renders a makaug film to a 720x1280, 30fps MP4 for WhatsApp.
 *
 *   node scripts/films/render.js agent-intro                 the whole film
 *   node scripts/films/render.js agent-intro --stills 3,12.5 pictures of those seconds (look before rendering)
 *   node scripts/films/render.js agent-intro --scene 4       that scene again, then the film is re-joined
 *   node scripts/films/render.js agent-intro --music         with the music bed (music.py)
 *
 * One encoded file per scene, joined without re-encoding. The films go out
 * silent (Arthur, 14 Nov 2026), with an empty sound track so every phone
 * treats them as a video. The films are listed in FILMS below.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const FILMS = {
  'agent-intro': { out: 'makaug-agent-intro-v5.mp4', key: 0, seed: 7 },
  'owner-intro': { out: 'makaug-owner-intro-v1.mp4', key: 5, seed: 11 },
  'agent-howto': { out: 'makaug-agent-how-to-post-v3.mp4', key: 2, seed: 13 },
  'owner-howto': { out: 'makaug-owner-how-to-list-v4.mp4', key: -3, seed: 17 }
};
const FPS = 30;
const ROOT = path.join(__dirname, '..', '..');

function browserType() {
  try { return require('playwright').chromium; } catch (error) { return require('playwright-core').chromium; }
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${String(result.stderr).slice(-600)}`);
  return String(result.stdout);
}

/** Writes one scene to a file: frames go to ffmpeg as they are photographed. */
async function renderScene(page, scene, file) {
  const tmp = file.replace(/\.mp4$/, '.part.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=in_range=full:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', process.env.FILM_CRF || '23', '-g', '240', '-bf', '2',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-r', String(FPS), '-an', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))); ff.on('error', reject); });
  const frames = Math.round(scene.dur * FPS);
  const first = Math.round(scene.start * FPS);
  for (let f = 0; f < frames; f += 1) {
    await page.evaluate((t) => window.renderAt(t), (first + f) / FPS);
    const shot = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(shot)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
  }
  ff.stdin.end();
  await done;
  fs.renameSync(tmp, file);
}

(async () => {
  const args = process.argv.slice(2);
  const name = args.find((a) => FILMS[a]);
  if (!name) { console.error(`Which film? ${Object.keys(FILMS).join(' | ')}`); process.exit(1); }
  const film = FILMS[name];
  const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  // --lang lg | sw: the on-screen words from lang/<lang>.js; the file name ends -lg or -sw.
  const lang = ['lg', 'sw'].includes(flag('--lang')) ? flag('--lang') : '';
  const build = path.join(__dirname, '.build', lang ? `${name}-${lang}` : name);
  fs.mkdirSync(build, { recursive: true });

  const browser = await browserType().launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => { console.error('page error:', error.message); process.exitCode = 1; });
  await page.goto(`file://${path.join(__dirname, 'film.html')}?film=${name}${lang ? `&lang=${lang}` : ''}`);
  await page.evaluate(() => window.READY);
  const scenes = await page.evaluate(() => window.SCENES);
  const duration = await page.evaluate(() => window.DURATION);

  if (args.includes('--texts')) {
    // The English on-screen words, in order, for a translator.
    console.log(JSON.stringify(await page.evaluate(() => window.TEXTS), null, 1));
    await browser.close();
    return;
  }
  if (args.includes('--stills')) {
    const dir = flag('--to') || path.join(build, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of String(flag('--stills')).split(',').map(Number)) {
      await page.evaluate((x) => window.renderAt(x), t);
      await page.screenshot({ path: path.join(dir, `${name}${lang ? `-${lang}` : ''}-${t.toFixed(2).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 90 });
    }
    await browser.close();
    console.log(`stills in ${dir} (film is ${duration.toFixed(1)}s, ${scenes.length} scenes: ${scenes.map((s, i) => `${i + 1}@${s.start.toFixed(1)}`).join(' ')})`);
    return;
  }

  const only = flag('--scene') ? Number(flag('--scene')) - 1 : null;
  const started = Date.now();
  for (let i = 0; i < scenes.length; i += 1) {
    const file = path.join(build, `scene-${String(i + 1).padStart(2, '0')}.mp4`);
    if (only !== null && only !== i && fs.existsSync(file)) continue;
    await renderScene(page, scenes[i], file);
    process.stderr.write(`scene ${i + 1}/${scenes.length} (${scenes[i].dur}s)\n`);
  }
  await browser.close();

  const list = path.join(build, 'scenes.txt');
  fs.writeFileSync(list, scenes.map((_, i) => `file 'scene-${String(i + 1).padStart(2, '0')}.mp4'`).join('\n'));
  const picture = path.join(build, 'picture.mp4');
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', picture.replace(/\.mp4$/, '.part.mp4')]);
  fs.renameSync(picture.replace(/\.mp4$/, '.part.mp4'), picture);

  const out = flag('--out') || path.join(ROOT, 'assets', 'marketing', lang ? film.out.replace(/\.mp4$/, `-${lang}.mp4`) : film.out);
  const part = out.replace(/\.mp4$/, '.part.mp4');
  if (!args.includes('--music')) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', picture, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '32k', '-shortest', '-movflags', '+faststart', part]);
  } else {
    const bed = path.join(os.tmpdir(), `makaug-bed-${name}-${process.pid}.wav`);
    run('python3', [path.join(__dirname, 'music.py'), '--seconds', String(duration), '--out', bed, '--key', String(film.key), '--seed', String(film.seed)]);
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', picture, '-i', bed, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '72k', '-shortest', '-movflags', '+faststart', part]);
    fs.unlinkSync(bed);
  }
  fs.renameSync(part, out);
  const size = fs.statSync(out).size;
  console.log(`${out}: ${duration.toFixed(1)}s, ${(size / 1048576).toFixed(2)} MB, rendered in ${Math.round((Date.now() - started) / 1000)}s`);
})().catch((error) => { console.error(error); process.exit(1); });
