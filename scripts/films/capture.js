#!/usr/bin/env node
/*
 * Captures the assistant's replies for the films, word for word, into
 * transcript.js.
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/makaug_scratch node scripts/films/capture.js [lg|sw]
 *
 * With lg or sw the lister's chat is in Luganda or Swahili and the result goes
 * to transcript.lg.js or transcript.sw.js: the assistant answers in that
 * language wherever it has the words, and in English where it does not.
 *
 * It plays an agent posting a property and an owner listing one through the
 * real inbound route, the way the WhatsApp bridge would send them, and keeps
 * what comes back. It creates an agent, listings and sessions, so it only runs
 * against a scratch database on this machine with the migrations applied.
 * Nothing is sent to anybody: delivery is the bridge's queue, which is read
 * back and marked sent here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..', '..');
const DATABASE_URL = String(process.env.DATABASE_URL || '');
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL)) {
  console.error('capture.js writes test agents and listings. Point DATABASE_URL at a scratch database on this machine (127.0.0.1 or localhost) with the migrations applied. It will not run against anything else.');
  process.exit(1);
}
Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_SECRET || 'capture-only',
  NODE_ENV: 'test',
  COUNTRY_CODE: 'UG',
  WHATSAPP_DELIVERY_MODE: 'web_bridge',
  WHATSAPP_WEB_BRIDGE_TOKEN: 'capture-token',
  AGENT_FILM_REPLY_ALERT_DELAY_MS: '0',
  WHATSAPP_EMPLOYEE_MEDIA_FETCH_BACKOFF_MS: '1'
});
const PHOTO = fs.readFileSync(path.join(__dirname, 'assets', 'photo-buwaate.jpg'));
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url || '');
  if (u.startsWith('https://makaug-waha-bridge.onrender.com/media')) {
    const mime = Buffer.from(new URL(u).searchParams.get('m') || '', 'base64').toString() || 'image/jpeg';
    return new Response(PHOTO, { status: 200, headers: { 'content-type': mime } });
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)) return realFetch(url, init);
  throw new Error(`capture: no network for ${u.slice(0, 60)}`);
};
const express = require(path.join(repo, 'node_modules/express'));
const request = require(path.join(repo, 'node_modules/supertest'));
const db = require(path.join(repo, 'config/database'));
const media = require(path.join(repo, 'services/cloudMediaStorageService'));
media.uploadFileToS3 = async (opts = {}) => ({ publicUrl: `https://media.makaug.com/replay/${opts.key}`, internalRef: opts.key, key: opts.key });
media.uploadBufferToS3 = async (opts = {}) => ({ publicUrl: `https://media.makaug.com/replay/${opts.key}`, internalRef: opts.key, key: opts.key });
media.storeDataUrl = async (_dataUrl, opts = {}) => `https://media.makaug.com/replay/${opts.keyPrefix}/${opts.filename}`;
media.assertCloudMediaStorageConfigured = () => {};
const route = require(path.join(repo, 'routes/whatsapp'));
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/whatsapp', route);
const auth = { 'x-whatsapp-web-bridge-token': 'capture-token' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-5);
const bridge = (name, mime) => `https://makaug-waha-bridge.onrender.com/media?p=${name}&m=${Buffer.from(mime).toString('base64')}&s=1`;
const transcript = [];

async function clean(phone) {
  for (const sql of [
    'DELETE FROM outbound_message_queue WHERE user_phone = $1',
    'DELETE FROM whatsapp_messages WHERE user_phone = $1',
    'DELETE FROM whatsapp_sessions WHERE phone = $1'
  ]) await db.query(sql, [phone]).catch(() => null);
}

/** One inbound message; returns { reply, queued[], step }. */
async function say(phone, { body = '', media: kind = '', name = 'Tester', quiet = false } = {}) {
  const mime = kind === 'photo' ? 'image/jpeg' : '';
  const started = new Date();
  const res = await request(app).post('/api/whatsapp/web-bridge/inbound').set(auth).send({
    phone,
    body,
    message_id: `film-${RUN}-${Math.random().toString(16).slice(2, 10)}`,
    client_id: 'film-capture',
    ...(mime ? { media_url: bridge(`m${Math.random().toString(16).slice(2, 8)}`, mime), media_type: mime, media_count: 1 } : {}),
    contact_name: name,
    metadata: { source: 'waha_gows_inbound', push_name: name, mime: mime || null, has_caption: Boolean(body) }
  });
  await sleep(Number(process.env.SETTLE_MS || 450));
  const queued = (await db.query(
    `SELECT id, status, user_phone, payload->>'text' AS text, payload->>'media_url' AS media, payload->>'media_type' AS media_type, metadata->>'message_kind' AS kind
       FROM outbound_message_queue WHERE created_at >= $1 ORDER BY created_at`, [started])).rows;
  // The bridge delivers what is queued and reports back, which is what logs our
  // side of the chat (whatsapp_messages, direction 'outbound').
  for (const q of queued) {
    if (!['pending', 'retry'].includes(String(q.status))) continue;
    await request(app).post(`/api/whatsapp/web-bridge/outbox/${q.id}/sent`).set(auth).send({ client_id: 'film-capture', bridge_message_id: `sent-${q.id}`, media_sent: Boolean(q.media) });
  }
  const step = (await db.query('SELECT current_step FROM whatsapp_sessions WHERE phone = $1', [phone])).rows[0]?.current_step || '';
  const reply = String(res.body?.data?.message || '');
  const entry = { phone, in: body, media: kind, reply, queued, step, http: res.status };
  transcript.push(entry);
  if (!quiet) {
    console.log(`\n>> ${kind ? `[${kind}] ` : ''}${body}`);
    if (reply) console.log(`<< ${reply}`);
    for (const q of queued) {
      const to = q.user_phone === phone ? 'them' : `…${String(q.user_phone).slice(-3)}`;
      if (q.text !== reply || q.media) console.log(`   [queued → ${to}${q.media ? ` + ${q.media_type || 'media'} ${String(q.media).split('/').pop()}` : ''}${q.kind ? ` (${q.kind})` : ''}] ${String(q.text || '')}`);
    }
    console.log(`   (step: ${step})`);
  }
  return entry;
}


