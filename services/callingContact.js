'use strict';

/**
 * Calling screen: SMS from the company SIM, and the agent-video unlock.
 *
 * SMS: the screen opens an sms: link (Phone Link / the phone sends it from the
 * company SIM). We only log that it was opened as "SMS sent".
 *
 * Agent video: the caller asks, King approves, then the ref-tagged link
 * (/v/<ref>) goes out as a text (SMS) from the phone. Since 22 Nov 2026 the
 * calling flow never sends anything on WhatsApp.
 */

const crypto = require('crypto');
const db = require('../config/database');
const calling = require('./callingScreen');
const scripts = require('./callingScripts');

const { httpError, cleanKey } = calling;
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const safeRows = (sql, params = []) => rows(sql, params).catch(() => []);
const SITE = String(process.env.PUBLIC_SITE_URL || 'https://makaug.com').replace(/\/+$/, '');
const mask = (k = '') => `•••${String(k).slice(-3)}`;

const VIDEOS = Object.freeze({
  join_agent: { title: 'Join as an agent (English)', path: '/assets/marketing/makaug-join-as-agent-v4.mp4' },
  agent_intro_en: { title: 'Agent intro (English)', path: '/assets/marketing/makaug-agent-intro-v5.mp4' },
  agent_intro_lg: { title: 'Agent intro (Luganda)', path: '/assets/marketing/makaug-agent-intro-v5-lg.mp4' }
});

function smsText(lang = 'en', callerName = '') {
  const w = String(callerName || '').trim().split(/\s+/)[0];
  const who = w ? w.charAt(0).toUpperCase() + w.slice(1) : 'the makaug team';
  if (lang === 'lg') {
    return `Gyebale ko! Nze ${who} okuva ku makaug.com, omukutu ogukuŋŋaanya amayumba, ettaka n'ebisulo byonna mu Uganda. WhatsApp yaffe: 0780 863 394. Tuwandiikire "Hi" ku WhatsApp tukuddemu.`;
  }
  return `Hello! This is ${who} from makaug.com, the site that brings every house, plot and rental in Uganda into one search. Our WhatsApp: 0780 863 394. Say "Hi" on WhatsApp and our team will answer you there.`;
}

async function attemptOf(attemptId) {
  const a = (await rows('SELECT id, phone, phone_key, person_key, full_name FROM call_attempts WHERE id::text = $1', [String(attemptId)]))[0];
  if (!a) throw httpError(404, 'Call not found.');
  return a;
}

/** Log a text the caller opened in the texting app (sms: link). `template` is one of the Texts tab keys. */
async function logSms(attemptId, { personKey = '', lang = 'en', template = '' } = {}) {
  const a = await attemptOf(attemptId);
  const tpl = scripts.SMS_TEXT_KEYS.has(String(template || '')) ? String(template) : null;
  await db.query('INSERT INTO call_sms_log (phone_key, attempt_id, person_key, lang, template) VALUES ($1, $2, $3, $4, $5)', [a.phone_key, a.id, cleanKey(personKey) || a.person_key, lang === 'lg' ? 'lg' : 'en', tpl]);
  return { ok: true, sms_count: Number((await rows('SELECT COUNT(*)::int AS n FROM call_sms_log WHERE phone_key = $1', [a.phone_key]))[0].n) };
}

/** Has this number messaged our WhatsApp? (the feed's inbound rows) */
async function helloOf(phoneKey) {
  const r = (await safeRows(
    `SELECT MIN(created_at) AS first, COUNT(*)::int AS n FROM whatsapp_messages
      WHERE direction = 'inbound' AND RIGHT(regexp_replace(user_phone, '\\D', '', 'g'), 9) = $1`, [phoneKey]))[0];
  return r && r.n ? { at: r.first, messages: r.n } : null;
}

async function videoState(attemptId) {
  const a = await attemptOf(attemptId);
  const [hello, reqs, sms] = await Promise.all([
    helloOf(a.phone_key),
    rows('SELECT id, status, video_key, person_key, requested_at, decided_by, decided_at, sent_at, sent_via, send_reason, opens FROM call_video_requests WHERE phone_key = $1 ORDER BY requested_at DESC LIMIT 5', [a.phone_key]),
    rows('SELECT at, person_key, lang, template FROM call_sms_log WHERE phone_key = $1 ORDER BY at DESC LIMIT 5', [a.phone_key])
  ]);
  const open = reqs.find((r) => ['requested', 'approved'].includes(r.status)) || null;
  return {
    hello, locked: !hello, open, last: reqs[0] || null, sent: reqs.filter((r) => r.status === 'sent').length,
    sms: sms.map((s) => ({ at: s.at, by: s.person_key, lang: s.lang })),
    videos: Object.entries(VIDEOS).map(([key, v]) => ({ key, title: v.title })),
    sms_text: { en: smsText('en', a.person_key), lg: smsText('lg', a.person_key) }
  };
}

