#!/usr/bin/env node
/* eslint-disable no-console */
// Drives the real WhatsApp bridge inbound route the way approved agents
// actually message: hello, photos with no words, words with no photos, missing
// price, Luganda/Swahili, voice notes, location pins, two properties in a row.
// Prints every reply so a human can read the conversation.
//
//   BASE_URL=http://localhost:3999 BRIDGE_TOKEN=bridge-test DATABASE_URL=... node scripts/test-agent-whatsapp-intake-e2e.js
const { Pool } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// A distinct little JPEG per photo, so no two photos share a hash.
let photoNo = 0;
function photoDataUrl() {
  photoNo += 1;
  const file = path.join(os.tmpdir(), `e2e-agent-photo-${process.pid}-${photoNo}.jpg`);
  const c = ((Date.now() + photoNo * 7919) % 0xffffff).toString(16).padStart(6, '0');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${c}:s=800x600`, '-vf', `drawbox=x=${(photoNo * 37) % 500}:y=${(photoNo * 53) % 400}:w=180:h=140:color=white:t=fill`, '-frames:v', '1', file]);
  const url = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  fs.unlinkSync(file);
  return url;
}
let fixed = null;
function fixedPhoto() {
  if (!fixed) fixed = photoDataUrl();
  return fixed;
}
function fileDataUrl(file, mime) {
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}
const MEDIA_DIR = process.env.E2E_MEDIA_DIR || '/tmp/claude-0/e2eimg';

const BASE = process.env.BASE_URL || 'http://localhost:3999';
const TOKEN = process.env.BRIDGE_TOKEN || 'bridge-test';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const only = process.argv[2] || '';

let seq = 0;
const replies = [];
async function send(phone, { body = '', image = 0, video = false, voice = false, location = null, count = 0 } = {}) {
  seq += 1;
  const payload = { phone, body, message_id: `e2e-${Date.now()}-${seq}`, created_at: new Date().toISOString() };
  payload.metadata = {};
  if (image) { payload.media_type = 'image/jpeg'; payload.metadata.image_previews = [{ data_url: image === 'fixed' ? fixedPhoto() : photoDataUrl(), mime_type: 'image/jpeg', capture_source: 'whatsapp_media_viewer_original_pixels', width: 800, height: 600 }]; }
  if (video) { payload.media_type = 'video/mp4'; payload.metadata.media_previews = [{ data_url: fileDataUrl(path.join(MEDIA_DIR, 'clip.mp4'), 'video/mp4'), mime_type: 'video/mp4' }]; }
  if (voice) { payload.media_type = 'audio/ogg'; payload.metadata.voice_audio_data_url = fileDataUrl(path.join(MEDIA_DIR, 'voice.ogg'), 'audio/ogg'); }
  if (count) payload.media_count = count;
  if (location) payload.shared_location = location;
  const res = await fetch(`${BASE}/api/whatsapp/web-bridge/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-whatsapp-web-bridge-token': TOKEN },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  const reply = json?.data?.message || '';
  if (reply) replies.push(reply.trim());
  const what = [body && `"${body}"`, image && `[photo ${image}]`, video && '[video]', voice && '[voice note]', location && '[location pin]'].filter(Boolean).join(' ');
  console.log(`\n  AGENT ▸ ${what}`);
  console.log(reply ? `  BOT   ◂ ${reply.replace(/\n/g, '\n          ')}` : '  BOT   ◂ (no reply)');
  return { reply, step: json?.data?.next_step, json };
}

async function seedAgent(n, name) {
  const phone = `25677${String(9000000 + n).slice(-7)}`;
  await pool.query(`DELETE FROM whatsapp_sessions WHERE phone LIKE $1`, [`%${phone.slice(-9)}%`]).catch(() => {});
  const existing = await pool.query(`SELECT id FROM agents WHERE whatsapp = $1`, [phone]);
  if (!existing.rows[0]) {
    await pool.query(
      `INSERT INTO agents (full_name, phone, whatsapp, status, licence_number) VALUES ($1, $2, $2, 'approved', $3)`,
      [name, phone, `E2E-${n}`]
    );
  }
  return phone;
}

async function propertiesFor(phone) {
  const r = await pool.query(
    `SELECT p.id, p.status, p.listing_type, p.property_type, p.district, p.area, p.price, p.bedrooms, p.title,
            (SELECT COUNT(*) FROM property_images i WHERE i.property_id = p.id) AS images
       FROM properties p JOIN agents a ON a.id = p.agent_id
      WHERE a.whatsapp = $1 ORDER BY p.created_at`,
    [phone]
  ).catch((e) => ({ rows: [{ error: e.message }] }));
  return r.rows;
}

