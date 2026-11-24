'use strict';

/**
 * Interested follow-through (Arthur, 22 Nov 2026).
 *
 * 1. "Interested" on a new-agents call: the caller types the name the person wants
 *    shown and confirms the number. That opens (or links) a pending agent profile
 *    under that name, and the Outreach prospect row.
 * 2. They say "Hi" (on WhatsApp, or by SMS to the company phone when its forwarder
 *    sends texts to /api/money-sms/inbound): matched by number, greeted by that name,
 *    marked Said Hi on the call, and approved with 3 free days to load their places
 *    (the same free-period offer King's Approve gives).
 * 3. A follow-up call is due the next day at 09:00 Kampala. No answer brings it back
 *    every 2 days (callingRules.autoRetryAt) until Paid or a final no.
 *
 * Practice logins never open a profile for a real number. Phones are never logged in full.
 */
const crypto = require('crypto');
const db = require('../config/database');
const rules = require('./callingRules');
const logger = require('../config/logger');

const CHANNEL = 'calling_interested';
const FREE_DAYS = 3;

const tail9 = (v) => String(v || '').replace(/\D/g, '').slice(-9);
const clean = (v, n = 80) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function rows(sql, params = [], runner = db) {
  return (await runner.query(sql, params)).rows || [];
}

/** "Hi", "Hello Ronald", "Gyebale ko", "Good morning": a short hello, not a question about a house. */
function looksLikeHello(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 80) return false;
  return /^(hi+|hey+|hello+|helo|hallo|hy|hai|gyebale\w*|oli otya|good (morning|afternoon|evening|day)|greetings|yo)\b/i.test(t);
}

