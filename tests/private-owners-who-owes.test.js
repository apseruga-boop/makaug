'use strict';

/**
 * Private owners on "Who still owes" (14 Nov 2026).
 *
 * Three rows on the list read "Private owner · “**1 acre of land…”" twice and
 * one named person, and nobody could say where they came from or find them in
 * King. They are website "List Property" submissions with no agent on them,
 * billed UGX 20,000 a month from approval. This covers what the list and King
 * now say about each one: whose it is, what it is, how and when it was listed,
 * what has been sent, and when the same listing was sent in twice.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';

const billing = require('../services/billingOpsService');
const controlRoom = require('../services/agent007ControlRoom');
const { stripMarkdownEmphasis, cleanPublicListingCopy } = require('../services/publicListingCopy');
const moderation = require('../services/listingModerationService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const dayOffset = (d) => new Date(Date.now() + 3 * 3600 * 1000 + d * 86400000).toISOString().slice(0, 10);

// An acre sent in twice, eight minutes apart, with no name typed on the form;
// and a plot from someone who said they were selling for the owner. The owners,
// their numbers, the listings and the prices in this file are invented.
const ACRE = {
  title: '**1 acre of land for sale – kiwatule, najjeera**', lister_name: null, lister_email: 'Owner@Example.com',
  status: 'approved', reviewed_at: daysAgo(32), lister_paid_until: null, lister_billing_log: { views: { at: daysAgo(25) } },
  source: 'website', listed_via: 'website', district: 'Wakiso', area: 'Najjeera', price: '150000000',
  public_display_name: 'Private lister', owner_confirmed: 'yes', contact_preference: 'phone'
};
const LISTERS = () => [
  { ...ACRE, id: 'p-copy', lister_phone: '+256 700 555 041', created_at: daysAgo(33), inquiry_reference: 'MK-COPY2' },
  { ...ACRE, id: 'p-first', lister_phone: '0700555041', created_at: new Date(Date.now() - 33 * 86400000 - 8 * 60000).toISOString(), inquiry_reference: 'MK-FIRST' },
  {
    id: 'p-plot', title: 'Plot for Sale in Gayaza', lister_name: 'Okello Peter', lister_phone: '0700555043', lister_email: '',
    status: 'approved', created_at: daysAgo(29), reviewed_at: daysAgo(28), lister_paid_until: null,
    lister_billing_log: { views: { at: daysAgo(26) }, reminder: { at: daysAgo(21) } },
    inquiry_reference: 'MK-PLOT', source: 'website', listed_via: 'website', district: 'Wakiso', area: 'Gayaza', price: 25000000,
    public_display_name: 'Hilltop Consult', owner_confirmed: 'agent', contact_preference: 'whatsapp'
  },
  { id: 'p-paid', title: 'Plot in Mukono', lister_name: 'Paid Owner', lister_phone: '0772999888', status: 'approved', created_at: daysAgo(9), reviewed_at: daysAgo(9), lister_paid_until: dayOffset(21), lister_billing_log: {}, price: 5000000, listed_via: 'whatsapp' }
];

function world({ listers = LISTERS(), agents = [], accounts = [{ email: 'owner@example.com', phone_tail: '700555041', name: 'MARY NAMULI' }] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/FROM billing_settings/.test(sql)) return { rows: [{ key: 'lister_fee', value: { free_days: 0, start_date: '2026-10-05', monthly_ugx: 20000 } }] };
      if (/FROM properties/.test(sql)) return { rows: listers };
      if (/FROM users/.test(sql)) return { rows: accounts };
      if (/FROM agents/.test(sql)) return { rows: agents };
      return { rows: [{}] };
    }
  };
}

// ---------------------------------------------------------------------------
// Stars from a pasted advert
// ---------------------------------------------------------------------------

test('stars and underscores from a pasted advert come off a title, and a size keeps its star', () => {
  assert.strictEqual(stripMarkdownEmphasis('**1 acre of land for sale – kiwatule, najjeera**'), '1 acre of land for sale – kiwatule, najjeera');
  assert.strictEqual(stripMarkdownEmphasis('*Hot deal* in Kira'), 'Hot deal in Kira');
  assert.strictEqual(stripMarkdownEmphasis('__Prime__ plot, _titled_'), 'Prime plot, titled');
  assert.strictEqual(stripMarkdownEmphasis('Plot 50*100 ft in Gayaza'), 'Plot 50*100 ft in Gayaza', 'a size is not emphasis');
  assert.strictEqual(stripMarkdownEmphasis('***Land for sale'), 'Land for sale', 'stars left open at the start');
  assert.strictEqual(stripMarkdownEmphasis('Land for sale**'), 'Land for sale', 'and at the end');
  assert.strictEqual(stripMarkdownEmphasis('house_with_garden'), 'house_with_garden', 'an underscore inside a word stays');
  assert.strictEqual(cleanPublicListingCopy('**1 acre of land** for sale'), '1 acre of land for sale', 'so the public page shows none');
  assert.strictEqual(billing.plainListingTitle('**1 acre of land for sale – kiwatule, najjeera**'), '1 acre of land for sale – kiwatule, najjeera');
  assert.strictEqual(billing.plainListingTitle('plot | titled | 50*100'), 'Plot, titled, 50*100');
  assert.strictEqual(billing.plainListingTitle(''), '');
});

test('the owner is told about their listing by its plain title', () => {
  const message = moderation.buildOwnerStatusMessage({ listing: { id: 'p1', title: '**1 acre of land**', lister_name: 'Mary' }, status: 'approved' });
  assert.strictEqual(message.subject, 'Your listing is live - 1 acre of land');
  assert.match(message.whatsapp, /\n1 acre of land - /);
  assert.doesNotMatch(`${message.whatsapp} ${message.text} ${message.html}`, /\*\*/, 'no doubled stars anywhere');
});

