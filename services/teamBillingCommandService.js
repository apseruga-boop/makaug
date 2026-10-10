'use strict';

/**
 * Team payment commands on WhatsApp.
 *
 * Ronald (or Arthur) sets agents up on the phone, often away from a laptop.
 * From a team number, a message to the makaug WhatsApp starting with one of
 * these words is a command, not a customer message:
 *
 *   NEW AGENT Jane Nakato 0772123456   → creates the agent (if new) and takes them
 *                                         live on a 14-day free trial: welcome
 *                                         pack out, reminders and follow-up
 *                                         scheduled (from 10 Oct 2026; before
 *                                         that it sent a pay link first)
 *   PAY LINK 0772123456                → sends that agent or private lister
 *                                         their pay link
 *   STATUS 0772123456                  → paid? link opened? waiting?
 *   APPROVE 0772123456                 → approves a pending agent once paid
 *                                         (welcome pack goes out as usual)
 *   TRIALS                             → agents on the free trial: ending soon, unpaid
 *   PAYMENT HELP                       → this list
 *
 * Team numbers are the billing "confirmers" (Sales & Revenue › Settings) plus
 * the owner numbers. Nobody else can run these.
 */

const logger = require('../config/logger');
const revenue = require('./revenueService');
const billingOps = require('./billingOpsService');
const payLinks = require('./payLinkService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');

const COMMAND = /^\s*(new\s+agent|add\s+agent|pay\s*link|paylink|status|paid\??|approve|trials?|payment\s+help|pay\s+help)\b[\s:,-]*(.*)$/is;

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function phoneKey(value) {
  return digits(value).slice(-9);
}

/** 0772 123456 / +256 772 123456 / 772123456 → 256772123456. */
function ugPhone(value) {
  const d = digits(value);
  if (d.length === 12 && d.startsWith('256')) return d;
  if (d.length === 10 && d.startsWith('0')) return `256${d.slice(1)}`;
  if (d.length === 9 && d.startsWith('7')) return `256${d}`;
  return d.length >= 9 ? d : '';
}

function findPhoneInText(text = '') {
  const match = String(text).match(/(?:\+?\d[\d\s-]{7,16}\d)/);
  return match ? ugPhone(match[0]) : '';
}

async function teamPhones(db) {
  const settings = await billingOps.getSettings(db).catch(() => ({}));
  const confirmers = Array.isArray(settings.confirmers) ? settings.confirmers : [];
  const list = confirmers.map((c) => phoneKey(c?.phone)).filter((k) => k.length === 9);
  try {
    const { getConfiguredOwnerPhones } = require('./aiCeoControlService');
    if (typeof getConfiguredOwnerPhones === 'function') {
      for (const p of getConfiguredOwnerPhones() || []) if (phoneKey(p).length === 9) list.push(phoneKey(p));
    }
  } catch (_ignored) { /* optional */ }
  return [...new Set(list)];
}

async function isTeamPhone(db, phone) {
  const key = phoneKey(phone);
  if (key.length !== 9) return false;
  return (await teamPhones(db)).includes(key);
}

async function findAgentByPhone(db, phone) {
  const key = phoneKey(phone);
  return (await db.query(
    `SELECT id, full_name, phone, whatsapp, status, paid_until, fee_exempt, removed_at, paid_awaiting_approval_at, billing_suspended_at
       FROM agents
      WHERE removed_at IS NULL
        AND (RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1
          OR RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1)
      ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1`,
    [key]
  )).rows[0] || null;
}

async function findPrivateListingByPhone(db, phone) {
  const key = phoneKey(phone);
  return (await db.query(
    `SELECT id, title, lister_name, lister_phone, lister_paid_until, status
       FROM properties
      WHERE agent_id IS NULL AND status IN ('approved', 'pending', 'hidden')
        AND NOT ${foundOnlinePropertySql('properties')}
        AND RIGHT(REGEXP_REPLACE(COALESCE(lister_phone, ''), '[^0-9]', '', 'g'), 9) = $1
      ORDER BY updated_at DESC LIMIT 1`,
    [key]
  )).rows[0] || null;
}

