#!/usr/bin/env node
'use strict';

/**
 * Lead pipeline end-to-end test.
 *
 * Runs against a live server and its database: seeds its own agent and
 * listings (clearly marked), drives every lead entry point over HTTP exactly
 * as the website and WhatsApp bot do, then checks the database for what
 * actually happened — the lead, the dedupe, the handoff, the WhatsApp
 * message queued to the lister, the admin and agent views. Cleans up after
 * itself.
 *
 *   BASE_URL=http://localhost:3999 DATABASE_URL=... ADMIN_API_KEY=... JWT_SECRET=... \
 *     node scripts/test-lead-pipeline-e2e.js
 *
 * Set LEAD_E2E_KEEP=1 to leave the fixtures in place for inspection.
 * Set LEAD_E2E_WHATSAPP_BOT=0 to skip the bot checks (needs a non-production server).
 */

require('dotenv').config();

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3999').replace(/\/+$/, '');
if (/(^|\.)makaug\.com$/i.test(new URL(BASE_URL).hostname) && process.env.LEAD_E2E_ALLOW_PRODUCTION !== '1') {
  console.error('Refusing to run against production makaug.com. Point BASE_URL at staging or a local server.');
  process.exit(2);
}
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const RUN = crypto.randomBytes(3).toString('hex').toUpperCase();
const MARK = `LEADE2E-${RUN}`;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 3
});

// Phone numbers unique to this run: 07 + 8 digits, run digits in the middle.
const runDigits = String(parseInt(RUN, 16) % 10000).padStart(4, '0');
const phone = (n) => `0791${runDigits}${String(n).padStart(2, '0')}`;
const intl = (local) => `256${local.slice(1)}`;