// ---------------------------------------------------------------------------
// Whose listing it is
// ---------------------------------------------------------------------------

test('a name: the one on the listing, then the account it was made from, never a stock label', () => {
  assert.strictEqual(billing.ownerNameFor({ lister_name: 'Okello Peter' }, 'Someone Else'), 'Okello Peter');
  assert.strictEqual(billing.ownerNameFor({ lister_name: '' }, 'MARY NAMULI'), 'Mary Namuli', 'a name typed in capitals reads as a name');
  assert.strictEqual(billing.ownerNameFor({ lister_name: 'Private lister', public_display_name: 'Private owner' }, ''), '');
  assert.strictEqual(billing.ownerNameFor({ lister_name: null, public_display_name: 'Hilltop Consult' }, ''), 'Hilltop Consult');
  assert.strictEqual(billing.ownerNameFor({ lister_name: 'N/A' }, "o'brien MARY"), "o'brien MARY", 'mixed case is left as typed');
});

test('each private listing says whose it is, what it is, how it was listed and whether it is a second copy', async () => {
  const db = world();
  const rows = await billing.listerBillingRows(db);
  const by = Object.fromEntries(rows.map((row) => [row.id, row]));

  // No name on the listing: the account it was listed from has one.
  assert.strictEqual(by['p-first'].owner_name, 'Mary Namuli');
  assert.strictEqual(by['p-copy'].owner_name, 'Mary Namuli');
  const lookup = db.calls.find((call) => /FROM users/.test(call.sql));
  assert.deepStrictEqual(lookup.params, [['owner@example.com'], ['700555041']], 'looked up by email and by the last nine digits, once');
  assert.strictEqual(by['p-plot'].owner_name, 'Okello Peter');

  assert.strictEqual(by['p-first'].plain_title, '1 acre of land for sale – kiwatule, najjeera');
  assert.strictEqual(by['p-first'].listed_how, 'website');
  assert.strictEqual(by['p-paid'].listed_how, 'whatsapp');
  assert.strictEqual(by['p-first'].listing_url, 'https://makaug.com/property/p-first');
  assert.strictEqual(by['p-first'].prefers_calls, true);
  assert.strictEqual(by['p-plot'].prefers_calls, false);
  assert.strictEqual(by['p-plot'].says_they_are, 'agent');
  assert.strictEqual(by['p-first'].says_they_are, '');
  assert.strictEqual(by['p-first'].has_email, true);
  assert.strictEqual(by['p-plot'].has_email, false);
  assert.ok(rows.every((row) => !('lister_email' in row)), 'the address itself does not travel');

  // The same person, the same title, the same price: the first one in is the listing.
  assert.strictEqual(by['p-first'].owner_key, by['p-copy'].owner_key, 'one person, however the number was typed');
  assert.strictEqual(by['p-first'].duplicate_of, null);
  assert.strictEqual(by['p-copy'].duplicate_of, 'p-first');
  assert.strictEqual(by['p-copy'].duplicate_ref, 'MK-FIRST');
  assert.strictEqual(by['p-plot'].duplicate_of, null);
});