function pretty(phone) {
  const d = digits(phone);
  return d.length === 12 && d.startsWith('256') ? `0${d.slice(3, 6)} ${d.slice(6)}` : `+${d}`;
}

function sentWord(sent) {
  return ['sent', 'queued', 'simulated'].includes(sent?.status) ? 'sent to them on WhatsApp ✓' : `NOT sent (${sent?.status || 'unknown'}) — forward it yourself`;
}

function help() {
  return [
    '💳 *Payment commands* (team only)',
    '',
    '*NEW AGENT* Jane Nakato 0772123456',
    `→ makes them a live agent on a ${revenue.agentTrialDays()}-day free trial, sends their welcome pack, then follows up for payment`,
    '',
    '*TRIALS*',
    '→ every agent on a free trial: who ends soon, who has not paid',
    '',
    '*PAY LINK* 0772123456',
    '→ sends an agent or private lister their pay link again',
    '',
    '*STATUS* 0772123456',
    '→ paid or not, and whether they opened the link',
    '',
    '*APPROVE* 0772123456',
    '→ approves a pending agent once they have paid (welcome pack goes out)',
    '',
    "You'll get a WhatsApp here the moment anyone pays."
  ].join('\n');
}

/** Approve through the admin route itself, so the account, welcome pack and checks are identical. */
async function approveThroughAdmin(agent, actor, feeOverride) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return { ok: false, error: 'Approving from WhatsApp is not set up on the server (no admin key). Please approve in Admin › Agents.' };
  const port = process.env.PORT || '8080';
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/agents/${agent.id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-makaug-actor': actor },
    body: JSON.stringify(feeOverride ? { status: 'approved', fee_override: feeOverride } : { status: 'approved' })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    logger.warn('WhatsApp approve failed', { agentId: agent.id, status: response.status, error: data.error || data.message });
    return { ok: false, error: data.message || data.error || String(response.status) };
  }
  return { ok: true, data: data.data || {} };
}

function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function newAgent(db, rest, actor) {
  const phone = findPhoneInText(rest);
  if (!phone) return 'Send it like this: *NEW AGENT* Jane Nakato 0772123456';
  const name = rest.replace(/(?:\+?\d[\d\s-]{7,16}\d)/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let agent = await findAgentByPhone(db, phone);
  let created = false;
  if (!agent) {
    if (name.length < 2) return `I don't have an agent on ${pretty(phone)} yet. Add their name: *NEW AGENT* Jane Nakato ${pretty(phone)}`;
    agent = (await db.query(
      `INSERT INTO agents (full_name, phone, whatsapp, licence_number, registration_status, status, verification_reason, registered_by_phone)
       VALUES ($1, $2, $2, $3, 'not_registered', 'pending', $4, $5)
       RETURNING id, full_name, phone, whatsapp, status, paid_until, fee_exempt, paid_awaiting_approval_at`,
      [name, phone, `PENDING-${Date.now()}`, `Set up on WhatsApp by ${actor}`, digits(actor)]
    )).rows[0];
    created = true;
  }
  if (String(agent.status) === 'approved' && !agent.billing_suspended_at) {
    return `${agent.full_name} (${pretty(phone)}) is already an approved agent. To send their monthly link: *PAY LINK* ${pretty(phone)}`;
  }
  if (agent.fee_exempt) return `${agent.full_name} joined before the monthly fee, so they list for free. Approve them with *APPROVE ${pretty(phone)}*.`;

  // New agents go live straight away on a free trial; the money follows.
  const days = revenue.agentTrialDays();
  const ends = revenue.addDays(revenue.kampalaDate(), days - 1);
  const result = await approveThroughAdmin(agent, actor, revenue.agentFeeRequired(agent)
    ? { mode: 'free_period', days, reason: `New agent ${days}-day free trial — signed up by ${actor}` }
    : null);
  if (!result.ok) {
    return `${created ? `Set up ${agent.full_name} (${pretty(phone)}) but` : `Couldn't go live for ${agent.full_name}:`} ${result.error}`;
  }
  const welcome = result.data.welcome;
  const settings = await billingOps.getSettings(db).catch(() => ({}));
  const remindOn = revenue.addDays(ends, -Math.max(1, Number(settings.agent_fee?.remind_days_before || 3)));
  return [
    `✅ *${agent.full_name}* (${pretty(phone)}) is live on a ${days}-day free trial, ending ${dayLabel(ends)}.`,
    welcome?.error ? `Welcome pack NOT sent: ${welcome.error}` : 'Welcome pack and how-to-post guide sent to them on WhatsApp.',
    '',
    `I'll remind them on ${dayLabel(remindOn)}, WhatsApp you the moment they pay, and list them under *TRIALS* if they are still unpaid after ${dayLabel(ends)}.`
  ].join('\n');
}

async function trials(db) {
  const rows = await billingOps.listAgentTrials(db);
  if (!rows.length) return 'No agents are on a free trial right now.';
  const order = { overdue: 0, taken_down: 0, ending_soon: 1, on_trial: 2 };
  const sorted = [...rows].sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3) || a.ends.localeCompare(b.ends));
  return ['📋 *Agents on a free trial*', '', ...sorted.slice(0, 30).map(billingOps.formatTrialLine), '',
    'To chase one: *PAY LINK* 0772123456. Paid agents drop off this list.'].join('\n');
}