async function requestVideo(attemptId, { personKey = '', videoKey = 'join_agent' } = {}) {
  const a = await attemptOf(attemptId);
  const sbx = require('./callingSandbox');
  if (sbx.isTestKey(a.phone_key) || await sbx.isSandbox(a.person_key)) throw httpError(409, `${sbx.PRACTICE_MSG} asks King to approve the agent video text.`);
  if (!VIDEOS[videoKey]) throw httpError(400, 'Pick a video.');
  const hello = await helloOf(a.phone_key).catch(() => null);
  const ref = `av${crypto.randomBytes(4).toString('hex')}`;
  const r = (await rows(
    `INSERT INTO call_video_requests (phone_key, phone, full_name, attempt_id, person_key, video_key, ref_code, hello_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (phone_key) WHERE status IN ('requested', 'approved') DO NOTHING RETURNING id, status`,
    [a.phone_key, a.phone, a.full_name, a.id, cleanKey(personKey) || a.person_key, videoKey, ref, hello ? hello.at : null]))[0];
  if (!r) throw httpError(409, 'A video request for this number is already waiting.');
  return { id: r.id, status: r.status };
}

function videoLink(ref) { return `${SITE}/v/${ref}`; }
function videoMessage(req) {
  const first = String(req.full_name || '').trim().split(/\s+/)[0];
  return `Hello${first ? ` ${first}` : ''}, thank you for messaging makaug.com. Here is the short video on how agents get buyers and tenants on makaug: ${videoLink(req.ref_code)}\nAgents: UGX 50,000 a month. Pay by MoMo merchant code 27248497. Reply here with any question.`;
}

async function listVideoRequests({ status = '' } = {}) {
  const list = await rows(`SELECT * FROM call_video_requests ${status ? 'WHERE status = $1' : ''} ORDER BY requested_at DESC LIMIT 100`, status ? [status] : []);
  return list.map((r) => ({
    id: r.id, phone: mask(r.phone_key), name: r.full_name || '', by: r.person_key, video: (VIDEOS[r.video_key] || {}).title || r.video_key, status: r.status,
    hello_at: r.hello_at, requested_at: r.requested_at, decided_by: r.decided_by, decided_at: r.decided_at, sent_at: r.sent_at, sent_via: r.sent_via, send_reason: r.send_reason,
    opens: r.opens, ref: r.ref_code, link: videoLink(r.ref_code),
    fallback: r.status === 'approved' ? smsFallback(r) : null
  }));
}

/** Calls send texts only (Arthur, 22 Nov 2026): the film link goes out as an SMS from the phone, never WhatsApp. */
function smsFallback(r) {
  const text = videoMessage(r);
  return { text, sms_url: `sms:${String(r.phone || '').replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}` };
}

/** King only. Approve → the caller texts the film link (SMS). Nothing is sent on WhatsApp from the calling flow. */
async function decideVideo(id, { approve = false, actor = '', note = '' } = {}) {
  const r = (await rows('SELECT * FROM call_video_requests WHERE id::text = $1', [String(id)]))[0];
  if (!r) throw httpError(404, 'Request not found.');
  if (r.status !== 'requested' && !(approve && r.status === 'approved')) throw httpError(409, `Already ${r.status}.`);
  if (approve && require('./callingSandbox').isTestKey(r.phone_key)) throw httpError(409, 'TEST practice number: never sent.');
  if (!approve) {
    await db.query("UPDATE call_video_requests SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_note = $3 WHERE id = $1", [r.id, String(actor).slice(0, 80), String(note).slice(0, 200)]);
    return { status: 'rejected' };
  }
  await db.query(
    `UPDATE call_video_requests SET status = 'approved', decided_by = COALESCE(decided_by, $2), decided_at = COALESCE(decided_at, NOW()), decision_note = $3, send_reason = 'Text it (SMS)' WHERE id = $1`,
    [r.id, String(actor).slice(0, 80), String(note).slice(0, 200)]);
  return { status: 'approved', sent: false, reason: 'Text it from the phone (SMS).', fallback: smsFallback(r) };
}

/** King: sent it by hand from the company WhatsApp (fallback). */
async function markVideoSentByHand(id, { actor = '' } = {}) {
  const r = (await rows("UPDATE call_video_requests SET status = 'sent', sent_at = NOW(), sent_via = 'by_hand', decision_note = COALESCE(decision_note, '') || $2 WHERE id::text = $1 AND status = 'approved' RETURNING id", [String(id), ` · sent by hand (${String(actor).slice(0, 60)})`]))[0];
  if (!r) throw httpError(409, 'Only an approved request can be marked sent.');
  return { status: 'sent' };
}

/** Public /v/:ref → count the open, go to the film with the ref on it. */
async function openRef(ref = '') {
  if (!/^av[0-9a-f]{8}$/.test(String(ref))) return null;
  const r = (await safeRows("UPDATE call_video_requests SET opens = opens + 1, first_opened_at = COALESCE(first_opened_at, NOW()) WHERE ref_code = $1 RETURNING video_key", [ref]))[0];
  if (!r) return null;
  return `${(VIDEOS[r.video_key] || VIDEOS.join_agent).path}?ref=agent_video_${ref}`;
}

