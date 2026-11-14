'use strict';

/**
 * Agent 007: the control room.
 *
 * Arthur, 14 Nov 2026: "have a look at the Agent 007 menu and make it look
 * better and more useful, explain what each option does." Until then it asked
 * "Who do these properties belong to?" and offered four things. Everything
 * else Arthur and Ronald do from a phone was a typed command nobody could
 * see: PAY LINK, STATUS, UNPAID.
 *
 * It is now one menu, in four groups:
 *
 *   LIST A PROPERTY   1 for an agent · 2 for a private owner
 *   SEND A VIDEO      3 agent intro film · 4 owner intro film · 5 how-to-post
 *   MONEY             6 payment link · 7 who still owes
 *   CHECK             8 look someone up
 *
 * The payment link was 4 and is now 6. Someone who types the old 4 and then
 * its old 1 or 2 is told so before anything is sent (movedPayLinkNotice).
 *
 * This file is the words and the lookups. routes/whatsapp.js sends things.
 */

const revenue = require('./revenueService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { publishedPricing, ugxLabel } = require('../config/publishedPricing');

const CONTROL_ROOM_STEPS = Object.freeze([
  'employee_owner_pitch_contact',
  'employee_howto_who',
  'employee_howto_contact',
  'employee_pay_link_owner',
  'employee_pay_link_owner_pick',
  'employee_owes_list',
  'employee_owes_person',
  'employee_lookup',
  'employee_lookup_pick',
  'employee_lookup_action'
]);

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function digitsOf(value) {
  return String(value || '').replace(/\D+/g, '');
}

function phoneKey(value) {
  return digitsOf(value).slice(-9);
}

/** 0772 123456 / +256 772 123456 / 772123456 as 256772123456. Other countries as typed. */
function fullDigits(value) {
  const d = digitsOf(value);
  if (d.length === 12 && d.startsWith('256')) return d;
  if (d.length === 10 && d.startsWith('0')) return `256${d.slice(1)}`;
  if (d.length === 9 && d.startsWith('7')) return `256${d}`;
  return d;
}

function prettyPhone(value) {
  const d = fullDigits(value);
  if (d.length === 12 && d.startsWith('256')) return `+256 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return d ? `+${d}` : '';
}

function ownerFeeLabel() {
  return ugxLabel(publishedPricing().owner_listing.monthly_ugx);
}

function agentFeeLabel() {
  return ugxLabel(publishedPricing().agent.monthly_ugx);
}

function shortDay(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' });
}

function daysSince(value, now = new Date()) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T00:00:00+03:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function daysWord(n) {
  const days = Number(n) || 0;
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

// --- The menu ----------------------------------------------------------------

/**
 * What the staff member sees after "Agent 007". One line on what each option
 * is, one line on what it does. Short enough that WhatsApp shows all of it.
 */
function controlRoomMenu({ agentFee = agentFeeLabel(), ownerFee = ownerFeeLabel() } = {}) {
  return [
    '🔐 *Agent 007* · makaug control room',
    '',
    '*LIST A PROPERTY*',
    '*1* · For an *agent or broker*',
    '_It goes under their makaug profile._',
    '*2* · For a *private owner*',
    '_Their own property. No agent profile is created._',
    '',
    '*SEND A VIDEO*',
    '*3* · *Agent intro film*',
    `_Why join, how posting works, ${agentFee} a month._`,
    '*4* · *Owner intro film*',
    `_Listing direct, how it works, ${ownerFee} a property._`,
    '*5* · *How-to-post video*',
    '_The steps, for an agent or an owner._',
    '',
    '*MONEY*',
    '*6* · *Payment link*',
    '_To an agent, a new prospect or a private owner._',
    '*7* · *Who still owes*',
    '_Everyone with money due. Chase them from the list._',
    '',
    '*CHECK*',
    '*8* · *Look someone up*',
    '_Their status, payments, listings and what we sent._',
    '',
    'Reply with a number. *CANCEL* closes it.'
  ].join('\n');
}

function exact(value, aliases = []) {
  const input = clean(value).toLowerCase().replace(/[.!]+$/, '');
  return aliases.some((alias) => input === alias);
}

/** The option chosen at the menu, as the role the intake works with. '' for anything else. */
function parseControlRoomChoice(value = '') {
  if (exact(value, ['1', 'agent', 'an agent', 'broker'])) return 'agent';
  if (exact(value, ['2', 'customer', 'new customer', 'owner', 'property owner', 'private owner', 'normal person'])) return 'customer';
  if (exact(value, ['3', 'video', 'send video', 'agent video', 'agent film', 'agent intro', 'pitch', 'send the video', 'invite'])) return 'pitch';
  if (exact(value, ['4', 'owner video', 'owner film', 'owner intro', 'lister video', 'owner pitch'])) return 'owner_pitch';
  if (exact(value, ['5', 'how to', 'how-to', 'howto', 'how to post', 'how to video', 'how-to video', 'guide'])) return 'how_to';
  if (exact(value, ['6', 'pay', 'payment', 'pay link', 'payment link', 'send payment link', 'send pay link', 'send the payment link', 'invoice'])) return 'pay_link';
  if (exact(value, ['7', 'owes', 'who owes', 'who still owes', 'owing', 'unpaid', 'debts', 'debtors'])) return 'owes';
  if (exact(value, ['8', 'lookup', 'look up', 'look someone up', 'check', 'find', 'who is'])) return 'lookup';
  return '';
}

// --- 3 and 4: the intro films -------------------------------------------------

function agentFilmPrompt({ agentFee = agentFeeLabel() } = {}) {
  return [
    '🎬 *Agent intro film*',
    '',
    `For an agent or broker who is not on makaug yet. They get the film and a short message: who sees their listings, how posting from WhatsApp works, and the plan (${agentFee} a month). It asks them to reply *AGENT*.`,
    '',
    'When they do, I tell them Ronald will call, and you both get a WhatsApp with their number.',
    '',
    'Who should it go to? Send:',
    '*Name | phone number*',
    'For example: Kato Brian | 0772123456',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

function ownerFilmPrompt({ ownerFee = ownerFeeLabel() } = {}) {
  return [
    '🎥 *Owner intro film*',
    '',
    `For someone selling or renting out *their own* property. They get the film and a short message: buyers call them direct, how listing works, and the fee (${ownerFee} a month per property). It asks them to reply *LIST*.`,
    '',
    'When they do, I send the how-to video and start their listing here on WhatsApp. You and Ronald hear when they reply, when they submit and when they pay.',
    '',
    'Who should it go to? Send:',
    '*Name | phone number*',
    'For example: Sarah Nakato | 0772123456',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

/**
 * Until 14 Nov 2026 the payment link was option 4, followed by 1 (registered)
 * or 2 (new prospect). Somebody with that in their fingers is now standing at
 * the owner film. Tell them, before a name and number sends the wrong film.
 */
function movedPayLinkNotice() {
  return [
    'The menu has changed: the *payment link* is now *6*.',
    '',
    'Reply *6* for the payment link.',
    'Or, for the owner intro film, send the *Name | phone number* of the owner.',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

function filmSentMessage({ kind = 'agent', name = '', phone = '', agentFee = agentFeeLabel(), ownerFee = ownerFeeLabel(), followUpMinutes = 15 } = {}) {
  const who = clean(name, 80) || phone;
  if (kind === 'owner') {
    return [
      `✅ *Owner film sent to ${who}* — ${phone}`,
      '',
      `They have the film and the message: buyers call them direct, how listing works, ${ownerFee} a month per property.`,
      '',
      'They have been asked to reply *LIST*. When they do, I send the how-to video and start their listing, and I tell you.',
      '',
      'They are on the Outreach list until they list.',
      '',
      `➡️ *Next owner?* Send their *Name | phone number* in the next ${followUpMinutes} minutes and the film goes straight out.`
    ].join('\n');
  }
  return [
    `✅ *Video sent to ${who}* — ${phone}`,
    '',
    `They have the joining film: what we do, who sees their listings, how listing works and the plan (${agentFee} a month).`,
    '',
    'They have been asked to reply *AGENT* if they want to join.',
    '',
    'When they say yes, reply *Agent 007* and choose *1* to register them.',
    '',
    'I am keeping them on the Outreach list until they sign up.',
    '',
    `➡️ *Next one?* Send their *Name | phone number* in the next ${followUpMinutes} minutes and the video goes straight out. No need for Agent 007 and 3.`
  ].join('\n');
}

// --- 5: the how-to-post videos -------------------------------------------------

function howToWhoPrompt() {
  return [
    '📘 *How-to-post video*',
    '',
    'Who is it for?',
    '',
    '*1* · An *agent* on makaug',
    '_They send photos and one caption. The film shows it step by step._',
    '*2* · A *private owner*',
    '_They reply LIST and answer a few short questions. The film shows each one._',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

function parseHowToWho(value = '') {
  if (exact(value, ['1', 'agent', 'an agent', 'broker'])) return 'agent';
  if (exact(value, ['2', 'owner', 'private owner', 'an owner', 'customer', 'normal person'])) return 'owner';
  return '';
}

function howToContactPrompt(kind = 'agent') {
  const who = kind === 'owner' ? 'the owner' : 'the agent';
  return [
    kind === 'owner' ? '📘 *How-to-list video, for an owner*' : '📘 *How-to-post video, for an agent*',
    '',
    `Send ${who}'s details:`,
    '*Name | phone number*',
    kind === 'owner' ? 'For example: Sarah Nakato | 0772123456' : 'For example: Kato Brian | 0772123456',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

function howToSentMessage({ kind = 'agent', name = '', phone = '' } = {}) {
  const who = clean(name, 80) || phone;
  if (kind === 'owner') {
    return [
      `✅ *How-to-list video sent to ${who}* — ${phone}`,
      '',
      'It shows the questions I ask, the photos to send, the review and the fee. It ends: reply *LIST* to start.',
      '',
      'When they reply LIST, I start their listing and tell you.'
    ].join('\n');
  }
  return [
    `✅ *How-to-post video sent to ${who}* — ${phone}`,
    '',
    'It shows one property from start to finish: photos, the caption, my confirmation, the review and the link when it is live.'
  ].join('\n');
}

// --- 6: the payment link -------------------------------------------------------

function payLinkWhoPrompt({ agentFee = agentFeeLabel(), ownerFee = ownerFeeLabel() } = {}) {
  return [
    '💳 *Send a payment link*',
    '',
    'Who is it for?',
    '',
    '*1* · An agent *already registered* on makaug',
    `_${agentFee} a month, against their profile._`,
    '*2* · A *new agent prospect*, not registered yet',
    `_${agentFee}. The agent intro film goes with it._`,
    '*3* · A *private owner* with a listing',
    `_${ownerFee} a month for that listing._`,
    '',
    'They pay by MoMo merchant code and I tell you the moment it lands.',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

function parsePayLinkWho(value = '') {
  if (exact(value, ['1', 'registered', 'yes', 'existing', 'already registered', 'agent', 'registered agent'])) return 'registered';
  if (exact(value, ['2', 'prospect', 'new', 'new prospect', 'not registered', 'no', 'new agent'])) return 'prospect';
  if (exact(value, ['3', 'owner', 'private owner', 'lister', 'private lister', 'listing'])) return 'owner';
  return '';
}

function payLinkOwnerPrompt() {
  return [
    '💳 *Payment link for a private owner*',
    '',
    'Send the owner\'s *phone number*, or the listing reference (MK-…).',
    'I will find their listing and show you before anything is sent.',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

function listingStateWord(row = {}, today = revenue.kampalaDate()) {
  const status = String(row.status || '').toLowerCase();
  const paid = revenue.isoDay(row.lister_paid_until);
  if (status === 'pending') return 'in review';
  if (status === 'sold') return 'sold';
  if (status === 'rejected') return 'not approved';
  if (status === 'hidden') return row.lister_billing_suspended_at ? 'taken down (unpaid)' : 'off the site';
  if (paid && paid >= today) return `live, paid until ${shortDay(paid)}`;
  if (paid) return `live, payment due since ${shortDay(paid)}`;
  return 'live, not paid yet';
}

function payLinkOwnerPickMessage(listings = []) {
  const lines = listings.map((row, index) => `*${index + 1}* · ${clean(row.title, 70) || 'Listing'} — ${listingStateWord(row)}`);
  const owner = clean(listings[0]?.lister_name, 60) || 'This owner';
  return [
    `${owner} has ${listings.length} ${listings.length === 1 ? 'listing' : 'listings'}:`,
    '',
    ...lines,
    '',
    listings.length === 1
      ? 'Reply *1* to send them the payment link for it, or *NO* to search again.'
      : 'Reply the number of the listing to send its payment link, or *NO* to search again.'
  ].join('\n');
}

function payLinkOwnerSentMessage({ listing = {}, url = '', code = '', amountLabel = ownerFeeLabel(), sentStatus = '' } = {}) {
  const ok = ['sent', 'queued', 'simulated'].includes(String(sentStatus || '').toLowerCase());
  return [
    ok ? `✅ *Payment link sent* — ${clean(listing.lister_name, 60) || 'the owner'}` : `⚠️ *The link was made but not sent* (${sentStatus || 'unknown'})`,
    '',
    `For: ${clean(listing.title, 80) || 'their listing'}`,
    `Link: *${code}*`,
    `Amount: ${amountLabel} a month`,
    url,
    '',
    ok
      ? 'They pay with the MoMo merchant code and reply with their name. I will tell you the moment it is paid.'
      : 'Forward the link to them yourself, or try again.'
  ].join('\n');
}

// --- 7: who still owes ---------------------------------------------------------

const OWING_AGENT_STATES = new Set(['never_paid', 'overdue', 'taken_down']);
const OWING_OWNER_STATES = new Set(['due', 'taken_down']);
const OWES_LIST_LIMIT = 30;
const OWES_LIST_OWNERS = 12;

/** The rows the list shows, in the order it numbers them: agents, then owners. */
function owesShownRows(rows = []) {
  const owners = rows.filter((row) => row.kind === 'owner').slice(0, OWES_LIST_OWNERS);
  const agents = rows.filter((row) => row.kind === 'agent').slice(0, OWES_LIST_LIMIT - owners.length);
  return [...agents, ...owners];
}
/** The final reminder waits this long after the due date, as it does in King. */
const FINAL_REMINDER_AFTER_DAYS = 7;

/**
 * Everyone with money due: agents on the monthly plan, and private owners with
 * a listing live. Agents first, the longest overdue at the top.
 */
async function whoOwes(db, { now = new Date() } = {}) {
  const billingOps = require('./billingOpsService');
  const [summary, listerRows] = await Promise.all([
    revenue.revenueSummary(db),
    billingOps.listerBillingRows(db)
  ]);
  const agentFee = Number(summary.fee_ugx || publishedPricing().agent.monthly_ugx);
  const ownerFee = Number(publishedPricing().owner_listing.monthly_ugx);
  const agents = (summary.billing || [])
    .filter((row) => OWING_AGENT_STATES.has(row.billing_state))
    .map((row) => ({
      kind: 'agent',
      id: String(row.id),
      name: clean(row.full_name, 80),
      company: clean(row.company_name, 80),
      phone: fullDigits(row.whatsapp || row.phone),
      state: row.billing_state,
      days_overdue: Number(row.days_overdue || 0),
      paid_until: row.paid_until || null,
      since: row.paid_until || (row.approved_at ? revenue.kampalaDate(new Date(row.approved_at)) : null),
      amount_ugx: Number(row.monthly_fee_ugx || agentFee),
      last_reminder_at: row.last_reminder_at || null,
      final_reminder_at: row.final_reminder_at || null
    }))
    .sort((a, b) => (a.state === 'taken_down') - (b.state === 'taken_down')
      || b.days_overdue - a.days_overdue
      || String(a.since || '').localeCompare(String(b.since || '')));
  const owners = (listerRows || [])
    .filter((row) => OWING_OWNER_STATES.has(row.billing_state))
    .map((row) => ({
      kind: 'owner',
      id: String(row.id),
      name: clean(row.lister_name, 80) || 'Private owner',
      title: clean(row.title, 90),
      phone: fullDigits(row.lister_phone),
      state: row.billing_state,
      days_overdue: Number(row.days_overdue || 0),
      paid_until: row.lister_paid_until || null,
      since: revenue.kampalaDate(new Date(row.reviewed_at || row.created_at || now)),
      amount_ugx: ownerFee,
      last_reminder_at: row.lister_billing_log?.reminder?.at || row.lister_billing_log?.views?.at || null,
      final_reminder_at: row.lister_billing_log?.final_reminder?.at || null
    }))
    .sort((a, b) => (a.state === 'taken_down') - (b.state === 'taken_down') || b.days_overdue - a.days_overdue);
  const rows = [...agents, ...owners];
  return {
    today: revenue.kampalaDate(now),
    rows,
    agents: agents.length,
    owners: owners.length,
    total_ugx: rows.reduce((sum, row) => sum + Number(row.amount_ugx || 0), 0)
  };
}

function owesStateLine(row = {}) {
  if (row.state === 'taken_down') return row.kind === 'agent' ? '⛔ paused, unpaid' : '⛔ taken down, unpaid';
  if (row.kind === 'agent') {
    if (row.state === 'never_paid') {
      const days = daysSince(row.since);
      return `never paid${row.since ? ` · approved ${shortDay(row.since)}${days == null ? '' : ` (${daysWord(days)}${days ? ' ago' : ''})`}` : ''}`;
    }
    return `${daysWord(row.days_overdue)} overdue · due ${shortDay(row.paid_until)}`;
  }
  if (row.paid_until) return `${daysWord(row.days_overdue)} overdue · paid until ${shortDay(row.paid_until)}`;
  const live = daysSince(row.since);
  return `not paid · live ${live == null ? '' : (live === 0 ? 'since today' : `${daysWord(live)}`)}`.trim();
}

function owesListMessage(report = {}) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  if (!rows.length) {
    return '✅ *Nobody owes anything right now.*\n\nEvery agent on the plan and every private listing is paid up.';
  }
  const shown = owesShownRows(rows);
  const lines = [`💰 *Who still owes* — ${shortDay(report.today)}`];
  let index = 0;
  const section = (kind, heading) => {
    const part = shown.filter((row) => row.kind === kind);
    if (!part.length) return;
    lines.push('', heading);
    for (const row of part) {
      index += 1;
      const what = kind === 'owner' && row.title ? ` · “${clean(row.title, 44)}”` : '';
      lines.push(`*${index}* · ${row.name}${what} — ${owesStateLine(row)}`);
    }
  };
  section('agent', `*AGENTS* · ${agentFeeLabel()} a month`);
  section('owner', `*PRIVATE OWNERS* · ${ownerFeeLabel()} a property`);
  lines.push('', `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${ugxLabel(report.total_ugx)} a month not coming in`);
  if (rows.length > shown.length) lines.push(`Showing ${shown.length} of them. The rest are in King › Sales & Revenue.`);
  lines.push('', 'Reply a *number* to open one and chase them. *CANCEL* closes it.');
  return lines.join('\n');
}

function reminderSentToday(at, now = new Date()) {
  if (!at) return false;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return false;
  return revenue.kampalaDate(when) === revenue.kampalaDate(now);
}

/** What can be sent to this person now: 1 the link, 2 a reminder, 3 the final reminder. */
function owesActions(row = {}, { now = new Date() } = {}) {
  const actions = [{ key: 'pay_link', label: 'Send the payment link again' }];
  if (row.state !== 'taken_down') {
    actions.push({ key: 'reminder', label: 'Send a reminder' });
    if (Number(row.days_overdue || 0) >= FINAL_REMINDER_AFTER_DAYS && !row.final_reminder_at) {
      actions.push({ key: 'final_reminder', label: 'Send the *final* reminder' });
    }
  }
  return actions.map((action) => ({ ...action, blocked: action.key !== 'pay_link' && reminderSentToday(action.key === 'final_reminder' ? row.final_reminder_at : row.last_reminder_at, now) }));
}

function payLinkStateWord(link = null) {
  if (!link) return 'none sent yet';
  if (link.status === 'paid') return `paid${link.paid_at ? ` ${shortDay(link.paid_at)}` : ''}`;
  if (link.claim_id) return 'they say they have paid, waiting for the MoMo SMS';
  if (link.opened_at) return `opened ${shortDay(link.opened_at)}, not paid`;
  if (link.sent_at) return `sent ${shortDay(link.sent_at)}, not opened yet`;
  return 'made, not sent';
}

function owesPersonMessage(row = {}, { payLink = null, now = new Date() } = {}) {
  const actions = owesActions(row, { now });
  const lines = [
    `👤 *${row.name}* · ${row.kind === 'agent' ? 'agent' : 'private owner'}${row.company && row.company !== row.name ? ` · ${row.company}` : ''}`,
    row.kind === 'owner' && row.title ? `🏠 ${row.title}` : '',
    row.phone ? `📞 ${prettyPhone(row.phone)} · https://wa.me/${row.phone}` : '📞 no WhatsApp number on file',
    `💳 ${owesStateLine(row)} · ${ugxLabel(row.amount_ugx)}`,
    `🔗 Payment link: ${payLinkStateWord(payLink)}`,
    `🔔 Last reminder: ${row.last_reminder_at ? shortDay(row.last_reminder_at) : 'none yet'}${row.final_reminder_at ? ` · final reminder ${shortDay(row.final_reminder_at)}` : ''}`,
    ''
  ].filter((line, index, all) => line !== '' || index === all.length - 1);
  actions.forEach((action, index) => {
    lines.push(`*${index + 1}* · ${action.label}${action.blocked ? ' _(one went today)_' : ''}`);
  });
  if (row.state === 'taken_down') lines.push('_Their listings are off the site. They go back up the moment they pay._');
  else lines.push('_Taking listings down stays in King › Sales & Revenue._');
  lines.push('*0* · Back to the list');
  return lines.join('\n');
}

// --- 8: look someone up ----------------------------------------------------------

function lookupPrompt() {
  return [
    '🔎 *Look someone up*',
    '',
    'Send a *phone number* or a *name*.',
    'I will show who they are on makaug, what they owe, their listings and what we have sent them.',
    '',
    '*CANCEL* to stop.'
  ].join('\n');
}

const PHONE_MATCH = (column) => `RIGHT(REGEXP_REPLACE(COALESCE(${column}, ''), '[^0-9]', '', 'g'), 9)`;

/** People matching a name: agents, private owners and prospects. One row per number. */
async function findPeopleByName(db, query = '', { limit = 6 } = {}) {
  const term = clean(query, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_\\]/g, '')}%`;
  const [agents, owners, prospects] = await Promise.all([
    db.query(
      `SELECT full_name AS name, company_name AS company, COALESCE(whatsapp, phone) AS phone, status, removed_at
         FROM agents
        WHERE full_name ILIKE $1 OR COALESCE(company_name, '') ILIKE $1
        ORDER BY (removed_at IS NULL) DESC, (status = 'approved') DESC, updated_at DESC LIMIT $2`,
      [like, limit]).catch(() => ({ rows: [] })),
    db.query(
      `SELECT DISTINCT ON (${PHONE_MATCH('lister_phone')}) lister_name AS name, lister_phone AS phone
         FROM properties
        WHERE agent_id IS NULL AND NOT ${foundOnlinePropertySql('properties')}
          AND lister_name ILIKE $1 AND COALESCE(lister_phone, '') <> ''
        ORDER BY ${PHONE_MATCH('lister_phone')}, created_at DESC LIMIT $2`,
      [like, limit]).catch(() => ({ rows: [] })),
    db.query(
      `SELECT full_name AS name, phone, status FROM agent_prospects WHERE full_name ILIKE $1 ORDER BY pitched_at DESC LIMIT $2`,
      [like, limit]).catch(() => ({ rows: [] }))
  ]);
  const seen = new Map();
  const add = (row, type) => {
    const key = phoneKey(row.phone);
    if (key.length !== 9 || seen.has(key)) return;
    seen.set(key, {
      type,
      name: clean(row.name, 80),
      company: clean(row.company, 80),
      phone: fullDigits(row.phone),
      note: type === 'agent'
        ? (row.removed_at ? 'former agent' : `agent, ${row.status}`)
        : (type === 'owner' ? 'private owner' : 'prospect')
    });
  };
  for (const row of agents.rows || []) add(row, 'agent');
  for (const row of owners.rows || []) add(row, 'owner');
  for (const row of prospects.rows || []) add(row, 'prospect');
  return [...seen.values()].slice(0, limit);
}

function lookupPickMessage(people = [], query = '') {
  return [
    `${people.length} people match “${clean(query, 40)}”:`,
    '',
    ...people.map((person, index) => `*${index + 1}* · ${person.name}${person.company && person.company !== person.name ? ` (${person.company})` : ''} — ${person.note} · …${String(person.phone).slice(-3)}`),
    '',
    'Reply the number, or send another name or phone number.'
  ].join('\n');
}

/** Everything makaug knows about one number, for the staff member looking them up. */
async function personDossier(db, phone = '') {
  const key = phoneKey(phone);
  if (key.length !== 9) return null;
  const typed = fullDigits(phone);
  const agent = (await db.query(
    `SELECT id, full_name, company_name, phone, whatsapp, status, paid_until, fee_exempt, removed_at, billing_suspended_at,
            approved_at, makaug_agent_number, registered_by_name
       FROM agents
      WHERE ${PHONE_MATCH('whatsapp')} = $1 OR ${PHONE_MATCH('phone')} = $1
      ORDER BY (removed_at IS NULL) DESC, (status = 'approved') DESC, created_at DESC LIMIT 1`,
    [key]).catch(() => ({ rows: [] }))).rows[0] || null;
  const [agentListings, ownListings, prospect, films, foundOnline] = await Promise.all([
    agent
      ? db.query(`SELECT LOWER(COALESCE(status, '')) AS status, COUNT(*)::int AS n FROM properties WHERE agent_id = $1::uuid GROUP BY 1`, [agent.id]).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT id, title, status, lister_name, lister_phone, lister_paid_until, lister_billing_suspended_at, inquiry_reference, created_at, reviewed_at
         FROM properties
        WHERE agent_id IS NULL AND NOT ${foundOnlinePropertySql('properties')}
          AND ${PHONE_MATCH('lister_phone')} = $1
          AND LOWER(COALESCE(status, '')) IN ('pending', 'approved', 'hidden', 'sold', 'rejected')
        ORDER BY created_at DESC LIMIT 6`,
      [key]).catch(() => ({ rows: [] })),
    db.query('SELECT * FROM agent_prospects WHERE phone_key = $1 LIMIT 1', [key]).catch(() => ({ rows: [] })),
    db.query(
      `SELECT created_at, details->>'kind' AS kind, details->>'sent_by' AS sent_by
         FROM audit_logs
        WHERE action = 'explainer_video_sent' AND created_at > NOW() - INTERVAL '120 days'
          AND RIGHT(regexp_replace(COALESCE(details->>'phone', ''), '\\D', '', 'g'), 9) = $1
        ORDER BY created_at DESC LIMIT 8`,
      [key]).catch(() => ({ rows: [] })),
    require('./foundOnlineListerPhone').isFoundOnlineListerPhone(db, key).catch(() => false)
  ]);
  const digits = fullDigits(agent?.whatsapp || agent?.phone || ownListings.rows[0]?.lister_phone || prospect.rows[0]?.phone || typed);
  const listingIds = (ownListings.rows || []).map((row) => row.id);
  const [payLink, lastMessages] = await Promise.all([
    db.query(
      `SELECT code, status, amount_ugx, sent_at, opened_at, paid_at, claim_id, purpose
         FROM pay_links
        WHERE ($2::uuid IS NOT NULL AND agent_id = $2::uuid)
           OR property_id = ANY($3::uuid[])
           OR ${PHONE_MATCH('payer_phone')} = $1
        ORDER BY created_at DESC LIMIT 1`,
      [key, agent?.id || null, listingIds]).catch(() => ({ rows: [] })),
    digits.length >= 9
      ? db.query(
        `SELECT direction, MAX(created_at) AS at FROM whatsapp_messages
          WHERE user_phone = ANY($1::text[]) AND created_at > NOW() - INTERVAL '120 days' GROUP BY 1`,
        [[digits, `+${digits}`]]).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] })
  ]);
  const counts = Object.fromEntries((agentListings.rows || []).map((row) => [row.status, Number(row.n || 0)]));
  const lastOf = (direction) => (lastMessages.rows || []).find((row) => row.direction === direction)?.at || null;
  return {
    phone: digits,
    agent,
    agent_listings: {
      live: (counts.approved || 0) + (counts.live || 0) + (counts.published || 0),
      pending: counts.pending || 0,
      sold: counts.sold || 0,
      hidden: counts.hidden || 0
    },
    own_listings: ownListings.rows || [],
    prospect: prospect.rows[0] || null,
    films: films.rows || [],
    pay_link: payLink.rows[0] || null,
    found_online: foundOnline === true,
    last_inbound_at: lastOf('inbound'),
    last_outbound_at: lastOf('outbound'),
    known: Boolean(agent || (ownListings.rows || []).length || prospect.rows[0] || (films.rows || []).length)
  };
}