async function sendLink(db, rest, actor) {
  const phone = findPhoneInText(rest);
  if (!phone) return 'Send it like this: *PAY LINK* 0772123456';
  const agent = await findAgentByPhone(db, phone);
  let created;
  let who;
  if (agent) {
    if (agent.fee_exempt) return `${agent.full_name} joined before the monthly fee — they list for free, no payment needed.`;
    created = await payLinks.createPayLink(db, { purpose: 'agent_subscription', agent_id: agent.id }, actor);
    who = `${agent.full_name} (agent, ${agent.status})`;
  } else {
    const listing = await findPrivateListingByPhone(db, phone);
    if (!listing) return `Nobody on ${pretty(phone)} — no agent and no private listing. New agent? *NEW AGENT* Name ${pretty(phone)}`;
    created = await payLinks.createPayLink(db, { purpose: 'listing_fee', property_id: listing.id }, actor);
    who = `${listing.lister_name || 'Private lister'} — ${listing.title || 'listing'}`;
  }
  const sent = await payLinks.sendPayLink(db, { code: created.link.code, to: phone, actor }).catch((error) => ({ status: 'failed', reason: error.message }));
  return [`💳 Pay link for *${who}*: ${billingOps.ugx(created.link.amount_ugx)}`, sentWord(sent), created.url].join('\n');
}