/** The name as they want it shown: letters, spaces, dots, apostrophes and hyphens; 2 to 60 characters. */
function cleanShownName(name) {
  const n = clean(name, 60).replace(/[^\p{L}\p{M}\s.'’-]/gu, '').replace(/\s+/g, ' ').trim();
  return n.length >= 2 ? n : '';
}

function kampalaDate(d = new Date()) { return new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 10); }
function addDays(day, n) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function agentByKey(key, runner = db) {
  return (await rows(
    `SELECT * FROM agents WHERE removed_at IS NULL
        AND (RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1 OR RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1)
      ORDER BY (status = 'approved') DESC, updated_at DESC LIMIT 1`, [key], runner))[0] || null;
}

async function callerName(personKey) {
  const r = (await rows(
    `SELECT first_name FROM users WHERE profile_data->>'person_key' = $1 ORDER BY created_at LIMIT 1`, [String(personKey || '')]).catch(() => []))[0];
  const n = clean(r && r.first_name, 40);
  if (n) return n;
  const k = String(personKey || '').trim();
  return k ? k[0].toUpperCase() + k.slice(1) : 'the makaug team';
}

/**
 * Interested on a call: open or link the pending agent profile and the prospect row.
 * attempt = the wrapped call_attempts row. Returns { agent_id, created, status }.
 */
async function provisionInterested(attempt, { name, phone, caller = '' } = {}) {
  const shown = cleanShownName(name);
  const key = tail9(attempt && attempt.phone_key);
  if (!shown || key.length !== 9) return null;
  const dial = String(phone || attempt.phone || '').replace(/[^\d+]/g, '');
  const e164 = /^\+?256\d{9}$/.test(dial) ? `+${dial.replace(/^\+/, '')}` : `+256${key}`;
  const by = caller || await callerName(attempt.person_key);
  let agent = await agentByKey(key);
  let created = false;
  if (!agent) {
    agent = (await rows(
      `INSERT INTO agents (full_name, company_name, licence_number, registration_status, listing_limit, phone, whatsapp,
          districts_covered, specializations, privacy_consent_accepted, data_retention_notice_accepted, status,
          agent_application_channel, verification_reason, greeting_name, registered_by_name)
       VALUES ($1, $1, $2, 'not_registered', 2147483647, $3, $3, '{}'::text[], '{}'::text[], FALSE, FALSE, 'pending', $4, $5, $1, $6)
       RETURNING *`,
      [shown, `CALL-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`, e164, CHANNEL,
        `[CALLING_INTERESTED] Opened when ${by} logged Interested on a call. Approved by itself when they say Hi from this number (3 free days to load places). ID still to check.`, by]))[0];
    created = true;
  } else if (agent.status === 'pending' && !clean(agent.greeting_name)) {
    agent = (await rows(`UPDATE agents SET greeting_name = $2, registered_by_name = COALESCE(registered_by_name, $3), updated_at = NOW() WHERE id = $1 RETURNING *`, [agent.id, shown, by]))[0] || agent;
  }
  await db.query(
    `INSERT INTO agent_prospects (full_name, phone, phone_key, status, video_kind, called_by, called_at, agent_id, metadata)
     VALUES ($1, $2, $3, 'interested', 'agent', $4, NOW(), $5, $6::jsonb)
     ON CONFLICT (phone_key) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       status = CASE WHEN agent_prospects.status IN ('pitched', 'declined', 'archived') THEN 'interested' ELSE agent_prospects.status END,
       agent_id = COALESCE(agent_prospects.agent_id, EXCLUDED.agent_id),
       called_by = EXCLUDED.called_by, called_at = NOW(),
       metadata = COALESCE(agent_prospects.metadata, '{}'::jsonb) || EXCLUDED.metadata,
       updated_at = NOW()`,
    [shown, e164, key, attempt.person_key || null, agent.id, JSON.stringify({ interested_call_id: attempt.id, shown_name: shown, interested_at: new Date().toISOString() })]);
  await db.query(`UPDATE call_attempts SET full_name = $2 WHERE id = $1`, [attempt.id, shown]).catch(() => null);
  await db.query(`INSERT INTO audit_logs (actor_id, action, details) VALUES ($1, 'calling_interested_profile', $2::jsonb)`,
    [String(attempt.person_key || 'calling'), JSON.stringify({ agent_id: agent.id, attempt_id: attempt.id, created, phone_tail: key.slice(-3) })]).catch(() => null);
  return { agent_id: agent.id, created, status: agent.status, name: shown };
}

// The welcome pack follows a few seconds later (24 Nov 2026): their page, the
// agent terms, how to post, and the free days, so this says hello and no more.
function welcomeText(name, caller) {
  return [
    `Hi ${name}! 👋 Welcome to makaug.com. ${caller} told us you would say Hi.`,
    '',
    `Your agent account is ready, with ${FREE_DAYS} free days to load your places. Your welcome is on its way: your page, the agent terms and a one-minute video on how to post.`
  ].join('\n');
}

/**
 * Someone wrote to us. When it is a hello from a number logged Interested on a call
 * (a pending calling profile), approve them, mark Said Hi and set the next-day follow-up.
 * Returns { agent, name, message } or null.
 */
async function onHello({ phone = '', body = '', via = 'whatsapp', conversationControl = null, now = new Date() } = {}) {
  const key = tail9(phone);
  if (key.length !== 9 || !looksLikeHello(body)) return null;
  const control = conversationControl || {};
  if (['off', 'copilot'].includes(String(control.ai_mode || '').toLowerCase())) return null;
  const agent = (await rows(
    `SELECT * FROM agents WHERE removed_at IS NULL AND status = 'pending' AND agent_application_channel = $2
        AND (RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1 OR RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1)
      ORDER BY created_at DESC LIMIT 1`, [key, CHANNEL]))[0];
  if (!agent) return null;
  const call = (await rows(
    `SELECT id, person_key, callback_at, checklist FROM call_attempts
      WHERE phone_key = $1 AND status = 'done' AND outcome = ANY($2::text[]) ORDER BY COALESCE(wrapped_at, shown_at) DESC LIMIT 1`,
    [key, rules.INTERESTED_OUTCOMES]))[0] || null;
  const caller = await callerName(call && call.person_key);
  const until = addDays(kampalaDate(now), FREE_DAYS - 1);
  const approved = (await rows(
    `UPDATE agents SET status = 'approved', approved_at = COALESCE(approved_at, NOW()), approved_by_name = $2,
        fee_offer_mode = 'free_period', fee_offer_reason = $3, fee_offer_until = $4::date, fee_offer_by = 'calling', fee_offer_at = NOW(),
        paid_until = GREATEST(COALESCE(paid_until, $4::date), $4::date), contact_phone_verified_at = COALESCE(contact_phone_verified_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [agent.id, `Said Hi after a call with ${caller}`, `Said Hi (${via}) after an Interested call: ${FREE_DAYS} free days to load places`, until]))[0];
  if (!approved) return null;
  if (call) {
    const followUp = rules.kampalaNineAm(now, 1);
    await db.query(
      `UPDATE call_attempts
          SET checklist = COALESCE(checklist, '{}'::jsonb) || jsonb_build_object('asked_hello', 'auto', 'said_hi_at', $2::text, 'said_hi_via', $3::text),
              callback_at = CASE WHEN callback_at IS NULL OR callback_at > $4::timestamptz THEN $4::timestamptz ELSE callback_at END,
              next_step = CASE WHEN callback_at IS NULL OR callback_at > $4::timestamptz THEN 'Said Hi: help them load their first property' ELSE next_step END
        WHERE id = $1`, [call.id, now.toISOString(), via, followUp]);
  }
  await db.query(
    `UPDATE agent_prospects SET status = CASE WHEN status IN ('pitched', 'interested') THEN 'approved' ELSE status END, agent_id = COALESCE(agent_id, $2),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('said_hi_at', $3::text, 'said_hi_via', $4::text), updated_at = NOW()
      WHERE phone_key = $1`, [key, approved.id, now.toISOString(), via]).catch(() => null);
  await db.query(`INSERT INTO audit_logs (actor_id, action, details) VALUES ('calling', 'calling_said_hi_approved', $1::jsonb)`,
    [JSON.stringify({ agent_id: approved.id, via, attempt_id: call ? call.id : null, free_until: until, phone_tail: key.slice(-3) })]).catch(() => null);
  const name = clean(require('./agentNameService').agentGreetingName(approved, ''), 60) || 'there';
  logger.info('Calling: said Hi, agent approved', { agent_id: approved.id, via });
  return { agent: approved, name, free_until: until, message: welcomeText(name, caller) };
}

module.exports = { CHANNEL, FREE_DAYS, looksLikeHello, cleanShownName, provisionInterested, onHello, welcomeText };