const FILM_NAMES = Object.freeze({
  agent: 'agent intro film',
  owner: 'owner intro film',
  lister: 'how-to-list video',
  agent_howto: 'how-to-post video'
});

function agentMoneyLine(agent = {}, today = revenue.kampalaDate()) {
  const paid = revenue.isoDay(agent.paid_until);
  if (agent.removed_at) return 'account closed';
  if (agent.fee_exempt) return 'lists free (joined before the fee)';
  if (agent.billing_suspended_at) return '⛔ paused, fee unpaid';
  if (paid && paid >= today) return `✅ paid until ${shortDay(paid)}`;
  if (paid) return `❗ overdue since ${shortDay(paid)}`;
  return agent.status === 'approved' ? '❗ never paid' : 'nothing paid yet';
}

/** The actions offered under a dossier, in order. */
function lookupActions(dossier = {}) {
  if (!dossier || dossier.found_online || dossier.prospect?.do_not_contact) return [];
  const actions = [];
  const agent = dossier.agent && !dossier.agent.removed_at ? dossier.agent : null;
  const unpaidListing = (dossier.own_listings || []).find((row) => String(row.status).toLowerCase() === 'approved'
    && !(revenue.isoDay(row.lister_paid_until) >= revenue.kampalaDate()));
  if (agent && agent.status === 'approved' && !agent.fee_exempt && revenue.agentFeeRequired(agent)) {
    actions.push({ key: 'agent_pay_link', label: 'Send their payment link' });
  } else if (!agent && unpaidListing) {
    actions.push({ key: 'owner_pay_link', label: 'Send the payment link for their listing', listing_id: unpaidListing.id });
  }
  if (agent && agent.status === 'approved') actions.push({ key: 'agent_howto', label: 'Send the how-to-post video' });
  // An owner whose property is already with us has done what the video shows.
  else if (!agent && !(dossier.own_listings || []).some((row) => ['pending', 'approved'].includes(String(row.status).toLowerCase()))) {
    actions.push({ key: 'owner_howto', label: 'Send the how-to-list video' });
  }
  return actions;
}

