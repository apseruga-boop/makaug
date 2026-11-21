'use strict';
// Staff Leads & WhatsApp redesign (Arthur, approved 21 Nov 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const sl = require('../services/staffLeads');
const { registerStaffDeskRoutes } = require('../routes/staffDesk');
const seekers = require('../routes/staff-home-seekers');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ID = '11111111-2222-4333-8444-555555555501';
const ME = '11111111-2222-4333-8444-5555555555aa';

function withDb(handler, fn) {
  const orig = db.query; const origClient = db.getClient; const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); return { rows: handler(sql, params) || [] }; };
  db.getClient = undefined;
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; db.getClient = origClient; });
}
const lead = (o = {}) => ({ kind: 'lead', id: ID, lead_type: 'listing_owner', source: 'list_property_online', lead_status: 'open', lifecycle_stage: 'new', category: 'house', location: 'Kira', metadata: { title: 'a 3-bed house' }, created_at: new Date().toISOString(), contact_name: 'nakato mary', contact_phone: '+256700903512', ...o });

test('phones are masked to the last 3 digits and names to first name + initial', () => {
  assert.equal(sl.mask('+256700903512'), '•••512');
  assert.equal(sl.mask('makaug.com'), '');
  assert.equal(sl.dialOf('0700903512'), '+256700903512');
  assert.equal(sl.dialOf('700903512'), '+256700903512');
  assert.equal(sl.dialOf('makaug.com', '256700903907'), '+256700903907');
  assert.equal(sl.shortName('nakato mary'), 'Nakato M.');
  assert.equal(sl.shortName('Kato'), 'Kato');
});

test('a list-my-property lead reads like the mockup and its button is a call', () => {
  const it = sl.toItem(lead(), ME);
  assert.equal(it.who, 'Nakato M.');
  assert.equal(it.phone, '•••512');
  assert.equal(it.want, 'Wants to list a 3-bed house in Kira');
  assert.equal(it.source, 'Website · "List my property"');
  assert.equal(it.stage, 'new');
  assert.deepEqual([it.next.label, it.next.action, it.next.dial], ['Call to help them list', 'call', '+256700903512']);
  assert.equal(JSON.stringify(it).includes('wa.me'), false);
});

test('a no-match need gets "Text matches" with a makaug.com search link', () => {
  const it = sl.toItem(lead({ lead_type: 'property_need_unavailable', source: 'whatsapp_no_match', channel: 'whatsapp', lead_status: 'contacted', location: 'Ntinda', message: 'rent 2-bed in Ntinda up to 800k', metadata: {}, contact_name: 'Kato John', contact_phone: '+256700903907' }), ME);
  assert.equal(it.type, 'looking');
  assert.equal(it.stage, 'contacted');
  assert.equal(it.next.action, 'text');
  assert.match(it.next.sms, /makaug\.com\/to-rent\?area=Ntinda/);
});

test('an enquiry asks staff to call the owner; viewings and call-backs show their time', () => {
  const asked = sl.toItem(lead({ lead_type: 'enquiry', source: 'listing_detail_mobile_sticky_whatsapp', lead_status: 'handed_over', listing_ref: 'MK-A0C866', listing_title: '3-bed, Kira', lister_phone: '+256700900118', contact_phone: '+256700903330', contact_name: 'Achieng Sarah', metadata: {} }), ME);
  assert.equal(asked.type, 'asked');
  assert.equal(asked.next.button, '📞 Call owner');
  assert.equal(asked.next.dial, '+256700900118');
  assert.equal(asked.source, 'Listing page · WhatsApp button');
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const viewing = sl.toItem(lead({ lead_status: 'qualified', lifecycle_stage: 'viewing', next_follow_up_at: soon }), ME);
  assert.equal(viewing.stage, 'viewing');
  assert.match(viewing.next.label, /^Viewing /);
  const later = sl.toItem(lead({ next_follow_up_at: soon }), ME);
  assert.match(later.next.label, /^Call back booked /);
  assert.equal(sl.needsAction(later), false, 'a booked call-back is not due today');
  assert.equal(sl.needsAction(sl.toItem(lead(), ME)), true);
});