test('the same title from two different people, or at two prices, is two listings', async () => {
  const listers = [
    { ...ACRE, id: 'a', lister_phone: '0700555041', created_at: daysAgo(10), inquiry_reference: 'MK-A' },
    { ...ACRE, id: 'b', lister_phone: '0700555042', lister_email: '', created_at: daysAgo(9), inquiry_reference: 'MK-B' },
    { ...ACRE, id: 'c', lister_phone: '0700555041', price: '180000000', created_at: daysAgo(8), inquiry_reference: 'MK-C' }
  ];
  const rows = await billing.listerBillingRows(world({ listers }));
  assert.deepStrictEqual(rows.map((row) => row.duplicate_of), [null, null, null]);
});

test('with no account to be found, the listing still comes back, just unnamed', async () => {
  const db = world({ accounts: [] });
  db.query = ((inner) => async (sql, params) => {
    if (/FROM users/.test(sql)) throw new Error('relation "users" does not exist');
    return inner(sql, params);
  })(db.query);
  const rows = await billing.listerBillingRows(db);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows.find((row) => row.id === 'p-first').owner_name, '');
});

test('a second copy never gets the automatic messages again', () => {
  const src = read('services/billingOpsService.js');
  const views = src.slice(src.indexOf('async function runListerViewsMessages'), src.indexOf('async function runListerDueReminders'));
  const reminders = src.slice(src.indexOf('async function runListerDueReminders'), src.indexOf("const FIRST_PAYMENT_TRACKED_FROM"));
  assert.match(views, /if \(p\.duplicate_of\) continue;/);
  assert.match(reminders, /if \(p\.duplicate_of\) continue;/);
});

// ---------------------------------------------------------------------------
// The list and the card (Agent 007 → 7)
// ---------------------------------------------------------------------------

test('who still owes counts people, bills a property once and puts a copy under its listing', async () => {
  const report = await controlRoom.whoOwes(world(), {});
  assert.deepStrictEqual(report.rows.map((row) => row.id), ['p-first', 'p-copy', 'p-plot']);
  assert.strictEqual(report.owners, 2, 'two people');
  assert.strictEqual(report.owner_listings, 2);
  assert.strictEqual(report.owner_copies, 1);
  assert.strictEqual(report.people, 2);
  assert.strictEqual(report.total_ugx, 40000, 'the acre is billed once');
  assert.strictEqual(report.owners_ugx, 40000);
  const [first, copy, plot] = report.rows;
  assert.strictEqual(first.name, 'Mary Namuli');
  assert.strictEqual(first.copies, 1);
  assert.deepStrictEqual(first.copy_references, ['MK-COPY2']);
  assert.strictEqual(copy.copy_of, 'p-first');
  assert.strictEqual(copy.amount_ugx, 0);
  assert.strictEqual(copy.state_line, 'second copy · not billed');
  assert.match(first.state_line, /^not paid · live 32 days$/);
  assert.strictEqual(plot.says_they_are, 'agent');
  assert.deepStrictEqual(controlRoom.owesActions(copy), [], 'nothing to send for a copy');

  const list = controlRoom.owesListMessage(report);
  assert.match(list, /\*1\* · Mary Namuli · “1 acre of land for sale – kiwatule, najjeera” — not paid · live 32 days/);
  assert.match(list, /\*2\* · Mary Namuli · the same listing sent in twice \(MK-COPY2\) — take this copy down/);
  assert.match(list, /\*3\* · Okello Peter · “Plot for Sale in Gayaza” — not paid · live 28 days/);
  assert.match(list, /2 people · UGX 40,000 a month not coming in/);
  assert.doesNotMatch(list, /\*\*1 acre|Private owner ·/, 'no stars, and nobody is just "Private owner"');
  assert.doesNotMatch(list, /0700555041|0700555043/, 'numbers stay off the list');
});