async function status(db, rest) {
  const phone = findPhoneInText(rest);
  if (!phone) return 'Send it like this: *STATUS* 0772123456';
  const agent = await findAgentByPhone(db, phone);
  const today = revenue.kampalaDate();
  const lines = [];
  let linkWhere;
  let linkArgs;
  if (agent) {
    const paidUntil = revenue.isoDay(agent.paid_until);
    let state;
    if (agent.fee_exempt) state = 'free listing (joined before the fee)';
    else if (agent.billing_suspended_at) state = '⛔ paused — fee unpaid';
    else if (paidUntil && paidUntil >= today) state = `✅ paid until ${paidUntil}`;
    else if (paidUntil) state = `❗ overdue since ${paidUntil}`;
    else state = '❗ not paid yet';
    lines.push(`*${agent.full_name}* — agent, ${agent.status}`, state);
    if (agent.status === 'pending' && paidUntil && paidUntil >= today) lines.push(`Ready to approve: reply *APPROVE ${pretty(phone)}*`);
    linkWhere = 'agent_id = $1::uuid';
    linkArgs = [agent.id];
  } else {
    const listing = await findPrivateListingByPhone(db, phone);
    if (!listing) return `Nobody on ${pretty(phone)}.`;
    const paidUntil = revenue.isoDay(listing.lister_paid_until);
    lines.push(`*${listing.title || 'Listing'}* — ${listing.lister_name || 'private lister'} (${listing.status})`, paidUntil ? `Paid until ${paidUntil}` : 'No payment recorded');
    linkWhere = 'property_id = $1::uuid';
    linkArgs = [listing.id];
  }
  const link = (await db.query(`SELECT * FROM pay_links WHERE ${linkWhere} ORDER BY created_at DESC LIMIT 1`, linkArgs)).rows[0];
  if (link) {
    const seen = link.status === 'paid'
      ? `paid by ${link.paid_method === 'card' ? 'card' : 'MoMo'}`
      : (link.claim_id ? 'they sent a MoMo transaction ID — waiting for confirmation in Sales & Revenue' : (link.opened_at ? 'opened, not paid' : (link.sent_at ? 'sent, not opened yet' : 'not sent')));
    lines.push('', `Last pay link: ${seen}`, payLinks.payUrl(link.code));
  }
  return lines.join('\n');
}

async function approve(db, rest, actor) {
  const phone = findPhoneInText(rest);
  if (!phone) return 'Send it like this: *APPROVE* 0772123456';
  const agent = await findAgentByPhone(db, phone);
  if (!agent) return `No agent on ${pretty(phone)}.`;
  if (agent.status === 'approved') return `${agent.full_name} is already approved.`;
  // Not paid yet: approve the usual way — welcome pack first, then the pay link.
  const unpaid = revenue.agentFeeRequired(agent);
  const days = revenue.agentTrialDays();
  const result = await approveThroughAdmin(agent, actor, unpaid
    ? { mode: 'free_period', days, reason: `New agent ${days}-day free trial — approved on WhatsApp by ${actor}` }
    : null);
  if (!result.ok) return `Couldn't approve ${agent.full_name}: ${result.error}. Please do it in Admin › Agents.`;
  const welcome = result.data.welcome;
  return [
    `✅ *${agent.full_name}* is approved.`,
    welcome?.error ? `Welcome pack NOT sent: ${welcome.error}` : 'Welcome pack and how-to-post guide sent to them on WhatsApp.',
    unpaid ? `On a ${days}-day free trial. I'll remind them before it ends and tell you when they pay (*TRIALS* shows the list).` : ''
  ].filter(Boolean).join('\n');
}

/** Returns a reply if this is a team payment command, otherwise null. */
async function handleTeamBillingCommand(db, { phone, body = '' } = {}) {
  const match = String(body || '').match(COMMAND);
  if (!match) return null;
  if (!(await isTeamPhone(db, phone))) return null;
  const word = match[1].toLowerCase().replace(/\s+/g, ' ');
  const rest = String(match[2] || '').trim();
  // "status" and "approve" are ordinary words: only treat them as commands
  // when a phone number follows, so other team conversations are untouched.
  if (/^(status|paid|approve)/.test(word) && !findPhoneInText(rest)) return null;
  if (/^trial/.test(word) && rest) return null; // only the bare word TRIALS is a command
  const actor = `whatsapp:${digits(phone)}`;
  try {
    if (word.startsWith('new') || word.startsWith('add')) return await newAgent(db, rest, actor);
    if (word.startsWith('pay link') || word.startsWith('paylink')) return await sendLink(db, rest, actor);
    if (word.startsWith('status') || word.startsWith('paid')) return await status(db, rest);
    if (word === 'approve') return await approve(db, rest, actor);
    if (word.startsWith('trial')) return await trials(db);
    return help();
  } catch (error) {
    logger.warn('Team billing command failed', { word, error: error.message });
    return `That didn't work: ${error.message}`;
  }
}

module.exports = { handleTeamBillingCommand, isTeamPhone, ugPhone, findPhoneInText, help };