function lookupCardMessage(dossier = null, { typed = '' } = {}) {
  if (!dossier || !dossier.known) {
    const shown = prettyPhone(dossier?.phone || typed) || clean(typed, 40);
    const lines = [`🔎 *${shown}* is not on makaug: no agent, no listing, and we have not sent them a film.`];
    if (dossier?.found_online) lines.push('', '⛔ This number is on a *found-online* listing. We never message those people.');
    else lines.push('', 'To send them a film: *Agent 007* → *3* (agent) or *4* (owner).');
    lines.push('', 'Send another name or number, or *CANCEL*.');
    return lines.join('\n');
  }
  const today = revenue.kampalaDate();
  const { agent, prospect } = dossier;
  const name = clean(agent?.full_name || dossier.own_listings[0]?.lister_name || prospect?.full_name, 80) || prettyPhone(dossier.phone);
  const lines = [`🔎 *${name}*`, `📞 ${prettyPhone(dossier.phone)} · https://wa.me/${dossier.phone}`];
  if (dossier.found_online) lines.push('⛔ On a *found-online* listing. We never message this number.');
  if (prospect?.do_not_contact) lines.push('⛔ Marked *do not contact again*.');
  if (agent) {
    const state = agent.removed_at ? `former agent (left ${shortDay(agent.removed_at)})` : `agent, ${agent.status}`;
    lines.push('', `👔 *${state}*${agent.company_name && agent.company_name !== agent.full_name ? ` · ${clean(agent.company_name, 60)}` : ''}${agent.makaug_agent_number ? ` · ${agent.makaug_agent_number}` : ''}`);
    lines.push(`💳 ${agentMoneyLine(agent, today)}`);
    const l = dossier.agent_listings;
    lines.push(`🏠 ${l.live} live · ${l.pending} in review${l.sold ? ` · ${l.sold} sold` : ''}${l.hidden ? ` · ${l.hidden} off the site` : ''}`);
    if (!agent.removed_at && agent.status === 'approved') lines.push(`🔗 https://makaug.com/agents/${agent.id}`);
  }
  if (dossier.own_listings.length) {
    lines.push('', agent ? '*Also listed privately:*' : '🏡 *Private owner*');
    for (const row of dossier.own_listings.slice(0, 4)) {
      lines.push(`• ${clean(row.title, 60) || 'Listing'} — ${listingStateWord(row, today)}${row.inquiry_reference ? ` (${row.inquiry_reference})` : ''}`);
    }
    if (dossier.own_listings.length > 4) lines.push(`• and ${dossier.own_listings.length - 4} more`);
  }
  if (dossier.pay_link) lines.push('', `🔗 Last payment link: ${payLinkStateWord(dossier.pay_link)}`);
  const sent = [];
  const seenKinds = new Set();
  for (const film of dossier.films) {
    if (seenKinds.has(film.kind)) continue;
    seenKinds.add(film.kind);
    sent.push(`${FILM_NAMES[film.kind] || film.kind} ${shortDay(film.created_at)}`);
  }
  if (sent.length) lines.push('', `🎬 Sent: ${sent.join(' · ')}`);
  if (prospect && !agent) {
    const labels = String(prospect.video_kind || 'agent') === 'owner'
      ? { pitched: 'no reply yet', interested: 'said LIST', signed_up: 'property in review', approved: 'property live', declined: 'said no', archived: 'archived' }
      : { pitched: 'no reply yet', interested: 'said yes', signed_up: 'signed up', approved: 'approved', declined: 'said no', archived: 'archived' };
    lines.push(`📋 Outreach: ${labels[prospect.status] || prospect.status}${prospect.pitched_by_name ? ` · sent by ${clean(prospect.pitched_by_name, 30)}` : ''}${prospect.metadata?.last_reply ? ` · they said “${clean(prospect.metadata.last_reply, 60)}”` : ''}`);
  }
  if (dossier.last_inbound_at || dossier.last_outbound_at) {
    lines.push('', `💬 Last from them: ${dossier.last_inbound_at ? shortDay(dossier.last_inbound_at) : 'never'} · last from us: ${dossier.last_outbound_at ? shortDay(dossier.last_outbound_at) : 'never'}`);
  }
  const actions = lookupActions(dossier);
  if (actions.length) {
    lines.push('');
    actions.forEach((action, index) => lines.push(`*${index + 1}* · ${action.label}`));
  }
  lines.push('', actions.length ? 'Reply a number, send another name or number, or *CANCEL*.' : 'Send another name or number, or *CANCEL*.');
  return lines.join('\n');
}