test('someone else\'s lead is not in my "needs action" and shows who has it', () => {
  const it = sl.toItem(lead({ assigned_to_user_id: ID, assigned_name: 'Amina Nalubega' }), ME);
  assert.equal(it.taken, true);
  assert.equal(it.taken_by, 'Amina N.');
  assert.equal(sl.needsAction(it), false);
});

test('desk drops leads with no phone and test data, counts filters, and masks chats', async () => {
  await withDb((sql) => {
    if (/FROM leads l\s+LEFT JOIN contacts/.test(sql)) {
      assert.match(sql, /COALESCE\(l\.is_test, FALSE\) = FALSE/);
      assert.match(sql, /deleted_at IS NULL/);
      return [lead(), lead({ id: '22222222-2222-4333-8444-555555555501', contact_phone: null, contact_name: 'No Phone' })];
    }
    if (/FROM saved_searches ss/.test(sql)) return [{ kind: 'alert', id: '33333333-2222-4333-8444-555555555501', lead_type: 'saved_search', source: 'alert_me_search', lead_status: 'open', lifecycle_stage: 'new', location: 'Bukoto', metadata: {}, alert_phone: '+256700903600', alert_label: 'Rent in Bukoto under 1m', created_at: new Date().toISOString() }];
    if (/whatsapp_messages m/.test(sql) && /DISTINCT ON/.test(sql)) {
      assert.match(sql, /direction = 'inbound'/);
      assert.match(sql, /NOT LIKE '%@g\.us'/, 'group chats are left out');
      return [{ id: ID, user_phone: '256700903118', message_type: 'text', body: 'I paid the fee this morning by MoMo', push_name: 'Grace', created_at: new Date().toISOString(), answered: false, contact_name: 'Namubiru Grace', lead_id: null }];
    }
    return [{ want_to_list_30d: 87, chats_week: 27 }];
  }, async () => {
    const d = await sl.desk({ userId: ME }, { filter: 'action' });
    assert.equal(d.items.length, 2, 'the no-phone lead is dropped');
    assert.ok(d.items.some((i) => i.key.startsWith('ss:')), 'alert-me searches are in the queue');
    assert.equal(d.counts.need_action, 2);
    assert.equal(d.counts.want_to_list_30d, 87);
    assert.equal(d.counts.chats_need_reply, 1);
    const c = d.chats[0];
    assert.equal(c.who, 'Namubiru G.');
    assert.equal(c.phone, '•••118');
    assert.equal(c.suggest.kind, 'paid');
    assert.match(c.suggest.tip, /Do not reply on WhatsApp/);
    assert.doesNotMatch(JSON.stringify(d), /wa\.me|whatsapp:\/\//);
    const shown = JSON.stringify(d, (k, v) => (['dial', 'owner_dial'].includes(k) ? undefined : v));
    assert.doesNotMatch(shown, /700903\d{3}/, 'no full phone anywhere but the dial link');
  });
});

test('suggested replies follow the rules: matches, said Hi, payments, listing, media', () => {
  assert.equal(sl.suggestFor('Hello, do you have 2 bedrooms in Ntinda below 800k?', 'Kato').kind, 'looking');
  assert.match(sl.suggestFor('do you have 2 bedrooms in Ntinda', 'Kato').sms, /makaug\.com\/to-rent\?area=Ntinda/);
  assert.equal(sl.suggestFor('Hi', '').kind, 'hi');
  assert.match(sl.suggestFor('Hi', '').tip, /Said Hi/);
  assert.equal(sl.suggestFor('I paid by MoMo', '').kind, 'paid');
  assert.equal(sl.suggestFor('I want to list my house', '').kind, 'list');
  assert.equal(sl.suggestFor('', '', 'voice').kind, 'media');
});

test('outcome refuses bad input before touching the database', async () => {
  await withDb(() => { throw new Error('db touched'); }, async () => {
    await assert.rejects(sl.outcome({ userId: ME }, ID, { outcome: 'send_whatsapp' }), /Pick an outcome/);
    await assert.rejects(sl.outcome({ userId: ME }, ID, { outcome: 'viewing' }), /day and time/);
    await assert.rejects(sl.outcome({}, ID, { outcome: 'spoke' }), /Sign in/);
    await assert.rejects(sl.outcome({ userId: ME }, "1' OR 1=1", { outcome: 'spoke' }), /Unknown lead/);
  });
});

test('outcome claims the lead, moves its stage and logs an activity', async () => {
  await withDb((sql) => (/^SELECT id, lead_status/.test(sql.trim()) ? [{ id: ID, lead_status: 'open', assigned_to_user_id: null }] : [{ id: ID, lead_status: 'qualified' }]), async (calls) => {
    await sl.outcome({ userId: ME }, ID, { outcome: 'viewing', at: '2026-11-24T07:00:00Z' });
    const upd = calls.find((c) => /^UPDATE leads/.test(c.sql.trim()));
    assert.match(upd.sql, /assigned_to_user_id = COALESCE\(assigned_to_user_id, \$2::uuid\)/);
    assert.match(upd.sql, /lifecycle_stage = 'viewing'/);
    assert.ok(upd.params.includes('qualified'));
    assert.ok(upd.params.includes('2026-11-24T07:00:00.000Z'));
    const act = calls.find((c) => /INSERT INTO lead_activities/.test(c.sql));
    assert.equal(act.params[2], 'moderator');
    assert.match(act.params[3], /Viewing booked/);
  });
  await withDb((sql) => (/^SELECT id, lead_status/.test(sql.trim()) ? [{ id: ID, lead_status: 'open', assigned_to_user_id: ID }] : []), async () => {
    await assert.rejects(sl.outcome({ userId: ME }, ID, { outcome: 'spoke' }), (e) => e.status === 409);
  });
});

test('add as lead dedupes on the phone and never sends anything', async () => {
  await withDb((sql) => {
    if (/FROM whatsapp_messages WHERE id/.test(sql)) return [{ id: ID, user_phone: '256700903777', body: 'I want to list my house in Najjera', push_name: 'Ssali Peter' }];
    if (/SELECT ld\.id FROM leads ld/.test(sql)) return [];
    if (/SELECT id FROM contacts/.test(sql)) return [];
    if (/INSERT INTO contacts/.test(sql)) return [{ id: 'c1' }];
    if (/INSERT INTO leads/.test(sql)) return [{ id: 'l1' }];
    return [];
  }, async (calls) => {
    const r = await sl.addFromChat({ userId: ME, name: 'Ronald' }, ID);
    assert.deepEqual(r, { lead_id: 'l1', existing: false });
    const ins = calls.find((c) => /INSERT INTO leads/.test(c.sql));
    assert.equal(ins.params[1], 'listing_owner');
    assert.equal(ins.params[3], ME, 'given to the person who added it');
    assert.equal(calls.some((c) => /whatsapp_outbox|INSERT INTO whatsapp_messages/i.test(c.sql)), false, 'nothing is queued to send');
  });
  await withDb((sql) => (/FROM whatsapp_messages WHERE id/.test(sql) ? [{ id: ID, user_phone: '256700903907', body: 'hi' }] : (/SELECT ld\.id/.test(sql) ? [{ id: 'old' }] : [])), async () => {
    assert.deepEqual(await sl.addFromChat({ userId: ME }, ID), { lead_id: 'old', existing: true });
  });
});

function fakeRouter() { const r = { routes: {} }; ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => { r[m] = (p, ...h) => { r.routes[`${m.toUpperCase()} ${p}`] = h[h.length - 1]; }; }); return r; }
function call(handler, req) { return new Promise((resolve) => { const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; handler(req, res, (e) => resolve({ code: 500, body: String(e) })); }); }

