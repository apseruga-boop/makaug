#!/usr/bin/env node
'use strict';

/**
 * Lead referral + approved-agent guard, end to end (server + Postgres).
 *
 *   BASE_URL=http://localhost:3999 DATABASE_URL=... ADMIN_API_KEY=... node scripts/test-lead-referral-e2e.js
 *
 * Seeds its own agents, listings and unanswered searches, cleans up after.
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
const MARK = `REFE2E-${RUN}`;
const digits = String(parseInt(RUN, 16) % 10000).padStart(4, '0');
const phone = (n) => `0792${digits}${String(n).padStart(2, '0')}`;
const intl = (p) => `256${p.slice(1)}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 3 });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};
async function api(method, path, body) {
  const r = await fetch(`${BASE_URL}${path}`, { method, headers: { 'content-type': 'application/json', ...ADMIN }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const queued = (p, since) => q('SELECT payload, metadata FROM outbound_message_queue WHERE RIGHT(user_phone, 9) = $1 AND created_at >= $2', [p.replace(/\D/g, '').slice(-9), since]);

const fx = {};
async function seed() {
  fx.good = (await q(`INSERT INTO agents (full_name, licence_number, phone, whatsapp, status, districts_covered)
    VALUES ($1, $2, $3, $3, 'approved', ARRAY['Bunga','Kampala']) RETURNING *`, [`Francis ${MARK}`, `LIC-${MARK}`, phone(1)]))[0];
  fx.other = (await q(`INSERT INTO agents (full_name, licence_number, phone, whatsapp, status, districts_covered)
    VALUES ($1, $2, $3, $3, 'approved', ARRAY['Gulu']) RETURNING *`, [`Other ${MARK}`, `LIC2-${MARK}`, phone(2)]))[0];
  fx.pending = (await q(`INSERT INTO agents (full_name, licence_number, phone, whatsapp, status)
    VALUES ($1, $2, $3, $3, 'pending') RETURNING *`, [`Pending ${MARK}`, `LIC3-${MARK}`, phone(3)]))[0];
  fx.scraped = (await q(`INSERT INTO agents (full_name, licence_number, phone, whatsapp, status, verification_reason)
    VALUES ($1, $2, $3, $3, 'approved', 'Created by public social source onboarding') RETURNING *`, [`Scraped ${MARK}`, `TIKTOK-${MARK}`, phone(4)]))[0];
  const listing = async (key, agentId) => (await q(`INSERT INTO properties (listing_type, title, description, district, area, price, price_currency, status, agent_id, lister_type, inquiry_reference)
    VALUES ('rent', $1, 'Referral test listing for the lead pipeline. Not a real property.', 'Kampala', 'Bunga', 900000, 'UGX', 'approved', $2, 'agent', $3) RETURNING *`,
    [`${MARK} ${key}`, agentId, `${MARK}-${key}`.slice(0, 40)]))[0];
  fx.Lgood = await listing('GOOD', fx.good.id);
  fx.Lpending = await listing('PEND', fx.pending.id);
  fx.Lscraped = await listing('SCRP', fx.scraped.id);
  for (const [n, budget, note] of [[10, 800000, `2 bed in Bunga please ${MARK}`], [11, 1200000, null], [11, 1200000, null]]) {
    await q(`INSERT INTO property_leads (phone, preferred_area, purpose, category, budget, notes, payload)
      VALUES ($1, 'Bunga', 'search', 'rent', $2, $3, '{}'::jsonb)`, [intl(phone(n)), budget, note || 'Auto-captured from WhatsApp no-match search.']);
  }
}

async function cleanup() {
  const phones = Array.from({ length: 30 }, (_v, i) => intl(phone(i)));
  const listingIds = [fx.Lgood, fx.Lpending, fx.Lscraped].filter(Boolean).map((l) => l.id);
  const leadIds = (await q(`SELECT l.id FROM leads l LEFT JOIN contacts c ON c.id = l.contact_id
     WHERE l.listing_id = ANY($1::uuid[]) OR c.phone_key = ANY($2::text[])`, [listingIds, phones.map((p) => p.slice(-9))])).map((r) => r.id);
  await q('DELETE FROM notifications WHERE related_lead_id = ANY($1::uuid[]) OR related_listing_id = ANY($2::uuid[]) OR RIGHT(COALESCE(recipient_phone, \'\'), 9) = ANY($3::text[])', [leadIds, listingIds, phones.map((p) => p.slice(-9))]);
  await q('DELETE FROM property_inquiries WHERE property_id = ANY($1::uuid[])', [listingIds]);
  await q('DELETE FROM lead_activities WHERE lead_id = ANY($1::uuid[])', [leadIds]);
  await q('DELETE FROM leads WHERE id = ANY($1::uuid[])', [leadIds]);
  await q('DELETE FROM contacts WHERE phone_key = ANY($1::text[]) AND user_id IS NULL', [phones.map((p) => p.slice(-9))]);
  await q('DELETE FROM property_leads WHERE phone = ANY($1::text[])', [phones]);
  await q('DELETE FROM outbound_message_queue WHERE RIGHT(user_phone, 9) = ANY($1::text[])', [phones.map((p) => p.slice(-9))]);
  await q('DELETE FROM properties WHERE id = ANY($1::uuid[])', [listingIds]);
  await q('DELETE FROM agents WHERE id = ANY($1::uuid[])', [[fx.good, fx.other, fx.pending, fx.scraped].filter(Boolean).map((a) => a.id)]);
}

async function run() {
  console.log('\n▶ Only approved, registered agents get lead WhatsApps');
  const t0 = new Date(Date.now() - 1000).toISOString();
  const good = await api('POST', `/api/properties/${fx.Lgood.id}/inquiries`, { contact_name: 'Amina', contact_phone: phone(20), message: `Available? ${MARK}` });
  check('approved agent listing: handed off', ['queued', 'sent', 'simulated'].includes(good.json?.data?.handoff), JSON.stringify(good.json).slice(0, 200));
  check('…and the approved agent got the WhatsApp', (await queued(phone(1), t0)).length === 1);
  const pend = await api('POST', `/api/properties/${fx.Lpending.id}/inquiries`, { contact_name: 'Ben', contact_phone: phone(21), message: `x ${MARK}` });
  check('pending (unscreened) agent: not messaged', pend.json?.data?.handoff === 'agent_not_approved' && (await queued(phone(3), t0)).length === 0, JSON.stringify(pend.json?.data));
  const scr = await api('POST', `/api/properties/${fx.Lscraped.id}/inquiries`, { contact_name: 'Cara', contact_phone: phone(22), message: `x ${MARK}` });
  check('source-sweep (scraped) agent profile: not messaged', scr.json?.data?.handoff === 'agent_not_approved' && (await queued(phone(4), t0)).length === 0, JSON.stringify(scr.json?.data));
  check('enquirers not told "sent" when it was not', (await queued(phone(21), t0)).length === 0 && (await queued(phone(22), t0)).length === 0);

  console.log('\n▶ Agent dropdown');
  const list = await api('GET', '/api/admin/lead-referrals/agents?area=Bunga');
  const names = (list.json?.data || []).map((a) => a.full_name);
  check('lists approved agents', names.includes(fx.good.full_name) && names.includes(fx.other.full_name), names.join(', '));
  check('never lists pending or scraped agents', !names.includes(fx.pending.full_name) && !names.includes(fx.scraped.full_name));
  const mine = (list.json?.data || []).filter((a) => a.full_name.includes(MARK));
  check('agent covering Bunga comes first and is marked', mine[0]?.full_name === fx.good.full_name && mine[0]?.match === true, JSON.stringify(mine.map((a) => [a.full_name, a.match])));

  console.log('\n▶ Unanswered search → agent');
  const body = { search_type: 'rent', area: 'Bunga', days: 90, agent_id: fx.good.id };
  const beforeDry = (await queued(phone(1), t0)).length;
  const dry = await api('POST', '/api/admin/demand-gaps/referral', { ...body, dry_run: true });
  const text = dry.json?.data?.text || '';
  check('message drafted for 2 people (3 asks, deduped by phone)', /We have 2 leads for you/.test(text), text.slice(0, 200));
  check('message has area, want, budgets and numbers', /a place to rent in Bunga/.test(text) && /UGX 1\.2m/.test(text) && text.includes(phone(10).slice(4)) && /Hi Francis/.test(text), text);
  check('dry run sends nothing', (await queued(phone(1), t0)).length === beforeDry);
  const t1 = new Date().toISOString();
  const prev = await api('POST', '/api/admin/demand-gaps/referral', { ...body, text, preview_to: `+${intl(phone(25))}` });
  check('preview goes to my number (agent + client sample), not the agent', prev.status === 200 && (await queued(phone(25), t1)).length === 2 && (await queued(phone(1), t1)).length === 0, JSON.stringify(prev.json).slice(0, 200));
  const unmarked = await q(`SELECT COUNT(*)::int AS n FROM property_leads WHERE phone = ANY($1) AND payload ? 'last_referral'`, [[intl(phone(10)), intl(phone(11))]]);
  check('preview does not mark the search as referred', unmarked[0].n === 0);
  const edited = `${text}\n\n(edited by admin ${MARK})`;
  const send = await api('POST', '/api/admin/demand-gaps/referral', { ...body, text: edited });
  const toAgent = await queued(phone(1), t1);
  check('sent to the agent on the allowed bridge source', send.status === 200 && toAgent.length === 1 && toAgent[0].metadata?.source === 'whatsapp_runtime', JSON.stringify(send.json).slice(0, 200));
  check('the admin\'s edits are what the agent gets', String(toAgent[0]?.payload?.text || '').includes(`edited by admin ${MARK}`));
  check('both people who searched are told it went to Francis', (await queued(phone(10), t1)).length === 1 && (await queued(phone(11), t1)).length === 1);
  const marked = await q(`SELECT COUNT(*)::int AS n FROM property_leads WHERE phone = ANY($1) AND payload->'last_referral'->>'agent_name' = $2`, [[intl(phone(10)), intl(phone(11))], fx.good.full_name]);
  check('all 3 search rows marked "sent to Francis"', marked[0].n === 3, `marked=${marked[0].n}`);
  const gaps = await api('GET', '/api/admin/demand-gaps?days=90&limit=100');
  const row = (gaps.json?.data?.gaps || []).find((g) => g.area === 'Bunga' && g.search_type === 'rent');
  check('demand panel shows who it was sent to', row?.last_referral?.agent_name === fx.good.full_name, JSON.stringify(row?.last_referral));
  const bad = await api('POST', '/api/admin/demand-gaps/referral', { ...body, agent_id: fx.scraped.id, dry_run: true });
  check('cannot pick a scraped/unapproved agent even by id', bad.status === 400);

  console.log('\n▶ Single lead → agent');
  const leadId = pend.json?.data?.lead_id;
  const dryLead = await api('POST', `/api/admin/leads/${leadId}/referral`, { agent_id: fx.other.id, dry_run: true });
  const lt = dryLead.json?.data?.text || '';
  check('one-person message with name, number and what they said', /We have a lead for you/.test(lt) && /Name: Ben/.test(lt) && lt.includes(phone(21).slice(4)), lt);
  const t2 = new Date().toISOString();
  const sendLead = await api('POST', `/api/admin/leads/${leadId}/referral`, { agent_id: fx.other.id, text: lt });
  const leadRow = (await q('SELECT lead_status, handoff_status, metadata FROM leads WHERE id = $1', [leadId]))[0];
  const toBen = (await queued(phone(21), t2)).map((m) => m.payload?.text || '').join('\n');
  check('Ben is told his request went to the agent', /^Hi Ben, this is makaug\.com/.test(toBen) && toBen.includes(fx.other.full_name), toBen.slice(0, 200));
  check('sent, and the lead shows referred + handed over', sendLead.status === 200 && (await queued(phone(2), t2)).length === 1 && leadRow?.handoff_status === 'referred_to_agent' && leadRow?.lead_status === 'handed_over', JSON.stringify({ s: sendLead.status, h: leadRow?.handoff_status, st: leadRow?.lead_status }));
  const activity = await q(`SELECT 1 FROM lead_activities WHERE lead_id = $1 AND activity_type = 'referred_to_agent'`, [leadId]);
  check('referral is in the lead\'s history', activity.length === 1);
}

(async () => {
  let crashed = null;
  try {
    await seed();
    await run();
  } catch (error) { crashed = error; console.error(error); }
  finally { try { await cleanup(); } catch (e) { console.error('cleanup', e.message); } await pool.end(); }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed${crashed ? ' (crashed)' : ''}.`);
  process.exit(failed || crashed ? 1 : 0);
})();