/** A private owner's listings by phone number or MK- reference, newest first. */
async function findOwnerListings(db, query = '') {
  const text = clean(query, 80);
  const reference = (text.match(/\bMK-\d{8}-[A-Z0-9]{6}\b/i) || [])[0] || '';
  const key = reference ? '' : phoneKey(text);
  if (!reference && key.length !== 9) return [];
  const result = await db.query(
    `SELECT id, title, status, lister_name, lister_phone, lister_paid_until, lister_billing_suspended_at, inquiry_reference, created_at
       FROM properties
      WHERE agent_id IS NULL AND NOT ${foundOnlinePropertySql('properties')}
        AND LOWER(COALESCE(status, '')) IN ('approved', 'pending', 'hidden')
        AND (($1 <> '' AND UPPER(COALESCE(inquiry_reference, '')) = UPPER($1))
          OR ($2 <> '' AND ${PHONE_MATCH('lister_phone')} = $2))
      ORDER BY (LOWER(status) = 'approved') DESC, created_at DESC LIMIT 6`,
    [reference, key]
  );
  return result.rows || [];
}

module.exports = {
  CONTROL_ROOM_STEPS,
  FINAL_REMINDER_AFTER_DAYS,
  agentFeeLabel,
  ownerFeeLabel,
  fullDigits,
  prettyPhone,
  phoneKey,
  controlRoomMenu,
  parseControlRoomChoice,
  agentFilmPrompt,
  ownerFilmPrompt,
  movedPayLinkNotice,
  filmSentMessage,
  howToWhoPrompt,
  parseHowToWho,
  howToContactPrompt,
  howToSentMessage,
  payLinkWhoPrompt,
  parsePayLinkWho,
  payLinkOwnerPrompt,
  payLinkOwnerPickMessage,
  payLinkOwnerSentMessage,
  listingStateWord,
  whoOwes,
  owesListMessage,
  owesShownRows,
  owesStateLine,
  owesActions,
  owesPersonMessage,
  payLinkStateWord,
  lookupPrompt,
  findPeopleByName,
  lookupPickMessage,
  personDossier,
  lookupActions,
  lookupCardMessage,
  findOwnerListings
};
