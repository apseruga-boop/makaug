'use strict';

/**
 * Calling screen: SMS from the company SIM, and the agent-video unlock.
 *
 * SMS: the screen opens an sms: link (Phone Link / the phone sends it from the
 * company SIM). We only log that it was opened as "SMS sent".
 *
 * Agent video: locked for a number until that number has messaged our
 * WhatsApp (an inbound row in whatsapp_messages). Then the caller can request
 * a send; King approves; only then makaug's WhatsApp sends a ref-tagged link
 * (/v/<ref>) through the existing sender. If the sender isn't available the
 * request stays "approved" with a copy / wa.me fallback. Nothing is ever sent
 * to a number that hasn't messaged us first.
 */

const crypto = require('crypto');
const db = require('../config/database');
const calling = require('./callingScreen');

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
    return `Gyebale ko! Nze ${who} okuva ku makaug.com, omukutu ogukuŋŋaanya amayumba, ettaka n'ebisulo byonna mu Uganda. WhatsApp yaffe: 0780 863 394. Tuwandiikire "Hi" ku WhatsApp ofune vidiyo n'ebisingawo.`;
  }
  return `Hello! This is ${who} from makaug.com, the site that brings every house, plot and rental in Uganda into one search. Our WhatsApp: 0780 863 394. WhatsApp us "Hi" to get the video and details.`;
}

async function attemptOf(attemptId) {
  const a = (await rows('SELECT id, phone, phone_key, person_key, full_name FROM call_attempts WHERE id::text = $1', [String(attemptId)]))[0];
  if (!a) throw httpError(404, 'Call not found.');
  return a;
}

async function logSms(attemptId, { personKey = '', lang = 'en' } = {}) {
  const a = await attemptOf(attemptId);
  await db.query('INSERT INTO call_sms_log (phone_key, attempt_id, person_key, lang) VALUES ($1, $2, $3, $4)', [a.phone_key, a.id, cleanKey(personKey) || a.person_key, lang === 'lg' ? 'lg' : 'en']);
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
    rows('SELECT at, person_key, lang FROM call_sms_log WHERE phone_key = $1 ORDER BY at DESC LIMIT 5', [a.phone_key])
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
  if (!VIDEOS[videoKey]) throw httpError(400, 'Pick a video.');
  const hello = await helloOf(a.phone_key);
  if (!hello) throw httpError(409, 'Locked: they have not messaged our WhatsApp yet. Ask them to send "Hi" to 0780 863 394 first.');
  const ref = `av${crypto.randomBytes(4).toString('hex')}`;
  const r = (await rows(
    `INSERT INTO call_video_requests (phone_key, phone, full_name, attempt_id, person_key, video_key, ref_code, hello_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (phone_key) WHERE status IN ('requested', 'approved') DO NOTHING RETURNING id, status`,
    [a.phone_key, a.phone, a.full_name, a.id, cleanKey(personKey) || a.person_key, videoKey, ref, hello.at]))[0];
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
    fallback: r.status === 'approved' ? { text: videoMessage(r), wa_url: `https://wa.me/${String(r.phone).replace(/\D+/g, '')}?text=${encodeURIComponent(videoMessage(r))}` } : null
  }));
}

/** King only. Approve → send through makaug's existing WhatsApp sender; otherwise stays approved with a fallback. */
async function decideVideo(id, { approve = false, actor = '', note = '' } = {}) {
  const r = (await rows('SELECT * FROM call_video_requests WHERE id::text = $1', [String(id)]))[0];
  if (!r) throw httpError(404, 'Request not found.');
  if (r.status !== 'requested' && !(approve && r.status === 'approved')) throw httpError(409, `Already ${r.status}.`);
  if (!approve) {
    await db.query("UPDATE call_video_requests SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_note = $3 WHERE id = $1", [r.id, String(actor).slice(0, 80), String(note).slice(0, 200)]);
    return { status: 'rejected' };
  }
  if (!(await helloOf(r.phone_key))) throw httpError(409, 'They have not messaged our WhatsApp. Nothing sent.');
  let delivery = 'not_sent'; let reason = null;
  try {
    const out = await require('./leadHandoffService').deliverWhatsapp({ to: r.phone, body: videoMessage(r), kind: 'calling_agent_video', leadId: null, nonce: r.ref_code });
    delivery = out.status || 'unknown'; reason = out.reason || null;
  } catch (e) { reason = e.message; }
  const sent = /^(sent|queued|delivered|ok)$/i.test(delivery);
  await db.query(
    `UPDATE call_video_requests SET status = $2, decided_by = COALESCE(decided_by, $3), decided_at = COALESCE(decided_at, NOW()), decision_note = $4,
        sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END, sent_via = CASE WHEN $2 = 'sent' THEN 'makaug_whatsapp' ELSE sent_via END, send_reason = $5 WHERE id = $1`,
    [r.id, sent ? 'sent' : 'approved', String(actor).slice(0, 80), String(note).slice(0, 200), sent ? null : String(reason || 'Not sent automatically').slice(0, 200)]);
  return { status: sent ? 'sent' : 'approved', sent, reason: sent ? null : (reason || 'Not sent automatically'), fallback: sent ? null : { text: videoMessage(r), wa_url: `https://wa.me/${String(r.phone).replace(/\D+/g, '')}?text=${encodeURIComponent(videoMessage(r))}` } };
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