const SCENARIOS = {
  async hello(p) {
    await send(p, { body: 'Hello' });
    await send(p, { body: 'Good morning' });
    await send(p, { body: 'Oli otya' });
  },
  async photosOnlyThenDetails(p) {
    for (let i = 1; i <= 3; i += 1) await send(p, { image: i, count: 3 });
    await send(p, { body: '3 bedroom house for rent in Kira, Wakiso. 1.2m per month' });
  },
  async photosOnlyThenNothing(p) {
    await send(p, { image: 1 });
    await send(p, { image: 2 });
  },
  async captionComplete(p) {
    await send(p, { image: 1, body: '3 bedroom house for rent in Kira, Wakiso — UGX 1.2m a month' });
  },
  async missingPrice(p) {
    await send(p, { image: 2, body: '4 bedroom house for sale in Muyenga, Kampala' });
    await send(p, { body: '450m' });
  },
  async missingArea(p) {
    await send(p, { image: 3, body: 'Apartment for rent 800k' });
    await send(p, { body: 'Ntinda' });
  },
  async textOnlyNoPhotos(p) {
    await send(p, { body: 'Land for sale in Gayaza, Wakiso. 50x100 plot. 45 million' });
  },
  async luganda(p) {
    await send(p, { image: 1, body: 'Ennyumba ya kupangisa e Ntinda, ebisenge bisatu, 800k buli mwezi' });
  },
  async swahili(p) {
    await send(p, { image: 2, body: 'Nyumba ya kupangisha Ntinda, vyumba 3, shilingi laki nane kwa mwezi' });
  },
  async voiceNote(p) {
    await send(p, { voice: true });
  },
  async videoThenCaption(p) {
    await send(p, { video: true });
    await send(p, { body: 'Shop for rent in Kampala Road, Kampala Central. 2.5m monthly' });
  },
  async locationPin(p) {
    await send(p, { image: 4, body: '2 bedroom apartment for rent 1m per month' });
    await send(p, { location: { latitude: 0.3556, longitude: 32.6141, name: 'Ntinda' } });
  },
  async twoInARow(p) {
    await send(p, { image: 1, body: '3 bedroom house for rent in Kira, Wakiso 1.2m' });
    await send(p, { image: 2, body: '1 bedroom apartment for rent in Kololo, Kampala $900 per month' });
  },
  async albums(p) {
    // WhatsApp sends an album as one message per photo; the caption rides on the first.
    await send(p, { image: 1, body: '4 bedroom house for sale in Bukoto, Kampala 650m', count: 4 });
    await send(p, { image: 2, count: 4 });
    await send(p, { image: 3, count: 4 });
    await send(p, { image: 4, count: 4 });
    await send(p, { image: 5, body: 'Plot of land for sale in Matugga, Wakiso 50x100 at 35m', count: 2 });
    await send(p, { image: 6, count: 2 });
  },
  async sameFlyerTwoEstates(p) {
    // Jonathan, 2 Oct 08:39: two estates, the same flyer picture, the first caption short of rent/sale.
    await send(p, { image: 'fixed', body: '*KIWENDA-LUWUNGA ESTATE 100By50Fts @ 25M With Ready Landtitle*' });
    await send(p, { image: 'fixed', body: 'Namuseera estate plots 100by50 for sale in Kira, Wakiso @30m ready land title' });
    await send(p, { body: 'For Sale' });
  },
  async forwardedBurst(p) {
    // Arthur, 2 Oct 07:08: ten adverts forwarded at once; some photos have no caption.
    await Promise.all([
      send(p, { image: 1, body: 'BANK SALE Bweyogerere 4 bedrooms house on 13 decimals plot UGX 250 million' }),
      send(p, { image: 2, body: '34 decimals plot NAGURU UGX 1.6 billion for sale' }),
      send(p, { image: 3, body: 'Kyanja commercial on 20 decimals plot for sale 900m' })
    ]);
    await Promise.all([
      send(p, { image: 4, body: 'Mbalwa estate Kyaliwajjala road 4 bedroom house for sale 450m' }),
      send(p, { video: true, body: 'NAALYA 15 decimals plot for sale UGX 230 million' }),
      send(p, { image: 5 })
    ]);
  },
  async freeTextCorrection(p) {
    // Jonathan, 2 Oct 08:44: saw "50 bedroom land" and wrote a correction in words.
    await send(p, { image: 6, body: '*Land For Sale Nakawuka- Koba Estate 100by50fts @ UGX 28,000,000-30,000,000 With Ready Landtitle*' });
    await send(p, { body: 'Correction Over 50 Plots Of Land For Sale' });
  },
  async correctionAfterSave(p) {
    await send(p, { image: 5, body: '3 bedroom house for rent in Kyanja, Kampala 900k' });
    await send(p, { body: 'price 1.1m' });
    await send(p, { body: 'Sorry its in Kisaasi, Kampala' });
  },
  async outsideSession(p) {
    await send(p, { body: 'Help' });
    await send(p, { body: 'status' });
    await send(p, { voice: true });
  },
  async wordsAfterSave(p) {
    await send(p, { image: 3, body: 'Bungalow for sale Najjera Wakiso 380m' });
    await send(p, { body: 'Status' });
    await send(p, { body: 'Thanks' });
    await send(p, { body: 'Share' });
    await send(p, { body: 'Help' });
    await send(p, { body: 'How do I post?' });
  }
};

(async () => {
  let n = 0;
  for (const [name, run] of Object.entries(SCENARIOS)) {
    n += 1;
    if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
    const phone = await seedAgent(n, `E2E ${name} Agent`);
    console.log(`\n================ ${name} (${phone}) ================`);
    const started = new Date();
    replies.length = 0;
    await run(phone);
    // Summaries are sent after the burst goes quiet (10s in the test server).
    await new Promise((r) => setTimeout(r, Number(process.env.E2E_QUIET_WAIT_MS || 12500)));
    const later = await pool.query(
      `SELECT payload->>'text' AS text FROM outbound_message_queue
        WHERE user_phone = $1 AND created_at >= $2 ORDER BY created_at`,
      [phone, started]
    );
    for (const row of later.rows) {
      if (!replies.includes(String(row.text || '').trim())) console.log(`\n  BOT (later) ◂ ${String(row.text).replace(/\n/g, '\n                ')}`);
    }
    const props = await propertiesFor(phone);
    console.log(`  SAVED: ${props.length ? props.map((x) => JSON.stringify(x)).join('\n         ') : 'nothing'}`);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