test('a copy whose first listing is paid for owes nothing and is still flagged', async () => {
  const listers = [
    { ...ACRE, id: 'paid-first', lister_phone: '0700555041', created_at: daysAgo(34), lister_paid_until: dayOffset(10), inquiry_reference: 'MK-PAID' },
    { ...ACRE, id: 'late-copy', lister_phone: '0700555041', created_at: daysAgo(33), inquiry_reference: 'MK-LATE' }
  ];
  const report = await controlRoom.whoOwes(world({ listers }), {});
  assert.deepStrictEqual(report.rows.map((row) => row.id), ['late-copy']);
  assert.strictEqual(report.rows[0].copy_of, 'paid-first');
  assert.strictEqual(report.total_ugx, 0);
  assert.strictEqual(report.people, 0, 'nobody owes money');
  assert.match(controlRoom.owesListMessage(report), /the same listing sent in twice \(MK-LATE\) — take this copy down/);
});

test('an owner with no name anywhere is told apart by the last three digits', async () => {
  const report = await controlRoom.whoOwes(world({ accounts: [] }), {});
  assert.strictEqual(report.rows[0].name, 'Private owner …041');
  assert.strictEqual(report.rows[0].named, false);
});

test('King can hand over what it already fetched, and nothing is fetched twice', async () => {
  const db = world();
  const listerRows = await billing.listerBillingRows(db);
  const before = db.calls.length;
  const report = await controlRoom.whoOwes(db, { summary: { billing: [], fee_ugx: 50000 }, listerRows });
  assert.strictEqual(db.calls.length, before, 'no query of its own');
  assert.strictEqual(report.people, 2);
});

test('the card says where the listing came from, what was sent and what to do next', async () => {
  const report = await controlRoom.whoOwes(world(), {});
  const [first, copy, plot] = report.rows;
  const quiet = { last_inbound_at: null, last_outbound_at: daysAgo(21) };

  const card = controlRoom.owesPersonMessage(first, { contact: quiet });
  assert.match(card, /👤 \*Mary Namuli\* · private owner/);
  assert.match(card, /🏠 1 acre of land for sale – kiwatule, najjeera/);
  assert.match(card, /UGX 150,000,000 · Najjeera, Wakiso · MK-FIRST/);
  assert.match(card, /https:\/\/makaug\.com\/property\/p-first/);
  assert.match(card, /📝 Listed on the website \d+ \w+ · approved \d+ \w+/);
  assert.match(card, /♻️ Sent in twice: a second copy is live too \(MK-COPY2\)/);
  assert.match(card, /\+256 700 555 041 · https:\/\/wa\.me\/256700555041/);
  assert.match(card, /the form says to reach them by phone call · email on file/);
  assert.match(card, /🔔 Sent so far: “seen by” message \d+ \w+/);
  assert.match(card, /💬 They have never replied on WhatsApp · we last wrote \d+ \w+/);
  assert.match(card, /☎️ Nothing we sent has been answered\. A phone call is the next step/);
  assert.match(card, /\*1\* · Send the payment link again/);

  const agentish = controlRoom.owesPersonMessage(plot, { contact: { last_inbound_at: daysAgo(2), last_outbound_at: daysAgo(21) } });
  assert.match(agentish, /🧑‍💼 Said they are an agent selling for the owner, shown as Hilltop Consult\. Worth offering the agent plan\./);
  assert.match(agentish, /Sent so far: “seen by” message \d+ \w+ · reminder \d+ \w+/);
  assert.match(agentish, /💬 They last wrote \d+ \w+/);
  assert.doesNotMatch(agentish, /Nothing we sent has been answered|phone call/, 'they do answer, and the form said WhatsApp');

  const second = controlRoom.owesPersonMessage(copy, { contact: quiet });
  assert.match(second, /♻️ \*This is a second copy\.\* The same listing, at the same price, from the same person: the first is MK-FIRST\./);
  assert.match(second, /open this copy in King › All Listings \(search MK-COPY2\) and press Unpublish/);
  assert.doesNotMatch(second, /Send the payment link|Send a reminder/, 'nothing to chase');
  assert.match(second, /\*0\* · Back to the list/);

  assert.strictEqual(controlRoom.ownerOriginLine({ listed_how: 'whatsapp', listed_at: '2026-10-12T05:00:00Z', approved_at: '2026-10-13T09:00:00Z' }), 'Listed on WhatsApp 12 Oct · approved 13 Oct');
  assert.strictEqual(controlRoom.ownerOriginLine({}), '');
  assert.strictEqual(controlRoom.contactLine(null), '');
  assert.match(controlRoom.contactLine({ last_inbound_at: null, last_outbound_at: null }), /never replied on WhatsApp · we have not written to them/);
});