/** What the films print: the lister's side of it, with this run's own links and numbers taken out. */
function tidy(text) {
  let t = String(text || '');
  t = t.replace(/https:\/\/makaug\.com\/property\/[0-9a-f-]{36}/g, 'https://makaug.com/property/{id}');
  t = t.replace(/https:\/\/makaug\.com\/agents\/[0-9a-f-]{36}/g, 'https://makaug.com/agents/{agent}');
  t = t.replace(/https:\/\/makaug\.com\/pay\/[A-Z0-9]+/g, 'https://makaug.com/pay/{code}');
  t = t.replace(/https:\/\/wa\.me\/\?text=\S+/g, 'https://wa.me/?text=…');
  t = t.replace(/https:\/\/makaug\.com\/api\/agents\/share-card\/\S+/g, 'https://makaug.com/api/agents/share-card/{agent}.png');
  t = t.replace(/MK-\d{8}-[0-9A-F]{6}/g, 'MK-{ref}');
  // The lister's own number, which the assistant reads back in bold in every language.
  // The team's help number is makaug's own and stays as it is.
  t = t.replace(/\*(\+256 \d{3} \d{3} \d{3})\*/g, (whole, number) => (number === '+256 709 402 189' ? whole : '*{number}*'));
  return t;
}

function transcriptFile(captured) {
  const kept = {};
  for (const [key, value] of Object.entries(captured)) {
    if (!value || typeof value !== 'object') continue;
    const item = {};
    if ('said' in value) item.said = value.said;
    if ('reply' in value) item.reply = tidy(value.reply);
    const also = (value.queued || []).filter((q) => q.to === 'them').map((q) => ({ text: tidy(q.text), media: /^\d+-[0-9a-f-]+/.test(q.media || '') ? 'photo' : (q.media || '') }));
    if (also.length) item.also = also;
    if (Object.keys(item).length) kept[key] = item;
  }
  return `/*
 * The makaug assistant's own words, captured on ${new Date().toISOString().slice(0, 10)} by sending these
 * messages through the real WhatsApp inbound route (routes/whatsapp.js) against
 * a scratch database: scripts/films/capture.js. The films print them as they
 * came back. {id}, {agent}, {code}, {ref} and {number} stand for the run's own
 * links, reference and phone number.
 */
window.T = ${JSON.stringify(kept, null, 1)};
`;
}

