#!/usr/bin/env node
'use strict';

/**
 * Lead desk, end to end (server + Postgres).
 *
 *   BASE_URL=http://localhost:3999 DATABASE_URL=... ADMIN_API_KEY=... node scripts/test-lead-desk-e2e.js
 *
 * Seeds requests in every source table, drives the desk API as the admin
 * screen does, checks the database and the WhatsApp queue, cleans up.
 */

require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3999').replace(/\/+$/, '');
if (/(^|\.)makaug\.com$/i.test(new URL(BASE_URL).hostname) && process.env.LEAD_E2E_ALLOW_PRODUCTION !== '1') {
  console.error('Refusing to run against production.');
  process.exit(2);
}
const ADMIN = { 'x-api-key': process.env.ADMIN_API_KEY || '' };
const RUN = crypto.randomBytes(3).toString('hex').toUpperCase();
const MARK = `DESKE2E-${RUN}`;
const digits = String(parseInt(RUN, 16) % 10000).padStart(4, '0');
const phone = (n) => `0793${digits}${String(n).padStart(2, '0')}`;
const intl = (p) => `256${p.slice(1)}`;
const AREA = `Deskville${digits}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 3 });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};
async function api(method, path, body) {
  const r = await fetch(`${BASE_URL}${path}`, { method, headers: { 'content-type': 'application/json', ...ADMIN }, body: body ? JSON.stringify(body) : undefined });
  const isCsv = (r.headers.get('content-type') || '').includes('csv');
  return { status: r.status, json: isCsv ? null : await r.json().catch(() => ({})), text: isCsv ? await r.text() : '' };
}
const queued = (p, since) => q('SELECT payload, metadata FROM outbound_message_queue WHERE RIGHT(user_phone, 9) = $1 AND created_at >= $2', [p.replace(/\D/g, '').slice(-9), since]);
const deskLeads = () => q(`SELECT * FROM demand_leads WHERE phone_key = ANY($1::text[]) ORDER BY asked_at`, [Array.from({ length: 30 }, (_v, i) => phone(i).slice(-9))]);

const fx = {};
async function seed() {
  fx.agent = (await q(`INSERT INTO agents (full_name, licence_number, phone, whatsapp, status, districts_covered)
    VALUES ($1, $2, $3, $3, 'approved', ARRAY[$4]) RETURNING *`, [`Deskagent ${MARK}`, `LIC-${MARK}`, phone(1), AREA]))[0];
  // WhatsApp search, 30h ago → overdue
  await q(`INSERT INTO property_leads (phone, preferred_area, purpose, category, budget, notes, created_at)
    VALUES ($1, $2, 'search', 'rent', 800000, $3, NOW() - INTERVAL '30 hours')`,
    [intl(phone(10)), AREA, `No approved listings found for natural query: 2 bed in ${AREA} around 800k ${MARK}`]);
  // WhatsApp search whose "area" is a whole sentence
  await q(`INSERT INTO property_leads (phone, preferred_area, purpose, category, notes, created_at)
    VALUES ($1, $2, 'search', 'sale', 'Auto-captured from WhatsApp no-match search.', NOW() - INTERVAL '2 hours')`,
    [intl(phone(11)), `Hi Makaug, I'm on the for sale page and I'm looking for a home ${MARK}`]);
  // Website form, same area and want → same row on the desk
  await q(`INSERT INTO property_requests (full_name, phone, email, preferred_locations, listing_type, max_budget, requirements, created_at)
    VALUES ('Grace Form', $1, $2, $3, 'rent', 1000000, $4, NOW() - INTERVAL '3 hours')`,
    [phone(12), `grace-${RUN.toLowerCase()}@desk.test`, AREA, `3 bedroom with parking ${MARK}`]);
  // Property finder request with a contact
  const contact = (await q(`INSERT INTO contacts (name, phone, phone_key) VALUES ('Finder Fred', $1, $2) RETURNING id`, [phone(13), phone(13).slice(-9)]))[0];
  fx.contactIds = [contact.id];
  await q(`INSERT INTO property_need_requests (contact_id, source, category, location, budget, message, created_at)
    VALUES ($1, 'dashboard', 'land', $2, 50000000, $3, NOW() - INTERVAL '1 hour')`, [contact.id, AREA, `Half acre ${MARK}`]);
  // Ask AI with no results
  const c2 = (await q(`INSERT INTO contacts (name, phone, phone_key) VALUES ('Ask Annie', $1, $2) RETURNING id`, [phone(14), phone(14).slice(-9)]))[0];
  fx.contactIds.push(c2.id);
  await q(`INSERT INTO leads (contact_id, source, lead_type, category, location, message, lead_status)
    VALUES ($1, 'ask_ai_zero_result', 'property_need', 'commercial', $2, $3, 'open')`, [c2.id, AREA, `Shop space ${MARK}`]);
  // Sent from the old demand panel before the desk existed.
  await q(`INSERT INTO property_leads (phone, preferred_area, purpose, category, notes, payload, created_at)
    VALUES ($1, $2, 'search', 'commercial', $3, $4::jsonb, NOW() - INTERVAL '2 days')`,
    [intl(phone(16)), AREA, `legacy ${MARK}`, JSON.stringify({ last_referral: { agent_name: 'Old Panel Agent', at: new Date(Date.now() - 86400000).toISOString() } })]);
  // Bot self-test traffic and makaug's own number: never leads.
  await q(`INSERT INTO property_leads (phone, preferred_area, purpose, category, notes) VALUES
    ($1, $2, 'search', 'rent', $3), ('256780863394', $2, 'search', 'rent', $3)`,
    [`dryrun:sim-selftest-${RUN.toLowerCase()}-1:abc`, AREA, `selftest ${MARK}`]);
  // An old one for "remove older than 30 days"
  await q(`INSERT INTO property_leads (phone, preferred_area, purpose, category, notes, created_at)
    VALUES ($1, $2, 'search', 'rent', $3, NOW() - INTERVAL '45 days')`, [intl(phone(15)), `Oldtown${digits}`, `old one ${MARK}`]);
}

async function cleanup() {
  const keys = Array.from({ length: 30 }, (_v, i) => phone(i).slice(-9));
  await q(`DELETE FROM demand_leads WHERE phone_key = ANY($1::text[])`, [keys]);
  await q(`DELETE FROM property_leads WHERE RIGHT(phone, 9) = ANY($1::text[]) OR notes LIKE $2`, [keys, `%${MARK}%`]);
  await q(`DELETE FROM property_requests WHERE RIGHT(phone, 9) = ANY($1::text[])`, [keys]);
  await q(`DELETE FROM property_need_requests WHERE contact_id = ANY($1::uuid[])`, [fx.contactIds || []]);
  await q(`DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = ANY($1::uuid[]))`, [fx.contactIds || []]);
  await q(`DELETE FROM leads WHERE contact_id = ANY($1::uuid[])`, [fx.contactIds || []]);
  await q(`DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [fx.contactIds || []]);
  await q(`DELETE FROM notifications WHERE RIGHT(COALESCE(recipient_phone, ''), 9) = ANY($1::text[]) OR related_listing_id = $2`, [keys, fx.listing?.id || null]);
  await q(`DELETE FROM notifications WHERE type IN ('lead_desk_report_manual') AND payload_summary::text LIKE $1`, [`%${phone(20).slice(-9)}%`]);
  await q(`DELETE FROM outbound_message_queue WHERE RIGHT(user_phone, 9) = ANY($1::text[])`, [keys]);
  if (fx.listing) await q('DELETE FROM properties WHERE id = $1', [fx.listing.id]);
  if (fx.agent) await q('DELETE FROM agents WHERE id = $1', [fx.agent.id]);
}