// The list a member of staff really gets keeps its rows in their session, cut
// down to what the card needs. The first version of this card was built from
// the full rows and lost everything new on the way through the session: the
// copy was shown as owing UGX 0 with "Send the payment link again" under it.
test('through Agent 007 itself: the card is complete, and nothing can be sent for a second copy', async () => {
  const whatsappRoute = require('../routes/whatsapp');
  const route = whatsappRoute.__test;
  const appDb = require('../config/database');
  const RONALD = '+256709402189';
  const original = { query: appDb.query, getClient: appDb.getClient };
  const queued = [];
  let session = null;
  const listers = LISTERS();
  appDb.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      const blob = params.find((value) => typeof value === 'string' && value.trim().startsWith('{'));
      if (blob) session = JSON.parse(blob);
      return { rows: [] };
    }
    if (/INSERT INTO outbound_message_queue/i.test(sql)) { queued.push(params); return { rows: [{ id: `q-${queued.length}`, status: 'pending' }] }; }
    if (/FROM billing_settings/.test(sql)) return { rows: [{ key: 'lister_fee', value: { free_days: 0, start_date: '2026-10-05', monthly_ugx: 20000 } }] };
    if (/FROM properties\s+WHERE agent_id IS NULL AND NOT/.test(sql)) return { rows: listers };
    if (/FROM users/.test(sql)) return { rows: [{ email: 'owner@example.com', phone_tail: '700555041', name: 'MARY NAMULI' }] };
    if (/FROM revenue_entries/i.test(sql)) return { rows: [{}] };
    if (/FROM whatsapp_messages/.test(sql)) return { rows: [{ direction: 'outbound', at: daysAgo(25) }] };
    return { rows: [] };
  };
  appDb.getClient = async () => ({ query: appDb.query, release() {} });
  const step = (current, body, data = {}) => route.handleEmployeeWhatsappIntake({
    phone: RONALD, body, session: { current_step: current, session_data: { whatsapp_employee_intake: true, ...data } }
  });
  try {
    const list = await step('employee_intake_role', '7');
    assert.match(list.message, /\*1\* · Mary Namuli · “1 acre of land for sale – kiwatule, najjeera” — not paid/);
    assert.match(list.message, /\*2\* · Mary Namuli · the same listing sent in twice \(MK-COPY2\) — take this copy down/);
    const rows = session.owes_rows;
    assert.strictEqual(rows[1].copy_of, 'p-first', 'the session remembers it is a copy');
    assert.deepStrictEqual(rows[0].copy_references, ['MK-COPY2']);

    const card = await step('employee_owes_list', '1', { employee_role: 'owes', owes_rows: rows });
    assert.match(card.message, /UGX 150,000,000 · Najjeera, Wakiso · MK-FIRST/);
    assert.match(card.message, /https:\/\/makaug\.com\/property\/p-first/);
    assert.match(card.message, /📝 Listed on the website \d+ \w+ · approved \d+ \w+/);
    assert.match(card.message, /♻️ Sent in twice: a second copy is live too \(MK-COPY2\)/);
    assert.match(card.message, /the form says to reach them by phone call · email on file/);
    assert.match(card.message, /🔔 Sent so far: “seen by” message \d+ \w+/);
    assert.match(card.message, /💬 They have never replied on WhatsApp · we last wrote \d+ \w+/);
    assert.match(card.message, /☎️ Nothing we sent has been answered/);

    const copy = await step('employee_owes_list', '2', { employee_role: 'owes', owes_rows: rows });
    assert.match(copy.message, /♻️ \*This is a second copy\.\*[\s\S]*the first is MK-FIRST/);
    assert.doesNotMatch(copy.message, /Send the payment link|Send a reminder|UGX 0/);
    const before = queued.length;
    for (const reply of ['1', '2', '3']) {
      const refused = await step('employee_owes_person', reply, { employee_role: 'owes', owes_rows: rows, owes_selected: 1 });
      assert.match(refused.message, /Reply one of the numbers shown, or \*0\* to go back to the list/);
    }
    assert.strictEqual(queued.length, before, 'nothing was sent to the owner for the copy');
  } finally {
    appDb.query = original.query;
    appDb.getClient = original.getClient;
  }
});