const out = {};
// The language the lister's WhatsApp session is in: en (the default), lg or sw.
const LANG = ['lg', 'sw'].includes(process.argv[2]) ? process.argv[2] : 'en';
/** A fresh chat for this number, in the film's language. */
async function freshChat(number) {
  await clean(number);
  if (LANG !== 'en') {
    await db.query(
      `INSERT INTO whatsapp_sessions (phone, current_step, language, listing_draft, session_data) VALUES ($1, 'greeting', $2, '{}', '{}')`,
      [number, LANG]);
  }
}
const keep = (key, entry) => { out[key] = { said: entry.in, media: entry.media || '', reply: entry.reply, queued: (entry.queued || []).filter((q) => q.text && q.text !== entry.reply || q.media).map((q) => ({ to: q.user_phone === entry.phone ? 'them' : 'team', text: q.text, media: q.media ? String(q.media).split('/').pop() : '', kind: q.kind || '' })), step: entry.step }; return entry; };
(async () => {
  // ---------- the agent ----------
  const phone = `25677${RUN}71`.slice(0, 12);
  await freshChat(phone);
  await db.query(`DELETE FROM agents WHERE RIGHT(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 9) = $1`, [phone.slice(-9)]).catch(() => null);
  const agent = (await db.query(
    `INSERT INTO agents (full_name, greeting_name, company_name, licence_number, status, phone, whatsapp, approved_at, makaug_agent_number, profile_photo_url)
     VALUES ('Kimuli Brian', 'Brian', '', $1, 'approved', $2, $2, NOW(), $3, 'https://media.makaug.com/x.jpg') RETURNING *`,
    [`FILM-${RUN}-71`, `+${phone}`, `MKA-AG-${RUN}71`])).rows[0];
  const name = 'Kimuli Brian';
  keep('agent_hello', await say(phone, { body: 'Hello', name, quiet: true }));
  keep('agent_post', await say(phone, { media: 'photo', body: 'Buwaate 3 bedroom bungalow for sale\nSize 13 decimals - Price 290M\nNeeds some renovations', name, quiet: true }));
  keep('agent_photo2', await say(phone, { media: 'photo', name, quiet: true }));
  keep('agent_photo3', await say(phone, { media: 'photo', name, quiet: true }));
  await sleep(2600);
  keep('agent_status_pending', await say(phone, { body: 'STATUS', name, quiet: true }));
  const property = (await db.query(`SELECT * FROM properties WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`, [agent.id])).rows[0];
  out.agent_property = { title: property.title, price: property.price, area: property.area, district: property.district, beds: property.bedrooms, ref: property.inquiry_reference, description: property.description };
  // a correction on it, for the how-to film; the price is then put back
  keep('agent_fix_buwaate', await say(phone, { body: 'price 285m', name, quiet: true }));
  await db.query('UPDATE properties SET price = 290000000 WHERE id = $1', [property.id]);
  // a second one, to show a correction
  keep('agent_post2', await say(phone, { media: 'photo', body: '2 bedroom house for rent in Kira, Wakiso. UGX 900k per month', name, quiet: true }));
  await sleep(2600);
  keep('agent_fix', await say(phone, { body: 'price 850k', name, quiet: true }));
  await sleep(600);
  await db.query(`UPDATE properties SET status = 'approved', reviewed_at = NOW(), approved_at = NOW() WHERE id = $1`, [property.id]);
  const moderation = require(path.join(repo, 'services/listingModerationService'));
  const fresh = (await db.query(`SELECT * FROM properties WHERE id = $1`, [property.id])).rows[0];
  const live = await moderation.sendOwnerListingStatusNotifications({ listing: fresh, status: 'approved' });
  out.agent_live = { reply: live.whatsapp?.message || '' };
  const handoff = require(path.join(repo, 'services/leadHandoffService'));
  const build = handoff.buildListerMessage || (handoff.__test && handoff.__test.buildListerMessage);
  out.agent_enquiry = { reply: build ? build({ kind: 'enquiry', listing: fresh, seeker: { name: 'Grace', phone: '+44 7••• ••• 418' }, message: 'Is it still available? I am in London and my brother can view it on Saturday.' }) : '' };
  keep('agent_status_live', await say(phone, { body: 'STATUS', name, quiet: true }));
  keep('agent_share', await say(phone, { body: 'SHARE', name, quiet: true }));
  keep('agent_myphoto', await say(phone, { body: 'my photo', name, quiet: true }));
  keep('agent_myphoto_cancel', await say(phone, { body: 'cancel', name, quiet: true }));
  keep('agent_help', await say(phone, { body: 'HELP', name, quiet: true }));
  await sleep(500);
  keep('agent_sold', await say(phone, { body: 'The Buwaate bungalow is sold', name, quiet: true }));
  keep('agent_sold_yes', await say(phone, { body: '1', name, quiet: true }));

  // ---------- the owner ----------
  const owner = `25678${RUN}72`.slice(0, 12);
  await freshChat(owner);
  await db.query(`DELETE FROM properties WHERE RIGHT(regexp_replace(COALESCE(lister_phone,''), '\\D', '', 'g'), 9) = $1`, [owner.slice(-9)]).catch(() => null);
  const who = 'Sarah N';
  // From the menu, as an owner who writes to the number starts (16 Nov 2026):
  // "Hi", then 1, List my property. LIST is answered the same way.
  keep('owner_menu', await say(owner, { body: 'Hi', name: who, quiet: true }));
  keep('owner_list', await say(owner, { body: '1', name: who, quiet: true }));
  keep('owner_type', await say(owner, { body: '1', name: who, quiet: true }));
  keep('owner_ownership', await say(owner, { body: '1', name: who, quiet: true }));
  keep('owner_title', await say(owner, { body: '2 bedroom house in Seeta', name: who, quiet: true }));
  keep('owner_price', await say(owner, { body: '155m', name: who, quiet: true }));
  keep('owner_photo1', await say(owner, { media: 'photo', name: who, quiet: true }));
  keep('owner_photo2', await say(owner, { media: 'photo', name: who, quiet: true }));
  keep('owner_photo3', await say(owner, { media: 'photo', name: who, quiet: true }));
  keep('owner_done', await say(owner, { body: 'DONE', name: who, quiet: true }));
  keep('owner_name', await say(owner, { body: 'Sarah Nakato', name: who, quiet: true }));
  keep('owner_contact', await say(owner, { body: 'YES', name: who, quiet: true }));
  keep('owner_id_photo', await say(owner, { media: 'photo', name: who, quiet: true }));
  // A made-up number in the shape of a NIN; the transcript does not keep it.
  keep('owner_nin', await say(owner, { body: 'CM9001234567AB', name: who, quiet: true }));
  out.owner_nin.said = '(their NIN)';
  keep('owner_agree', await say(owner, { body: 'AGREE', name: who, quiet: true }));
  await sleep(1500);
  keep('owner_status_pending', await say(owner, { body: 'STATUS', name: who, quiet: true }));
  const op = (await db.query(`SELECT * FROM properties WHERE RIGHT(regexp_replace(COALESCE(lister_phone,''), '\\D', '', 'g'), 9) = $1 ORDER BY created_at DESC LIMIT 1`, [owner.slice(-9)])).rows[0];
  out.owner_property = op ? { title: op.title, price: op.price, area: op.area, district: op.district, ref: op.inquiry_reference, status: op.status } : null;
  if (op) {
    await db.query(`UPDATE properties SET status = 'approved', reviewed_at = NOW(), approved_at = NOW() WHERE id = $1`, [op.id]);
    const started = new Date();
    await moderation.sendOwnerListingStatusNotifications({ listing: { ...op, status: 'approved' }, status: 'approved' });
    await sleep(900);
    const sent = (await db.query(`SELECT user_phone, payload->>'text' AS text, payload->>'media_url' AS media FROM outbound_message_queue WHERE created_at >= $1 ORDER BY created_at`, [started])).rows;
    out.owner_live = { queued: sent.map((q) => ({ to: q.user_phone === owner ? 'them' : 'team', text: q.text, media: q.media ? String(q.media).split('/').pop() : '' })) };
    keep('owner_status_live', await say(owner, { body: 'STATUS', name: who, quiet: true }));
    keep('owner_help', await say(owner, { body: 'HELP', name: who, quiet: true }));
    keep('owner_remove', await say(owner, { body: 'REMOVE', name: who, quiet: true }));
    keep('owner_remove_no', await say(owner, { body: 'NO', name: who, quiet: true }));
    keep('owner_sold', await say(owner, { body: 'SOLD', name: who, quiet: true }));
    keep('owner_sold_yes', await say(owner, { body: '1', name: who, quiet: true }));
    keep('owner_status_sold', await say(owner, { body: 'STATUS', name: who, quiet: true }));
  }
  const file = LANG === 'en' ? 'transcript.js' : `transcript.${LANG}.js`;
  fs.writeFileSync(path.join(__dirname, file), transcriptFile(out));
  console.log(`${file}: ${Object.keys(out).length} entries`);
  await sleep(400);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