test('lead desk routes exist and a caller-only login gets 403', async () => {
  const r = fakeRouter(); registerStaffDeskRoutes(r);
  for (const k of ['GET /desk/leads', 'POST /desk/leads/from-chat', 'POST /desk/leads/:key/outcome']) assert.ok(r.routes[k], k);
  const caller = { adminAuth: { type: 'moderator' }, userAuth: { id: ME, profile_data: { staff_scope: 'caller' } }, query: {}, params: {}, body: {} };
  const out = await call(r.routes['GET /desk/leads'], caller);
  assert.equal(out.code, 403);
});

test('consent and alert previews are King-only; staff get masked home-seeker rows', () => {
  const t = seekers._test;
  assert.equal(t.isKingLogin({ staffAuth: { role: 'moderator' } }), false);
  assert.equal(t.isKingLogin({ staffAuth: { role: 'admin' } }), true);
  const masked = t.maskOverviewForStaff({ signups: [{ phone: '+256700903512', email: 'a@b.c' }], alerts: [{ phone: '+256700903600' }] });
  assert.equal(masked.signups[0].phone, '•••512');
  assert.equal(masked.signups[0].email, '');
  assert.equal(masked.alerts[0].phone, '•••600');
  const src = read('routes/staff-home-seekers.js');
  assert.match(src, /router\.post\('\/users\/:id\/marketing-consent-in-person', requireKing,/);
  assert.match(src, /router\.post\('\/whatsapp-alerts\/run', requireKing,/);
});

test('staff Leads page is the new page: no old sections, no wa.me, no bridge wording', () => {
  const sd = read('assets/staff-desk.js');
  assert.match(sd, /\['leads', '💬', 'Leads & WhatsApp', \[\], 1\]/);
  assert.match(sd, /NEW_PAGES = \[[^\]]*'leads'/);
  assert.match(sd, /'\/desk\/leads\?filter='/);
  assert.match(sd, /'sms:' \+ dial/);
  assert.match(sd, /'tel:' \+ dial/);
  assert.match(sd, /Add as lead/);
  assert.doesNotMatch(sd, /wa\.me|api\.whatsapp\.com/);
  assert.doesNotMatch(sd, /bridge|pairing state|consent-in-person/i);
  const app = read('assets/makaug-app.js');
  const legacy = app.slice(app.indexOf('function renderStaffLeads('), app.indexOf('// The shared found-online queue'));
  assert.doesNotMatch(legacy, /wa\.me/, 'legacy staff lead and chat cards have no WhatsApp links');
  assert.match(legacy, /staffIsKingLogin\(\) \?/, 'bridge wording is King-only');
  const hs = app.slice(app.indexOf('function staffHomeSeekersShell('), app.indexOf('async function saveStaffInPersonConsent('));
  assert.match(hs, /\$\{king \? `<button type="button" onclick="runStaffWhatsappDigestPreview\(\)"/);
  assert.match(hs, /\$\{!king \? `<span class="text-gray-600">/);
  assert.match(read('index.html'), /staff-desk\.js\?v=20261121-ops3/);
});

test('King keeps consent: Leads & WhatsApp has a Home seekers & consent chip', () => {
  const kd = read('assets/king-desk.js');
  assert.match(kd, /\['Home seekers & consent', 'whatsapp', 'seekers'\]/);
  assert.match(kd, /window\.loadKingHomeSeekers\(\)/);
  assert.match(read('index.html'), /<div id="king-home-seekers" data-admin-tab-panel="whatsapp"/);
  assert.match(read('assets/makaug-app.js'), /async function loadKingHomeSeekers\(\)/);
});

test('staff logins can reach exactly the lead desk routes', () => {
  const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
  const ok = (m, p) => isStaffSharedKingTool(p, m);
  assert.equal(ok('GET', '/desk/leads'), true);
  assert.equal(ok('POST', '/desk/leads/from-chat'), true);
  assert.equal(ok('POST', `/desk/leads/${ID}/outcome`), true);
  assert.equal(ok('POST', `/desk/leads/ss:${ID}/outcome`), true);
  assert.equal(ok('POST', '/desk/leads/x;drop/outcome'), false);
  assert.equal(ok('DELETE', '/desk/leads'), false);
});