// A reply that carries exactly one listing link is normally swapped for that
// listing's public card. The owner's chase card carries one, and on the test
// database it was the listing card that reached the member of staff, not the
// chase card.
test('the owner card reaches the member of staff as written, not swapped for the listing card', async () => {
  const route = require('../routes/whatsapp').__test;
  const appDb = require('../config/database');
  const LISTING = '22222222-3333-4444-8555-666666666666';
  const card = controlRoom.owesPersonMessage({
    kind: 'owner', id: LISTING, name: 'Okello Peter', title: 'Plot for Sale in Gayaza', reference: 'MK-PLOT',
    listing_url: `https://makaug.com/property/${LISTING}`, price_ugx: 25000000, where: 'Gayaza, Wakiso', phone: '256700555043',
    state: 'due', days_overdue: 22, since: '2026-10-17', amount_ugx: 20000, views_message_at: daysAgo(26), last_reminder_at: daysAgo(21)
  }, { contact: { last_inbound_at: null, last_outbound_at: daysAgo(21) } });
  assert.match(card, new RegExp(`https://makaug\\.com/property/${LISTING}`));
  const original = appDb.query;
  const inserted = [];
  appDb.query = async (sql, params = []) => {
    if (/INSERT INTO outbound_message_queue/i.test(sql)) { inserted.push(JSON.parse(params[1])); return { rows: [{ id: `q-${inserted.length}`, status: 'pending' }] }; }
    if (/FROM properties p/i.test(sql) && /property_images/i.test(sql)) {
      return { rows: [{ id: LISTING, title: '**Plot for Sale in Gayaza**', listing_type: 'sale', district: 'Wakiso', area: 'Gayaza', price: '25000000', price_period: 'once', extra_fields: {}, primary_image_url: 'https://media.makaug.com/plot.jpg' }] };
    }
    return { rows: [] };
  };
  try {
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256709402189', message: card, nextStep: 'employee_owes_person', inboundMessageId: 'in-owes-1' });
    assert.strictEqual(inserted.length, 1);
    assert.strictEqual(inserted[0].text, card, 'every word of the chase card');
    assert.ok(!inserted[0].media_url, 'and no listing photo stuck on it');
    // The same words to anybody else would still become the listing's card, which is why the rule is needed.
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256772123456', message: `Here it is: https://makaug.com/property/${LISTING}`, nextStep: 'main_menu', inboundMessageId: 'in-owes-2' });
    assert.match(inserted[1].text, /^🏡 Plot for Sale in Gayaza\n/, 'and that card shows the title without its stars');
    assert.ok(inserted[1].media_url);
  } finally {
    appDb.query = original;
  }
});

test('a payment link and its page name the listing without the stars', () => {
  const links = require('../services/payLinkService');
  assert.strictEqual(links.plainDescription('makaug listing — 1 month: **1 acre of land for sale – kiwatule, najjeera | northern bypass**'), 'makaug listing — 1 month: 1 acre of land for sale – kiwatule, najjeera | northern bypass');
  assert.strictEqual(links.plainDescription('makaug agent subscription — 1 month (Gilbert)'), 'makaug agent subscription — 1 month (Gilbert)');
  assert.strictEqual(links.plainDescription('Plot 50*100 ft'), 'Plot 50*100 ft');
  const source = read('services/payLinkService.js');
  assert.match(source, /`makaug listing — 1 month: \$\{billingOps\.plainListingTitle\(property\.title\) \|\| 'your property'\}`/, 'new links are made clean');
  assert.match(source, /`Payment for \*\$\{plainDescription\(link\.description\)\}\*`/, 'and old ones are cleaned as they are sent');
  assert.match(source, /description: plainDescription\(link\.description\),/, 'and on the page');
  assert.match(read('routes/pay.js'), /description: payLinks\.plainDescription\(link\.description\),/, 'and on the card');
});