module.exports = { VIDEOS, smsText, logSms, helloOf, videoState, requestVideo, listVideoRequests, decideVideo, markVideoSentByHand, openRef, videoMessage };

// ------------------------------------------------------------ live site --

/** Today on makaug (Kampala day): counts + latest events, all masked. */
async function liveSite({ now = new Date() } = {}) {
  const day = calling.kampalaDay(now);
  const start = `${day}T00:00:00+03:00`;
  const one = async (sql) => Number(((await safeRows(sql, [start]))[0] || {}).n || 0);
  const [visitors, leads, signups, submitted, approved, paid] = await Promise.all([
    one('SELECT COUNT(DISTINCT client_id)::int AS n FROM analytics_events WHERE created_at >= $1'),
    one('SELECT COUNT(*)::int AS n FROM leads WHERE created_at >= $1 AND deleted_at IS NULL AND COALESCE(is_test, false) = false'),
    one('SELECT COUNT(*)::int AS n FROM agents WHERE created_at >= $1'),
    one('SELECT COUNT(*)::int AS n FROM properties WHERE created_at >= $1 AND agent_id IS NOT NULL'),
    one('SELECT COUNT(*)::int AS n FROM properties WHERE approved_at >= $1 AND agent_id IS NOT NULL'),
    one("SELECT COUNT(DISTINCT agent_id)::int AS n FROM revenue_entries WHERE paid_at >= $1 AND agent_id IS NOT NULL AND voided_at IS NULL AND COALESCE(direction, 'in') = 'in'")
  ]);
  const first = (s) => String(s || '').trim().split(/\s+/)[0] || '';
  const ev = [];
  for (const a of await safeRows('SELECT full_name, created_at FROM agents WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 8', [start])) ev.push({ kind: 'signup', at: a.created_at, text: `New agent sign-up: ${first(a.full_name) || 'agent'}` });
  for (const l of await safeRows('SELECT category, location, lead_type, listing_id, created_at FROM leads WHERE created_at >= $1 AND deleted_at IS NULL AND COALESCE(is_test, false) = false ORDER BY created_at DESC LIMIT 8', [start])) ev.push({ kind: 'lead', at: l.created_at, text: `New enquiry${l.category ? `: ${l.category}` : ''}${l.location ? ` in ${l.location}` : ''}`, listing_id: l.listing_id || null });
  for (const p of await safeRows("SELECT id, title, area, district, created_at, approved_at, status FROM properties WHERE agent_id IS NOT NULL AND (created_at >= $1 OR approved_at >= $1) ORDER BY GREATEST(created_at, COALESCE(approved_at, created_at)) DESC LIMIT 8", [start])) {
    if (p.approved_at && new Date(p.approved_at) >= new Date(start)) ev.push({ kind: 'approved', at: p.approved_at, text: `Listing approved: ${p.title || 'property'}${p.area ? `, ${p.area}` : ''}`, listing_id: p.id });
    else ev.push({ kind: 'submitted', at: p.created_at, text: `Agent listing submitted: ${p.title || 'property'}${p.area ? `, ${p.area}` : ''}`, listing_id: null });
  }
  for (const r of await safeRows("SELECT r.amount_ugx, r.paid_at, a.full_name FROM revenue_entries r LEFT JOIN agents a ON a.id = r.agent_id WHERE r.paid_at >= $1 AND r.agent_id IS NOT NULL AND r.voided_at IS NULL ORDER BY r.paid_at DESC LIMIT 8", [start])) ev.push({ kind: 'paid', at: r.paid_at, text: `Agent paid: UGX ${Number(r.amount_ugx || 0).toLocaleString('en-GB')}${r.full_name ? ` · ${first(r.full_name)}` : ''}` });
  const latest = await safeRows(
    `SELECT p.id, p.title, p.area, p.district, p.price, p.price_period, p.price_on_application, p.bedrooms, p.listing_type, p.approved_at,
            (SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC NULLS LAST, i.sort_order NULLS LAST LIMIT 1) AS image
       FROM properties p WHERE p.status = 'approved' ORDER BY p.approved_at DESC NULLS LAST LIMIT 12`);
  return {
    day, at: new Date().toISOString(),
    counts: { visitors, leads, signups, listings_submitted: submitted, listings_approved: approved, agents_paid: paid },
    visitors_tracked: true,
    feed: ev.sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 15),
    listings: latest.map((p) => ({ id: p.id, title: p.title, area: [p.area, p.district].filter(Boolean).join(', '), price: p.price_on_application ? 'Price on application' : (p.price ? `UGX ${Number(p.price).toLocaleString('en-GB')}${p.price_period ? ` / ${p.price_period}` : ''}` : ''), bedrooms: p.bedrooms, type: p.listing_type, image: p.image, path: `/property/${p.id}` }))
  };
}
module.exports.liveSite = liveSite;