async function run() {
  console.log('\n▶ Every source lands on the desk');
  const desk = await api('GET', '/api/admin/lead-desk?refresh=force');
  check('desk loads', desk.status === 200, JSON.stringify(desk.json).slice(0, 200));
  const mine = await deskLeads();
  const bySource = mine.reduce((m, l) => ((m[l.source] = (m[l.source] || 0) + 1), m), {});
  check('WhatsApp, website form, property finder and Ask AI all imported', bySource.whatsapp >= 2 && bySource.website_form === 1 && bySource.property_finder === 1 && bySource.ask_ai === 1, JSON.stringify(bySource));
  const legacy = (await deskLeads()).find((l) => l.phone_key === phone(16).slice(-9));
  const legacyRef = legacy ? await q('SELECT agent_name FROM demand_lead_referrals WHERE demand_lead_id = $1', [legacy.id]) : [];
  check('a search sent from the old panel keeps its "sent to" history', legacy?.status === 'sent_to_agent' && legacyRef[0]?.agent_name === 'Old Panel Agent', JSON.stringify({ st: legacy?.status, r: legacyRef }));
  const junk = await q(`SELECT COUNT(*)::int AS n FROM demand_leads WHERE message LIKE $1`, [`%selftest ${MARK}%`]);
  check('bot self-tests and makaug\'s own number are not leads', junk[0].n === 0, `found ${junk[0].n}`);
  const again = await api('GET', '/api/admin/lead-desk?refresh=force');
  check('loading again never duplicates', (await deskLeads()).length === mine.length && again.status === 200);
  const sentence = mine.find((l) => l.phone_key === phone(11).slice(-9));
  check('a sentence stored as the "area" becomes the message, area left blank', sentence && sentence.area === null && /looking for a home/.test(sentence.message || ''), JSON.stringify(sentence && { a: sentence.area, m: sentence.message }));
  const wa = mine.find((l) => l.phone_key === phone(10).slice(-9));
  check('the bot\'s bookkeeping is stripped from the message', wa && !/natural query/i.test(wa.message) && /2 bed in/.test(wa.message), wa?.message);
  check('24h clock: due = asked + 24h', wa && Math.abs(new Date(wa.due_at) - new Date(wa.asked_at) - 86400000) < 2000);
  const groups = desk.json.data.groups;
  const rentGroup = groups.find((g) => g.area === AREA && g.want === 'rent');
  check('WhatsApp + website request for the same thing are one row: 2 people', rentGroup && rentGroup.people === 2 && rentGroup.sources.includes('whatsapp') && rentGroup.sources.includes('website_form'), JSON.stringify(rentGroup && { p: rentGroup.people, s: rentGroup.sources }));
  check('row shows the budget range and is flagged overdue', rentGroup && rentGroup.budget_max === 1000000 && rentGroup.budget_min === 800000 && rentGroup.overdue === true);
  check('overdue rows are listed first', groups.findIndex((g) => g.overdue) === 0);
  check('summary counts overdue', Number(desk.json.data.summary.overdue) >= 1);

  console.log('\n▶ Send to an agent');
  const ids = rentGroup.leads.map((l) => l.id);
  const dry = await api('POST', '/api/admin/lead-desk/referral', { lead_ids: ids, agent_id: fx.agent.id, dry_run: true });
  const t = dry.json?.data?.text || '';
  check('message drafted for 2 people with area, budget and numbers', /We have 2 leads for you/.test(t) && t.includes(AREA) && t.includes(phone(12).slice(4)) && /UGX 1m/.test(t), t);
  const t0 = new Date().toISOString();
  const prev = await api('POST', '/api/admin/lead-desk/referral', { lead_ids: ids, agent_id: fx.agent.id, text: t, preview_to: `+${intl(phone(20))}` });
  check('preview goes only to my number', prev.status === 200 && (await queued(phone(20), t0)).length === 1 && (await queued(phone(1), t0)).length === 0);
  check('preview does not count as sent', (await deskLeads()).filter((l) => ids.includes(l.id)).every((l) => !l.first_sent_at));
  const send = await api('POST', '/api/admin/lead-desk/referral', { lead_ids: ids, agent_id: fx.agent.id, text: t });
  check('sent to the agent', send.status === 200 && (await queued(phone(1), t0)).length === 1, JSON.stringify(send.json).slice(0, 200));
  const after = await api('GET', '/api/admin/lead-desk?refresh=0');
  const rentAfter = after.json.data.groups.find((g) => g.area === AREA && g.want === 'rent');
  check('row now shows sent to the agent, waiting for answer, clock stopped', rentAfter && rentAfter.last_referral?.agent_name === fx.agent.full_name && rentAfter.last_referral.response === 'awaiting' && rentAfter.unsent === 0 && !rentAfter.overdue);

  console.log('\n▶ Track the agent\'s answer');
  const referralId = rentAfter.last_referral.id;
  const bad = await api('POST', `/api/admin/lead-desk/referrals/${referralId}/response`, { response: 'banana' });
  check('unknown response refused', bad.status === 400);
  const nudgeDry = await api('POST', `/api/admin/lead-desk/referrals/${referralId}/nudge`, { dry_run: true });
  check('follow-up message drafted', /quick follow-up/.test(nudgeDry.json?.data?.text || ''), nudgeDry.json?.data?.text);
  const t1 = new Date().toISOString();
  const nudge = await api('POST', `/api/admin/lead-desk/referrals/${referralId}/nudge`, {});
  check('follow-up sent to the agent and recorded', nudge.status === 200 && (await queued(phone(1), t1)).length === 1 && (await q('SELECT nudged_at FROM demand_lead_referrals WHERE id = $1', [referralId]))[0].nudged_at);
  const resp = await api('POST', `/api/admin/lead-desk/referrals/${referralId}/response`, { response: 'has_property', notes: 'Has a 2 bed' });
  const leadAfter = (await q('SELECT status FROM demand_leads dl JOIN demand_lead_referrals r ON r.demand_lead_id = dl.id WHERE r.id = $1', [referralId]))[0];
  check('"agent has a property" saved and the request moves on', resp.status === 200 && leadAfter?.status === 'agent_has_property');

  console.log('\n▶ Property comes up → tell the client');
  fx.listing = (await q(`INSERT INTO properties (listing_type, title, description, district, area, price, price_currency, status, lister_type, lister_name, lister_phone, inquiry_reference)
    VALUES ('land', $1, 'Desk match test listing. Not a real property.', 'Wakiso', $2, 45000000, 'UGX', 'approved', 'owner', 'Owner', $3, $4) RETURNING *`,
    [`Half acre in ${AREA}`, AREA, phone(2), `${MARK}-L`.slice(0, 40)]))[0];
  const withMatch = await api('GET', '/api/admin/lead-desk?refresh=force');
  const landGroup = withMatch.json.data.groups.find((g) => g.area === AREA && g.want === 'land');
  const landLead = landGroup?.leads?.[0];
  check('a new matching listing is found for the land request', landLead && (landLead.matches || []).some((m) => m.id === fx.listing.id), JSON.stringify(landLead && landLead.matches));
  check('the rent requests do not match a land listing', !(withMatch.json.data.groups.find((g) => g.area === AREA && g.want === 'rent')?.leads || []).some((l) => (l.matches || []).length));
  check('summary shows a property to send', Number(withMatch.json.data.summary.matches_to_send) >= 1);
  const mDry = await api('POST', `/api/admin/lead-desk/${landLead.id}/notify-match`, { listing_id: fx.listing.id, dry_run: true });
  const mt = mDry.json?.data?.text || '';
  check('client message: "you asked … a property has come up" with the link', /asked us about land to buy in/.test(mt) && /has come up/.test(mt) && mt.includes(`/property/${fx.listing.id}`), mt);
  const t2 = new Date().toISOString();
  const notify = await api('POST', `/api/admin/lead-desk/${landLead.id}/notify-match`, { listing_id: fx.listing.id, text: mt });
  const notified = (await q('SELECT status, client_notified_at FROM demand_leads WHERE id = $1', [landLead.id]))[0];
  check('sent to the client and marked', notify.status === 200 && (await queued(phone(13), t2)).length === 1 && notified.status === 'client_notified' && notified.client_notified_at);

  console.log('\n▶ Remove and restore');
  const oldLead = (await deskLeads()).find((l) => l.phone_key === phone(15).slice(-9));
  check('the 45-day-old request is on the desk', oldLead && !oldLead.archived_at);
  const older = await api('POST', '/api/admin/lead-desk/remove-older', { days: 30 });
  const oldAfter = (await q('SELECT archived_at, archived_reason FROM demand_leads WHERE id = $1', [oldLead.id]))[0];
  check('"remove older than 30 days" removes it, recent ones stay', older.status === 200 && oldAfter.archived_at && oldAfter.archived_reason === 'old' && !(await deskLeads()).find((l) => l.phone_key === phone(12).slice(-9)).archived_at);
  const ai = (await deskLeads()).find((l) => l.source === 'ask_ai');
  const rm = await api('POST', '/api/admin/lead-desk/remove', { lead_ids: [ai.id], reason: 'spam' });
  const openNow = await api('GET', '/api/admin/lead-desk?refresh=0');
  const gone = !openNow.json.data.groups.some((g) => g.leads.some((l) => l.id === ai.id));
  const archived = await api('GET', '/api/admin/lead-desk?view=archived&refresh=0');
  check('removed request leaves the open desk and shows under Removed', rm.status === 200 && gone && archived.json.data.groups.some((g) => g.leads.some((l) => l.id === ai.id && l.archived_reason === 'spam')));
  await api('POST', '/api/admin/lead-desk/restore', { lead_ids: [ai.id] });
  check('restore brings it back', !(await q('SELECT archived_at FROM demand_leads WHERE id = $1', [ai.id]))[0].archived_at);
  const reimport = await api('GET', '/api/admin/lead-desk?refresh=force');
  check('a removed request is not re-imported by the next sync', (await q('SELECT archived_at FROM demand_leads WHERE id = $1', [oldLead.id]))[0].archived_at && reimport.status === 200);

  console.log('\n▶ Daily report and export');
  const rep = await api('POST', '/api/admin/lead-desk/report', { dry_run: true });
  const rt = rep.json?.data?.text || '';
  check('report text has new/overdue/waiting/property-found lines', /New in the last 24h/.test(rt) && /Overdue/.test(rt) && /Waiting for an agent/.test(rt) && /Properties found/.test(rt), rt);
  const t3 = new Date().toISOString();
  const repSend = await api('POST', '/api/admin/lead-desk/report', { to: `+${intl(phone(20))}` });
  check('report sent to a chosen WhatsApp', repSend.status === 200 && (await queued(phone(20), t3)).length === 1);
  const csv = await api('GET', '/api/admin/lead-desk/export.csv?view=all');
  check('CSV export lists every request with source, budget and agent', csv.status === 200 && csv.text.includes('Grace Form') && csv.text.includes('Website form') && csv.text.includes(fx.agent.full_name));

  console.log('\n▶ Morning scheduler');
  const desk2 = require('../services/leadDeskService');
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala' }).format(new Date()));
  process.env.LEAD_DESK_REPORT_HOUR = String(hour);
  process.env.LEAD_DESK_REPORT_WHATSAPP = `+${intl(phone(21))}`;
  process.env.LEAD_DESK_REPORT_EMAIL = '';
  process.env.LEAD_TEAM_EMAIL = '';
  process.env.SUPPORT_EMAIL = '';
  await q(`DELETE FROM notifications WHERE type = 'lead_desk_daily_report' AND created_at >= NOW() - INTERVAL '20 hours'`).catch(() => {});
  const t4 = new Date().toISOString();
  const db = require('../config/database');
  await desk2.tickLeadDesk(db);
  await desk2.tickLeadDesk(db);
  const reportsQueued = await queued(phone(21), t4);
  check('at report hour the scheduler sends the report once (not twice)', reportsQueued.length === 1, `queued=${reportsQueued.length}`);
  await q(`DELETE FROM notifications WHERE type = 'lead_desk_daily_report' AND created_at >= $1`, [t4]);
  await db.pool.end();
}

(async () => {
  let crashed = null;
  try { await seed(); await run(); } catch (error) { crashed = error; console.error(error); }
  finally { try { await cleanup(); } catch (e) { console.error('cleanup', e.message); } await pool.end(); }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed${crashed ? ' (crashed)' : ''}.`);
  process.exit(failed || crashed ? 1 : 0);
})();