const results = [];
let currentGroup = '';
function group(name) { currentGroup = name; console.log(`\n▶ ${name}`); }
function check(name, condition, detail = '') {
  results.push({ group: currentGroup, name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? '✅' : '❌'} ${name}${!condition && detail ? `\n     ${detail}` : ''}`);
}

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function api(method, path, body, headers = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function leadFor(leadId) {
  return (await q('SELECT * FROM leads WHERE id = $1', [leadId]))[0] || null;
}

async function queuedTo(localPhone, sinceIso) {
  return q(
    `SELECT id, user_phone, payload, metadata, status FROM outbound_message_queue
      WHERE user_phone = $1 AND created_at >= $2 ORDER BY created_at`,
    [intl(localPhone), sinceIso]
  );
}

async function queuedToRaw(anyPhone, sinceIso) {
  const key = String(anyPhone).replace(/\D/g, '').slice(-9);
  return q(
    `SELECT id, user_phone, payload, metadata, status FROM outbound_message_queue
      WHERE RIGHT(user_phone, 9) = $1 AND created_at >= $2 ORDER BY created_at`,
    [key, sinceIso]
  );
}

async function notificationsFor(leadId) {
  return q('SELECT channel, type, status, recipient_phone, recipient_email FROM notifications WHERE related_lead_id = $1 ORDER BY created_at', [leadId]);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fx = {};

async function seed() {
  const agentUser = (await q(
    `INSERT INTO users (first_name, last_name, phone, email, password_hash, role, status)
     VALUES ('Test', $1, $2, $3, 'x', 'agent_broker', 'active') RETURNING id`,
    [`Agent ${MARK}`, phone(1), `agent-${RUN.toLowerCase()}@leade2e.makaug.test`]
  ))[0];
  fx.agentUserId = agentUser.id;
  fx.agent = (await q(
    `INSERT INTO agents (full_name, licence_number, phone, whatsapp, email, status, user_id)
     VALUES ($1, $2, $3, $3, $4, 'approved', $5) RETURNING *`,
    [`Agent ${MARK}`, `LIC-${MARK}`, phone(1), `agent-${RUN.toLowerCase()}@leade2e.makaug.test`, agentUser.id]
  ))[0];

  const listing = async ({ key, status = 'approved', agentId = null, listerPhone = null, listerEmail = null, foundOnline = false }) => {
    const row = (await q(
      `INSERT INTO properties (
         listing_type, title, description, district, area, price, price_currency, status,
         agent_id, lister_type, lister_name, lister_phone, lister_email, inquiry_reference,
         listed_via, extra_fields
       ) VALUES ('rent', $1, 'Lead pipeline end-to-end test listing. Not a real property.', 'Kampala', 'Ntinda',
                 1500000, 'UGX', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING *`,
      [
        `${MARK} ${key}`,
        status,
        agentId,
        agentId ? 'agent' : 'owner',
        agentId ? null : `Owner ${key}`,
        listerPhone,
        listerEmail,
        `${MARK}-${key}`.slice(0, 40),
        foundOnline ? 'found_online' : 'web',
        JSON.stringify({ lead_e2e: MARK })
      ]
    ))[0];
    fx[key] = row;
    return row;
  };

  await listing({ key: 'AGENT', agentId: fx.agent.id });
  // LEAD_E2E_OWNER_PHONE: put a real phone (yours) on the private-owner listing
  // to receive one genuine handoff WhatsApp during a live check.
  fx.ownerPhone = process.env.LEAD_E2E_OWNER_PHONE || phone(2);
  await listing({ key: 'OWNER', listerPhone: fx.ownerPhone });
  await listing({ key: 'FOUND', listerPhone: phone(3), foundOnline: true });
  await listing({ key: 'PENDING', status: 'pending', agentId: fx.agent.id });
  await listing({ key: 'NOCONTACT' });
}

async function cleanup() {
  if (process.env.LEAD_E2E_KEEP === '1') {
    console.log(`\n(LEAD_E2E_KEEP=1 — fixtures kept, marker ${MARK})`);
    return;
  }
  const phones = Array.from({ length: 40 }, (_v, i) => intl(phone(i)));
  const listingIds = ['AGENT', 'OWNER', 'FOUND', 'PENDING', 'NOCONTACT'].map((k) => fx[k]?.id).filter(Boolean);
  const leadIds = (await q(
    `SELECT l.id FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id
      WHERE l.listing_id = ANY($1::uuid[]) OR c.phone_key = ANY($2::text[]) OR l.message LIKE $3 OR l.metadata::text LIKE $3`,
    [listingIds, phones.map((p) => p.slice(-9)), `%${MARK}%`]
  )).map((r) => r.id);
  await q('DELETE FROM notifications WHERE related_lead_id = ANY($1::uuid[]) OR related_listing_id = ANY($2::uuid[])', [leadIds, listingIds]);
  await q('DELETE FROM viewing_bookings WHERE listing_id = ANY($1::uuid[])', [listingIds]);
  const localPhones = Array.from({ length: 40 }, (_v, i) => phone(i));
  await q('DELETE FROM callback_requests WHERE phone = ANY($1::text[])', [localPhones]);
  await q('DELETE FROM property_inquiries WHERE property_id = ANY($1::uuid[])', [listingIds]);
  await q('DELETE FROM property_requests WHERE phone = ANY($1::text[])', [localPhones]);
  await q('DELETE FROM lead_activities WHERE lead_id = ANY($1::uuid[])', [leadIds]);
  await q('DELETE FROM leads WHERE id = ANY($1::uuid[])', [leadIds]);
  await q('DELETE FROM contacts WHERE (phone_key = ANY($1::text[]) AND user_id IS NULL) OR email LIKE $2', [phones.map((p) => p.slice(-9)), '%@leade2e.makaug.test']);
  await q('DELETE FROM outbound_message_queue WHERE user_phone = ANY($1::text[])', [phones]);
  await q('DELETE FROM whatsapp_sessions WHERE phone = ANY($1::text[]) OR phone = ANY($2::text[])', [phones, phones.map((p) => `+${p}`)]).catch(() => {});
  await q('DELETE FROM properties WHERE id = ANY($1::uuid[])', [listingIds]);
  if (fx.agent) await q('DELETE FROM agents WHERE id = $1', [fx.agent.id]);
  if (fx.agentUserId) await q('DELETE FROM users WHERE id = $1', [fx.agentUserId]);
  console.log(`\nCleaned up fixtures for ${MARK}.`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function run() {
  const t0 = new Date(Date.now() - 1000).toISOString();

  group('1. Website enquiry on an agent listing reaches the agent');
  const enq = await api('POST', `/api/properties/${fx.AGENT.id}/inquiries`, {
    contact_name: 'Grace Seeker', contact_phone: phone(10), contact_email: `grace-${RUN.toLowerCase()}@leade2e.makaug.test`,
    message: `Is this still available? ${MARK}`, channel: 'web'
  });
  check('returns 201', enq.status === 201, JSON.stringify(enq.json).slice(0, 300));
  const enqLead = await leadFor(enq.json?.data?.lead_id);
  check('one CRM lead created, linked to listing and agent', enqLead && enqLead.listing_id === fx.AGENT.id && enqLead.agent_id === fx.agent.id);
  check('lead is billable (agent listing)', enqLead?.billable === true);
  check('handoff recorded as delivered (queued/sent)', ['queued', 'sent', 'simulated'].includes(enqLead?.handoff_status), `handoff_status=${enqLead?.handoff_status}`);
  check('lead status moved to handed_over', enqLead?.lead_status === 'handed_over', `lead_status=${enqLead?.lead_status}`);
  const toAgent = await queuedTo(phone(1), t0);
  const agentMsg = toAgent.map((r) => r.payload?.text || '').join('\n---\n');
  check('WhatsApp to the agent carries the seeker name, phone and listing', /Grace Seeker/.test(agentMsg) && agentMsg.includes(phone(10)) && agentMsg.includes(MARK), agentMsg.slice(0, 400) || `queued rows: ${toAgent.length}`);
  check('agent message goes out on an allowed bridge source', toAgent.every((r) => (r.metadata?.source || '') === (process.env.LEAD_HANDOFF_WHATSAPP_SOURCE || 'whatsapp_runtime')));
  const toSeeker = await queuedTo(phone(10), t0);
  const seekerMsg = toSeeker.map((r) => r.payload?.text || '').join('\n');
  check('seeker gets a WhatsApp confirmation with the agent\'s number', seekerMsg.includes(phone(1)) && /has been sent to/i.test(seekerMsg), seekerMsg.slice(0, 300) || 'no seeker message');
  const notes = await notificationsFor(enqLead?.id);
  check('delivery attempts logged with real statuses (no fake "in_app")', notes.length >= 2 && notes.every((n) => n.channel !== 'in_app'), JSON.stringify(notes));
  check('response tells the page who it went to', enq.json?.data?.lister_name === fx.agent.full_name);

  group('2. The same person enquiring again is one lead, and the agent is not spammed');
  const t1 = new Date().toISOString();
  const enq2 = await api('POST', `/api/properties/${fx.AGENT.id}/inquiries`, {
    contact_name: 'Grace Seeker', contact_phone: `+256 ${phone(10).slice(1, 4)} ${phone(10).slice(4)}`, message: `Is this still available? ${MARK}`
  });
  check('returns 201 and flags repeat', enq2.status === 201 && enq2.json?.data?.repeat === true, JSON.stringify(enq2.json).slice(0, 200));
  check('same lead id (phone matched across formats)', enq2.json?.data?.lead_id === enqLead?.id);
  const enqLeadAfter = await leadFor(enqLead?.id);
  check('repeat_count incremented', Number(enqLeadAfter?.repeat_count) === 1, `repeat_count=${enqLeadAfter?.repeat_count}`);
  check('a resubmitted identical enquiry sends no second WhatsApp to the agent', (await queuedTo(phone(1), t1)).length === 0);
  const t1b = new Date().toISOString();
  await api('POST', `/api/properties/${fx.AGENT.id}/inquiries`, { contact_name: 'Grace Seeker', contact_phone: phone(10), message: `Can I pay in instalments? ${MARK}` });
  const followMsg = (await queuedTo(phone(1), t1b)).map((r) => r.payload?.text || '').join('\n');
  check('a new written message from her does reach the agent', /instalments/.test(followMsg), followMsg.slice(0, 200) || 'nothing queued');
  check('…still the same single lead', Number((await leadFor(enqLead?.id))?.repeat_count) === 2);
  const contactRows = await q('SELECT COUNT(*)::int AS n FROM contacts WHERE phone_key = $1', [phone(10).slice(-9)]);
  check('one contact record for the person', contactRows[0].n === 1, `contacts=${contactRows[0].n}`);

  group('3. WhatsApp button clicks: counted once per person, contact shown, no message');
  const t2 = new Date().toISOString();
  const c1 = await api('POST', `/api/properties/${fx.AGENT.id}/whatsapp-click`, { source: 'listing_detail_whatsapp', visitor_id: `v1-${RUN}` });
  const c2 = await api('POST', `/api/properties/${fx.AGENT.id}/whatsapp-click`, { source: 'listing_detail_whatsapp', visitor_id: `v1-${RUN}` });
  const c3 = await api('POST', `/api/properties/${fx.AGENT.id}/whatsapp-click`, { source: 'mobile_sticky_whatsapp', visitor_id: `v1-${RUN}` });
  check('three clicks all accepted', [c1, c2, c3].every((r) => r.status === 201), JSON.stringify([c1.status, c2.status, c3.status]));
  check('three clicks → one lead', c1.json?.data?.lead_id && c1.json.data.lead_id === c2.json?.data?.lead_id && c2.json.data.lead_id === c3.json?.data?.lead_id);
  const clickLead = await leadFor(c1.json?.data?.lead_id);
  check('click lead: handoff contact_shown, repeat_count 2', clickLead?.handoff_status === 'contact_shown' && Number(clickLead?.repeat_count) === 2, `${clickLead?.handoff_status} / ${clickLead?.repeat_count}`);
  check('no ghost contact created for an anonymous click', !clickLead?.contact_id);
  const clickRows = await q('SELECT is_repeat FROM property_inquiries WHERE property_id = $1 AND channel = $2 AND created_at >= $3 ORDER BY created_at', [fx.AGENT.id, 'whatsapp', t2]);
  check('raw clicks still logged (3), 2 marked repeat', clickRows.length === 3 && clickRows.filter((r) => r.is_repeat).length === 2);
  check('no WhatsApp sent to the agent for clicks', (await queuedTo(phone(1), t2)).length === 0);
  const c4 = await api('POST', `/api/properties/${fx.AGENT.id}/whatsapp-click`, { source: 'listing_detail_whatsapp', visitor_id: `v2-${RUN}` });
  check('a different visitor is a new lead', c4.status === 201 && c4.json?.data?.lead_id && c4.json.data.lead_id !== c1.json?.data?.lead_id);

  group('4. Found-online listing: contact shown, makaug never messages the poster');
  const t3 = new Date().toISOString();
  const fo1 = await api('POST', `/api/properties/${fx.FOUND.id}/whatsapp-click`, { visitor_id: `v3-${RUN}` });
  const fo2 = await api('POST', `/api/properties/${fx.FOUND.id}/inquiries`, { contact_name: 'Paul', contact_phone: phone(11), message: `hi ${MARK}` });
  const foLead = await leadFor(fo2.json?.data?.lead_id);
  check('click and enquiry accepted', fo1.status === 201 && fo2.status === 201);
  check('handoff is contact_shown, not billable', foLead?.handoff_status === 'contact_shown' && foLead?.billable === false, `${foLead?.handoff_status} billable=${foLead?.billable}`);
  check('nothing queued to the original poster', (await queuedTo(phone(3), t3)).length === 0);
  check('found-online poster number not returned to the page', fo2.json?.data?.lister_phone == null);

  group('5. Private owner listing reaches the owner');
  const t4 = new Date().toISOString();
  const own = await api('POST', `/api/properties/${fx.OWNER.id}/inquiries`, { contact_name: 'Moses', contact_phone: phone(12), message: `Viewing Saturday? ${MARK}` });
  const ownLead = await leadFor(own.json?.data?.lead_id);
  check('201, handoff delivered, not billable (no agent)', own.status === 201 && ['queued', 'sent', 'simulated'].includes(ownLead?.handoff_status) && ownLead?.billable === false, `${own.status} ${ownLead?.handoff_status}`);
  const ownMsg = (await queuedToRaw(fx.ownerPhone, t4)).map((r) => r.payload?.text || '').join('\n');
  check('owner WhatsApp includes Moses and his number', ownMsg.includes('Moses') && ownMsg.includes(phone(12)), ownMsg.slice(0, 300));

  group('6. Listing with no lister contact is flagged for staff, not lost');
  const nc = await api('POST', `/api/properties/${fx.NOCONTACT.id}/inquiries`, { contact_name: 'Ann', contact_phone: phone(13), message: `x ${MARK}` });
  const ncLead = await leadFor(nc.json?.data?.lead_id);
  check('201 and handoff = no_lister_contact', nc.status === 201 && ncLead?.handoff_status === 'no_lister_contact', `${nc.status} ${ncLead?.handoff_status}`);
  check('stays open for staff', ncLead?.lead_status === 'open');
  check('seeker is NOT told "sent to the lister" when it was not', (await queuedTo(phone(13), t0)).length === 0);
  check('page is told it was not handed over', nc.json?.data?.handoff === 'no_lister_contact');

  group('7. Listings that are not live do not take enquiries or hand out numbers');
  const pe = await api('POST', `/api/properties/${fx.PENDING.id}/inquiries`, { contact_name: 'X', contact_phone: phone(14) });
  const pc = await api('POST', `/api/properties/${fx.PENDING.id}/whatsapp-click`, { visitor_id: `v4-${RUN}` });
  check('pending listing enquiry → 404', pe.status === 404);
  check('pending listing click → 404', pc.status === 404);

  group('8. Viewing and callback requests reach the lister');
  const t5 = new Date().toISOString();
  const vw = await api('POST', '/api/property-seeker/viewings', {
    listing_id: fx.AGENT.id, name: 'Ruth Viewer', phone: phone(15), preferred_date: '2026-10-03', preferred_time: '10:00', message: MARK
  });
  check('viewing 201 with lead + handoff', vw.status === 201 && vw.json?.data?.lead_id && ['queued', 'sent', 'simulated'].includes(vw.json?.data?.handoff), JSON.stringify(vw.json).slice(0, 300));
  const booking = (await q('SELECT broker_id, lead_id FROM viewing_bookings WHERE id = $1', [vw.json?.data?.id]))[0];
  check('booking linked to lead and to the agent\'s user', booking?.lead_id === vw.json?.data?.lead_id && booking?.broker_id === fx.agentUserId);
  const vMsg = (await queuedTo(phone(1), t5)).map((r) => r.payload?.text || '').join('\n');
  check('agent WhatsApp says "Viewing request" with the date', /Viewing request/.test(vMsg) && vMsg.includes('2026-10-03'), vMsg.slice(0, 300));
  const t5b = new Date().toISOString();
  const gv = await api('POST', '/api/property-seeker/viewings', {
    listing_id: fx.AGENT.id, name: 'Grace Seeker', phone: phone(10), preferred_date: '2026-10-04', preferred_time: '15:00'
  });
  check('Grace (already enquired) books a viewing → same lead, upgraded to viewing', gv.status === 201 && gv.json?.data?.lead_id === enqLead?.id && (await leadFor(enqLead?.id))?.lead_type === 'viewing', JSON.stringify(gv.json).slice(0, 200));
  const gvMsg = (await queuedTo(phone(1), t5b)).map((r) => r.payload?.text || '').join('\n');
  check('…and the agent still gets her viewing date', /Viewing request/.test(gvMsg) && gvMsg.includes('2026-10-04') && gvMsg.includes('Grace'), gvMsg.slice(0, 300) || 'nothing queued');
  const cb = await api('POST', '/api/property-seeker/callbacks', { listing_id: fx.OWNER.id, name: 'Ivan', phone: phone(16), preferred_callback_time: 'after 5pm' });
  check('listing callback 201 with handoff', cb.status === 201 && ['queued', 'sent', 'simulated'].includes(cb.json?.data?.handoff), JSON.stringify(cb.json).slice(0, 200));
  const gcb = await api('POST', '/api/property-seeker/callbacks', { name: 'General', phone: phone(17), message: MARK });
  check('general callback goes to the makaug team', gcb.status === 201 && gcb.json?.data?.handoff === 'makaug_team', JSON.stringify(gcb.json).slice(0, 200));
  const bad = await api('POST', '/api/property-seeker/viewings', { listing_id: fx.PENDING.id, name: 'x', phone: phone(18) });
  check('viewing on a non-live listing → 404 and no orphan lead', bad.status === 404 && (await q('SELECT COUNT(*)::int AS n FROM contacts WHERE phone_key = $1', [phone(18).slice(-9)]))[0].n === 0);

  group('9. "Tell us what you need" is acknowledged and in the Lead Centre');
  const t6 = new Date().toISOString();
  const need = await api('POST', '/api/contact/looking', {
    name: 'Brian Need', phone: phone(19), requirements: `2 bedroom in Kira under 1.5m ${MARK}`, preferred_locations: 'Kira', listing_type: 'rent', max_budget: 1500000
  });
  check('201', need.status === 201, JSON.stringify(need.json).slice(0, 200));
  const needLead = (await q(`SELECT l.* FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.phone_key = $1 ORDER BY l.created_at DESC LIMIT 1`, [phone(19).slice(-9)]))[0];
  check('lead type property_need, handoff makaug_team', needLead?.lead_type === 'property_need' && needLead?.handoff_status === 'makaug_team', `${needLead?.lead_type} ${needLead?.handoff_status}`);
  const needMsg = (await queuedTo(phone(19), t6)).map((r) => r.payload?.text || '').join('\n');
  check('seeker gets a WhatsApp acknowledgement', /has your property request/i.test(needMsg), needMsg.slice(0, 200) || 'none');

  group('10. Spam protection');
  const hp = await api('POST', `/api/properties/${fx.AGENT.id}/inquiries`, { contact_name: 'Bot', contact_phone: phone(20), website: 'http://spam.example' });
  check('honeypot submission looks accepted…', hp.status === 201);
  check('…but stores nothing', (await q('SELECT COUNT(*)::int AS n FROM contacts WHERE phone_key = $1', [phone(20).slice(-9)]))[0].n === 0);
  const noName = await api('POST', `/api/properties/${fx.AGENT.id}/inquiries`, { contact_phone: phone(21) });
  check('missing name → 400', noName.status === 400);
  const longMsg = await api('POST', `/api/properties/${fx.OWNER.id}/inquiries`, { contact_name: 'Long', contact_phone: phone(22), message: 'a'.repeat(10000) });
  const longLead = await leadFor(longMsg.json?.data?.lead_id);
  check('oversized message capped at 2000 chars', longMsg.status === 201 && (longLead?.message || '').length <= 2000, `len=${(longLead?.message || '').length}`);

  if (process.env.LEAD_E2E_WHATSAPP_BOT !== '0') {
    group('11. WhatsApp bot: asking about a listing is a lead and reaches the lister');
    const t7 = new Date().toISOString();
    const bot = await api('POST', '/api/whatsapp/test', { phone: `+${intl(phone(23))}`, body: `Hi, I'm viewing this listing on makaug: https://makaug.com/property/${fx.AGENT.id} Is it still available?` });
    const botReply = String(bot.json?.botResponse || '');
    check('bot answers with the listing', bot.status === 200 && botReply.includes(MARK), botReply.slice(0, 200) || JSON.stringify(bot.json).slice(0, 200));
    await sleep(500);
    const botLead = (await q(`SELECT l.* FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.phone_key = $1 ORDER BY l.created_at DESC LIMIT 1`, [phone(23).slice(-9)]))[0];
    check('bot enquiry created a lead', botLead?.source === 'whatsapp_bot_listing_enquiry' && botLead?.listing_id === fx.AGENT.id, JSON.stringify(botLead && { s: botLead.source, l: botLead.listing_id }));
    const botAgentMsg = (await queuedTo(phone(1), t7)).map((r) => r.payload?.text || '').join('\n');
    check('agent told on WhatsApp, with the enquirer\'s number', /via makaug WhatsApp/.test(botAgentMsg) && botAgentMsg.includes(intl(phone(23)).slice(-9)), botAgentMsg.slice(0, 300));
    check('bot tells the seeker the lister has their number', /sent them your number/i.test(botReply));
    check('bot no longer promises to "chase" or "FIND"', !/\*FIND\*|chase/i.test(botReply));
    const botPending = await api('POST', '/api/whatsapp/test', { phone: `+${intl(phone(24))}`, body: `I'm viewing this listing https://makaug.com/property/${fx.PENDING.id} is it available?` });
    const pendingReply = String(botPending.json?.botResponse || '');
    check('pending listing: "could not find", no number handed out', /could not find that listing/i.test(pendingReply) && !pendingReply.includes(phone(1).slice(1)), pendingReply.slice(0, 200));
  }

  group('12. Admin Lead Centre');
  const adminHeaders = { 'x-api-key': ADMIN_API_KEY };
  // A test lead that must stay out of the numbers.
  await q(
    `INSERT INTO leads (source, lead_type, message, is_test, lead_status) VALUES ('admin_viewing_test', 'viewing', $1, TRUE, 'open')`,
    [`test lead ${MARK}`]
  );
  const list = await api('GET', `/api/admin/leads?search=${encodeURIComponent(MARK)}&limit=100`, null, adminHeaders);
  check('admin list 200', list.status === 200, JSON.stringify(list.json).slice(0, 200));
  const rows = list.json?.data || [];
  const agentRow = rows.find((r) => r.id === enqLead?.id);
  check('row shows listing, agent and handoff', agentRow && agentRow.agent_name === fx.agent.full_name && agentRow.listing_reference && agentRow.handoff_status, JSON.stringify(agentRow || {}).slice(0, 300));
  check('test leads hidden by default', !rows.some((r) => String(r.message || '').startsWith('test lead')));
  const withTests = await api('GET', `/api/admin/leads?search=${encodeURIComponent(MARK)}&include_tests=1&limit=100`, null, adminHeaders);
  check('…and visible with include_tests=1', (withTests.json?.data || []).some((r) => String(r.message || '').startsWith('test lead')));
  const flagged = await api('GET', `/api/admin/leads?handoff=no_lister_contact&search=${encodeURIComponent(MARK)}`, null, adminHeaders);
  check('filter "needs staff" finds the no-contact lead', (flagged.json?.data || []).some((r) => r.id === ncLead?.id));
  const won = await api('PATCH', `/api/admin/leads/${enqLead?.id}`, { lead_status: 'won' }, adminHeaders);
  const wonLead = await leadFor(enqLead?.id);
  check('mark won → closed_at set', won.status === 200 && wonLead?.lead_status === 'won' && wonLead?.closed_at, `${won.status} ${wonLead?.lead_status}`);
  const junk = await api('PATCH', `/api/admin/leads/${enqLead?.id}`, { lead_status: 'banana' }, adminHeaders);
  check('unknown status rejected (400)', junk.status === 400);
  const csv = await fetch(`${BASE_URL}/api/admin/leads-export.csv?search=${encodeURIComponent(MARK)}`, { headers: adminHeaders });
  const csvText = await csv.text();
  check('CSV export has agent and handoff columns', csv.status === 200 && /agent_name/.test(csvText) && /handoff_status/.test(csvText) && csvText.includes(fx.agent.full_name));

  group('13. Agent portal shows real leads with contact details');
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    check('JWT_SECRET available to sign an agent session', false, 'set JWT_SECRET to run this group');
  } else {
    const token = jwt.sign({ sub: fx.agentUserId, role: 'agent_broker' }, secret, { expiresIn: '10m' });
    const me = await api('GET', '/api/agents/me', null, { authorization: `Bearer ${token}` });
    check('agent /me 200', me.status === 200, JSON.stringify(me.json).slice(0, 200));
    const leads = me.json?.data?.leads || [];
    // AGENT listing: Grace (form), 2 click visitors, Ruth (viewing), bot enquirer.
    const expected = process.env.LEAD_E2E_WHATSAPP_BOT === '0' ? 4 : 5;
    check(`${expected} leads — one per person, not one per click`, leads.length === expected, `got ${leads.length}: ${leads.map((l) => l.contact_name || 'anon').join(', ')}`);
    check('Grace\'s phone is visible to the agent', leads.some((l) => l.contact_phone && l.contact_phone.includes(phone(10).slice(-9))));
    check('bare button clicks show no personal details', leads.filter((l) => !l.contact_phone && !l.contact_email && !l.contact_name).length === 2);
    check('headline count matches the list', Number(me.json?.data?.stats?.lead_enquiries) === leads.length, `stats=${me.json?.data?.stats?.lead_enquiries}`);
  }

  group('14. Weekly agent report counts people, not clicks');
  const reports = require('../services/agentWeeklyReportService');
  const compute = reports.computePeriodMetrics || reports._test?.computePeriodMetrics;
  if (!compute) {
    check('computePeriodMetrics exported', false, 'not exported — skipped');
  } else {
    const m = await compute([fx.AGENT.id], new Date(Date.now() - 3600e3), new Date(Date.now() + 60e3));
    check('WhatsApp clicks = 2 people (not 4 clicks)', Number(m.whatsapp_clicks) === 2, JSON.stringify(m));
    const expectedEnq = process.env.LEAD_E2E_WHATSAPP_BOT === '0' ? 2 : 3;
    check(`enquiries = ${expectedEnq} people (form, viewing${expectedEnq === 3 ? ', bot' : ''})`, Number(m.enquiries) === expectedEnq, JSON.stringify(m));
  }
}

(async () => {
  let crashed = null;
  try {
    const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json()).catch(() => null);
    if (!health?.ok) throw new Error(`Server not reachable at ${BASE_URL}`);
    console.log(`Lead pipeline E2E — ${BASE_URL} — run ${MARK}`);
    await seed();
    await run();
  } catch (error) {
    crashed = error;
    console.error('\n💥 Test run crashed:', error);
  } finally {
    try { await cleanup(); } catch (error) { console.error('Cleanup failed:', error.message); }
    await pool.end();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${crashed ? ' (run crashed)' : ''}.`);
  if (process.env.LEAD_E2E_JSON) {
    require('fs').writeFileSync(process.env.LEAD_E2E_JSON, JSON.stringify({ run: MARK, base_url: BASE_URL, at: new Date().toISOString(), results, crashed: crashed ? String(crashed.message) : null }, null, 2));
  }
  process.exit(failed.length || crashed ? 1 : 0);
})();