test('the card asks WhatsApp history for when each side last wrote', () => {
  const src = read('routes/whatsapp.js');
  assert.match(src, /async function lastWhatsappContact\(phone/);
  assert.match(src, /controlRoom\.owesPersonMessage\(row, \{ payLink, contact \}\)/);
});

// ---------------------------------------------------------------------------
// King › Sales & Revenue
// ---------------------------------------------------------------------------

test('King is sent the same list Agent 007 reads out', () => {
  const src = read('routes/admin.js');
  const route = src.slice(src.indexOf("router.get('/revenue/summary'"), src.indexOf("router.post('/revenue/pay-links'"));
  assert.match(route, /\.whoOwes\(db, \{ summary, listerRows: listers \}\)/);
  assert.match(route, /who_owes: whoOwes/);
});

function loadRevenuePage() {
  const src = read('assets/makaug-app.js');
  const start = src.indexOf('function adminWhoOwesBlock(');
  const end = src.indexOf('\nfunction adminOpenMoneyEntry(', start);
  assert.ok(start > 0 && end > start);
  const box = { innerHTML: '' };
  const escape = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sandbox = {
    box,
    document: { getElementById: (id) => (id === 'admin-revenue-body' ? box : null) },
    adminRevenueData: null,
    adminEscape: escape,
    adminAttr: escape,
    adminFormatUgx: (v) => `UGX ${Number(v || 0).toLocaleString('en-US')}`,
    adminShortDate: (v) => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    adminPayLinksBlock: () => '',
    adminMoneyReconciledBlock: () => '',
    adminRevenueStatusBadge: () => '',
    publishedMarketplacePricing: () => ({ agent: { monthly_ugx: 50000 }, owner_listing: { monthly_ugx: 20000 }, short_stay: { monthly_ugx: 20000 } }),
    ADMIN_ACCOUNT_LABELS: {},
    ADMIN_METHOD_LABELS: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return sandbox;
}

test('King shows private owners in the cards, on one list with the agents, and in full in their table', async () => {
  const db = world();
  const listers = await billing.listerBillingRows(db);
  const summary = {
    fee_ugx: 50000,
    billing: [{ id: 'a1', full_name: 'Jane <b>Nakato', company_name: 'JN Homes', whatsapp: '+256701000111', billing_state: 'overdue', days_overdue: 12, paid_until: dayOffset(-12), monthly_fee_ugx: 50000 }],
    overdue_agents: 1
  };
  const whoOwes = await controlRoom.whoOwes(db, { summary, listerRows: listers });
  const page = loadRevenuePage();
  page.adminRevenueData = JSON.parse(JSON.stringify({ ...summary, month: {}, unverified: {}, settings: { lister_fee: { monthly_ugx: 20000, start_date: '2026-10-05' } }, listers, who_owes: whoOwes }));
  vm.runInContext('renderAdminRevenue()', page);
  const html = page.box.innerHTML;

  // The cards: owners beside agents, and the monthly total.
  assert.match(html, /Private owners unpaid<\/div><div class="text-xl font-black text-red-700">2<\/div><div[^>]*>2 listings \+ 1 second copy · UGX 40,000 a month/);
  assert.match(html, /Not coming in each month<\/div><div class="text-xl font-black text-red-700">UGX 90,000<\/div><div[^>]*>3 people · listed just below/);
  assert.match(html, /Agents overdue \/ unpaid<\/div><div class="text-xl font-black text-red-700">1<\/div><div[^>]*>UGX 50,000 a month/);

  // One list, numbered as on WhatsApp, above everything else that needs scrolling.
  const list = html.slice(html.indexOf('id="admin-who-owes"'), html.indexOf('id="admin-agent-fees"'));
  assert.match(list, /Who still owes — 3 people · UGX 90,000 a month not coming in/);
  assert.match(list, /1\.<\/span> <strong>Jane &lt;b&gt;Nakato<\/strong>/, 'names are escaped');
  assert.match(list, /2\.<\/span> <strong>Mary Namuli<\/strong>/);
  assert.match(list, /3\.<\/span> <strong>Mary Namuli<\/strong>[\s\S]*Second copy of MK-FIRST · not billed[\s\S]*unpublish this copy/);
  assert.match(list, /4\.<\/span> <strong>Okello Peter<\/strong>/);
  assert.match(list, /href="https:\/\/makaug\.com\/property\/p-first"[^>]*>1 acre of land for sale – kiwatule, najjeera<\/a> · MK-FIRST/);
  assert.match(list, /adminScrollTo\('#admin-private-listings'\)/);
  assert.ok(html.indexOf('id="admin-who-owes"') < html.indexOf('🧾'), 'above the claims, accounts and tables');

  // Their own table: who, what, how it got here, what has been sent.
  const table = html.slice(html.indexOf('id="admin-private-listings"'));
  assert.match(table, /an owner listed it on the website or on WhatsApp and the team approved it/);
  assert.match(table, /Mary Namuli · 0700555041 · email on file/);
  assert.match(table, /UGX 150,000,000 · Najjeera, Wakiso · MK-FIRST/);
  assert.match(table, /Listed on the website \d+ \w+ \d{4} · approved \d+ \w+ \d{4}/);
  assert.match(table, /Sent: “seen by” message \d+ \w+ \d{4} · reminder \d+ \w+ \d{4}/);
  assert.match(table, /Said they are an agent selling for the owner, shown on the site as Hilltop Consult\. Worth offering the agent plan\./);
  assert.match(table, /The form says to reach them by phone call\./);
  assert.doesNotMatch(table, /\*\*1 acre/, 'no stars from the pasted advert');

  // A second copy sits under its listing, is labelled, and nothing can be sent for it from here.
  const tableRows = table.split('<tr class="border-t border-gray-100 align-top">').slice(1);
  const firstCells = tableRows.find((row) => row.includes("adminListerPayment('p-first')"));
  const copyCells = tableRows.find((row) => row.includes('Second copy — not billed'));
  assert.ok(firstCells && copyCells);
  assert.strictEqual(tableRows.indexOf(copyCells), tableRows.indexOf(firstCells) + 1, 'the copy is the next row down');
  assert.match(firstCells, /Sent in twice: a second copy is live too \(MK-COPY2\)\. One fee covers the property\./);
  assert.match(firstCells, /adminListerMessage\('p-first', 'reminder'\)/);
  assert.match(copyCells, /MK-COPY2/);
  assert.match(copyCells, /The same listing, at the same price, from the same person as MK-FIRST\./);
  assert.doesNotMatch(copyCells, /adminListerMessage|adminCreatePayLink|adminListerPayment|adminListerTakeDown/, 'no reminder, pay link or payment for a copy');
  assert.match(copyCells, /Open the listing/);
});

test('King says so when nobody owes, and stays quiet when the list did not load', () => {
  const page = loadRevenuePage();
  page.adminRevenueData = { month: {}, unverified: {}, who_owes: { rows: [], people: 0, total_ugx: 0, owners: 0 } };
  vm.runInContext('renderAdminRevenue()', page);
  assert.match(page.box.innerHTML, /Nobody owes anything right now/);
  assert.match(page.box.innerHTML, /Private owners unpaid<\/div><div class="text-xl font-black text-gray-900">0</);
  page.adminRevenueData = { month: {}, unverified: {}, listers: [{ id: 'x', billing_state: 'due', days_overdue: 3 }] };
  vm.runInContext('renderAdminRevenue()', page);
  assert.doesNotMatch(page.box.innerHTML, /admin-who-owes/);
  assert.match(page.box.innerHTML, /Private owners unpaid<\/div><div class="text-xl font-black text-red-700">1</, 'counted from the table when the list is missing');
});

test('every class the new King markup uses is in the built stylesheet', () => {
  const css = read('assets/tailwind.css');
  const src = read('assets/makaug-app.js');
  const block = src.slice(src.indexOf('function adminWhoOwesBlock('), src.indexOf('\nfunction adminOpenMoneyEntry('));
  const wanted = ['lg:grid-cols-4', 'lg:grid-cols-2', 'grid-cols-1', 'scroll-mt-28', 'divide-y', 'divide-gray-100', 'gap-x-3', 'gap-y-1', 'border-red-200', 'border-amber-300', 'bg-amber-50', 'text-amber-900', 'text-amber-800', 'min-w-0', 'items-start'];
  for (const name of wanted) {
    assert.ok(block.includes(name), `${name} is used`);
    assert.ok(css.includes(`.${name.replace(/:/g, '\\:')}`), `${name} is in assets/tailwind.css`);
  }
});
