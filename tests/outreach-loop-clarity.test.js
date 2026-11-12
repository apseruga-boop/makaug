'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const db = require('../config/database');
const prospects = require('../services/agentProspectService');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

// A dialable shape: an eleven-digit or nine-digit-with-a-leading-0 number is refused (12 Nov 2026).
const PROSPECT_PHONE = '700000111';

function baseRow(overrides = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    full_name: 'Kasiita',
    phone: PROSPECT_PHONE,
    phone_key: PROSPECT_PHONE,
    status: 'pitched',
    pitched_at: '2026-11-12T08:00:00.000Z',
    pitched_by_name: 'Arthur',
    video_kind: 'agent',
    days_since_pitch: 0,
    do_not_contact: false,
    ...overrides
  };
}

function stubDb(handler) {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    const entry = { sql: String(sql), params };
    calls.push(entry);
    return handler(entry, calls);
  };
  return {
    calls,
    restore() { db.query = original; }
  };
}

test('Yes, No, No reply and Do not contact change the follow-up and the next step', () => {
  const yes = prospects.publicProspect(baseRow({ status: 'interested' }));
  assert.equal(yes.follow_up, 'Yes — they want to join');
  assert.equal(yes.loop_state, 'yes');
  assert.match(yes.next_step, /Call them/i);
  assert.match(yes.next_step, /Agent 007 option 1/i);
  assert.equal(yes.can_mark_called, true);
  assert.equal(yes.can_mark_registered, true);
  assert.equal(yes.can_recontact, false);

  const no = prospects.publicProspect(baseRow({ status: 'declined' }));
  assert.equal(no.follow_up, 'No — they said no');
  assert.equal(no.loop_state, 'closed_no');
  assert.match(no.next_step, /Closed — they said no/i);
  assert.match(no.next_step, /Do not send the same joining film again/i);
  assert.equal(no.can_recontact, false);
  assert.equal(no.can_reach_out_again, false);

  const waiting = prospects.publicProspect(baseRow({ status: 'pitched', days_since_pitch: 3 }));
  assert.equal(waiting.follow_up, 'No reply yet');
  assert.equal(waiting.loop_state, 'no_reply');
  assert.equal(waiting.days_ago, 3);
  assert.match(waiting.next_step, /3 days ago/);
  assert.match(waiting.next_step, /log a recontact/i);
  assert.equal(waiting.can_recontact, true);
  assert.equal(waiting.can_mark_called, false);

  const dnc = prospects.publicProspect(baseRow({ status: 'pitched', do_not_contact: true }));
  assert.equal(dnc.follow_up, 'Do not contact again');
  assert.equal(dnc.loop_state, 'closed_dnc');
  assert.match(dnc.next_step, /do not contact this person again/i);
  assert.match(dnc.next_step, /recontact is not offered/i);
  assert.equal(dnc.can_recontact, false);
});

test('Yes closes the loop: Called then Registered, each with a clear next step', async () => {
  let row = baseRow({ status: 'interested' });
  const stub = stubDb(({ sql, params }) => {
    if (/WHERE id = \$1/.test(sql) && /SELECT \*/.test(sql)) return { rows: [row] };
    if (/called_at = COALESCE/.test(sql)) {
      row = { ...row, called_at: '2026-11-12T10:00:00.000Z', called_by: params[1] };
      return { rows: [row] };
    }
    if (/registered_at = COALESCE/.test(sql)) {
      row = {
        ...row,
        registered_at: '2026-11-12T11:00:00.000Z',
        registered_by: params[1],
        status: 'signed_up'
      };
      return { rows: [row] };
    }
    return { rows: [] };
  });
  try {
    const called = prospects.publicProspect(await prospects.markNextStep(row.id, { action: 'called', actor: 'Arthur' }));
    assert.equal(called.loop_state, 'called');
    assert.equal(called.called_by, 'Arthur');
    assert.match(called.next_step, /Called — now register them/i);
    assert.equal(called.can_mark_called, false);
    assert.equal(called.can_mark_registered, true);
    const calledJson = JSON.stringify(called);
    assert.match(calledJson, /•••111/);
    assert.equal(called.phone_masked, '•••111');

    const registered = prospects.publicProspect(await prospects.markNextStep(row.id, { action: 'registered', actor: 'Ronald' }));
    assert.equal(registered.status, 'signed_up');
    assert.equal(registered.follow_up, 'Yes — they signed up');
    assert.equal(registered.registered_by, 'Ronald');
    assert.match(registered.next_step, /Approve them in the Agents tab/i);
    assert.equal(registered.can_mark_registered, false);
  } finally {
    stub.restore();
  }
});

test('Recontact records a follow-up without resending the joining film, and updates days-ago', async () => {
  const pitched = baseRow({
    status: 'pitched',
    pitched_at: '2026-11-08T08:00:00.000Z',
    days_since_pitch: 4
  });
  let current = { ...pitched };
  const stub = stubDb(({ sql, params }) => {
    if (/FROM properties|FROM short_term_listings/.test(sql)) return { rows: [] };
    if (/WHERE id = \$1/.test(sql) && /SELECT \*/.test(sql)) return { rows: [current] };
    if (/phone_key = \$1/.test(sql)) return { rows: [current] };
    if (/recontacted_at = NOW\(\)/.test(sql)) {
      current = {
        ...current,
        recontacted_at: '2026-11-12T09:00:00.000Z',
        recontacted_by: params[1],
        recontact_note: params[2] || 'Call them',
        recontact_count: 1
      };
      return { rows: [current] };
    }
    if (/INSERT INTO|sendAgentPitchVideo|explainer_video/.test(sql)) {
      throw new Error('recontact must not send or write a new pitch');
    }
    return { rows: [] };
  });
  try {
    const updated = await prospects.recontactProspect(pitched.id, { note: 'Call them', actor: 'Ronald' });
    const view = prospects.publicProspect(updated);
    assert.equal(view.recontact_count, 1);
    assert.equal(view.recontacted_by, 'Ronald');
    assert.equal(view.status, 'pitched');
    assert.equal(view.follow_up, 'No reply yet');
    assert.equal(view.days_ago, 0, 'days-ago moves to the recontact date');
    assert.equal(view.pitched_days_ago, 4);
    assert.match(view.next_step, /Recontact logged by Ronald/i);
    assert.match(view.next_step, /Do not send the same joining film again/i);
    assert.ok(stub.calls.every((c) => !/INSERT INTO agent_prospects|explainer_video_sent/.test(c.sql)));

    const blocked = await prospects.evaluateOutreachSend({ phone: PROSPECT_PHONE, videoKind: 'agent' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'already_sent');
    assert.match(blocked.message, /already been sent this video/i);
    assert.match(blocked.message, /Arthur/);
    assert.match(blocked.message, /Do not send the same video again/i);
  } finally {
    stub.restore();
  }
});

test('Recontact is refused after No or Do not contact again', async () => {
  for (const row of [
    baseRow({ status: 'declined' }),
    baseRow({ status: 'pitched', do_not_contact: true })
  ]) {
    const stub = stubDb(() => ({ rows: [row] }));
    try {
      await assert.rejects(() => prospects.recontactProspect(row.id, { actor: 'Arthur' }), /Recontact/);
    } finally {
      stub.restore();
    }
    assert.equal(prospects.canRecontact(row), false);
  }
});

test('setFollowUp maps the four desk buttons onto a closed-loop state', async () => {
  const mapping = [
    ['yes', 'interested', /they want to join/i],
    ['no', 'declined', /they said no/i],
    ['no_reply', 'pitched', /No reply yet/]
  ];
  for (const [button, status, follow] of mapping) {
    const stub = stubDb(({ params }) => ({
      rows: [baseRow({ status: params[1] })]
    }));
    try {
      const row = await prospects.setFollowUp('22222222-2222-2222-2222-222222222222', { status: button, actor: 'Arthur' });
      const view = prospects.publicProspect(row);
      assert.equal(row.status, status);
      assert.match(view.follow_up, follow);
    } finally {
      stub.restore();
    }
  }
});

test('sender names are shown, not a raw or masked phone, when the name is known', () => {
  const known = { '000000202': 'Arthur', '000000189': 'Ronald', '000000333': 'Nadia' };

  const arthur = prospects.publicProspect(baseRow({
    pitched_by_name: '',
    pitched_by: '000000202'
  }), {}, known);
  assert.equal(arthur.pitched_by_name, 'Arthur');
  assert.equal(arthur.sender_key, 'arthur');
  assert.doesNotMatch(arthur.pitched_by_name, /202/);

  const ronald = prospects.publicProspect(baseRow({
    pitched_by_name: '',
    pitched_by: '000000189',
    full_name: 'Namubiru'
  }), {}, known);
  assert.equal(ronald.pitched_by_name, 'Ronald');
  assert.equal(ronald.sender_key, 'ronald');

  const other = prospects.publicProspect(baseRow({
    pitched_by_name: '',
    pitched_by: '000000333',
    sender_account_name: 'Nadia'
  }), {}, known);
  assert.equal(other.pitched_by_name, 'Nadia');
  assert.equal(other.sender_key, 'other');

  const unknown = prospects.publicProspect(baseRow({
    pitched_by_name: '',
    pitched_by: '000000777'
  }), {}, known);
  assert.equal(unknown.pitched_by_name, '•••777');
  assert.equal(unknown.sender_key, 'other');

  const storedBeatsNumber = prospects.publicProspect(baseRow({
    pitched_by_name: 'Arthur',
    pitched_by: '000000777'
  }), {}, known);
  assert.equal(storedBeatsNumber.pitched_by_name, 'Arthur');

  const payload = JSON.stringify([arthur, ronald, other, unknown, storedBeatsNumber]);
  assert.doesNotMatch(payload, /000000202|000000189|000000333|000000777/);
});

test('known staff numbers from the existing film alerts resolve to Arthur and Ronald', () => {
  const film = require('../services/agentFilmReplyService');
  assert.equal(prospects.knownOutreachSenderName(film.ARTHUR_WHATSAPP), 'Arthur');
  const map = prospects.knownOutreachSenders();
  const ronaldKeys = Object.entries(map).filter(([, name]) => name === 'Ronald').map(([key]) => key);
  assert.ok(ronaldKeys.length >= 1);
  const row = prospects.publicProspect(baseRow({
    pitched_by_name: '',
    pitched_by: ronaldKeys[0]
  }));
  assert.equal(row.pitched_by_name, 'Ronald');
  assert.notEqual(row.pitched_by_name, `•••${ronaldKeys[0].slice(-3)}`);
  const json = JSON.stringify(row);
  assert.equal(json.includes(film.ARTHUR_WHATSAPP), false);
  assert.equal(json.includes(String(film.ARTHUR_WHATSAPP).replace(/\D/g, '')), false);
});

test('a stored sender name that is actually the prospect is ignored in favour of the staff name', () => {
  const known = { '000000202': 'Arthur' };
  assert.equal(prospects.nameForStorage({
    pitchedBy: '000000202',
    pitchedByName: 'Kasiita',
    prospectName: 'Kasiita'
  }, known), 'Arthur');
  assert.equal(prospects.nameForStorage({
    pitchedBy: '000000202',
    pitchedByName: '',
    prospectName: 'Kasiita'
  }, known), 'Arthur');
});

test('All / Arthur / Ronald / someone else filters return the named rows', () => {
  const known = { '000000202': 'Arthur', '000000189': 'Ronald' };
  const rows = [
    prospects.publicProspect(baseRow({ id: 'a', full_name: 'Kasiita', pitched_by_name: '', pitched_by: '000000202' }), {}, known),
    prospects.publicProspect(baseRow({ id: 'r', full_name: 'Namubiru', pitched_by_name: 'Ronald', pitched_by: '000000189' }), {}, known),
    prospects.publicProspect(baseRow({ id: 'o', full_name: 'Okello', pitched_by_name: 'Nadia', pitched_by: '000000333' }), {}, known)
  ];
  assert.deepEqual(prospects.filterOutreachRows(rows, { sender: 'all' }).map((r) => r.full_name), ['Kasiita', 'Namubiru', 'Okello']);
  assert.deepEqual(prospects.filterOutreachRows(rows, { sender: 'arthur' }).map((r) => r.full_name), ['Kasiita']);
  assert.deepEqual(prospects.filterOutreachRows(rows, { sender: 'ronald' }).map((r) => r.full_name), ['Namubiru']);
  assert.deepEqual(prospects.filterOutreachRows(rows, { sender: 'other' }).map((r) => r.full_name), ['Okello']);
  assert.equal(prospects.filterOutreachRows(rows, { sender: 'arthur' })[0].pitched_by_name, 'Arthur');
  assert.equal(prospects.filterOutreachRows(rows, { sender: 'ronald' })[0].pitched_by_name, 'Ronald');
});

test('King and staff Outreach share the closed-loop UI and the new desk routes', () => {
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  const routes = read('routes/outreachTracker.js');
  const whatsapp = read('routes/whatsapp.js');
  const migration = read('db/migrations/223_outreach_loop_clarity.sql');

  assert.match(html, /data-outreach-root="admin"/);
  assert.match(html, /data-outreach-root="staff"/);
  assert.match(html, /data-admin-tab-button="outreach"/);
  assert.match(html, /data-staff-tools-tab="outreach"/);

  assert.match(app, /function staffOutreachSenderFilter/);
  assert.match(app, /Sent by Arthur/);
  assert.match(app, /Sent by Ronald/);
  assert.match(app, /Sent by someone else/);
  assert.match(app, /staffOutreachMarkDone/);
  assert.match(app, /staffOutreachRecontact/);
  assert.match(app, /does not resend the joining film/);
  assert.match(app, /name="pitched_on"/);
  assert.match(app, /name="pitched_time"/);
  assert.match(app, /Which video, or where you sent it from/);
  assert.match(app, /mark Called or Registered/);
  assert.doesNotMatch(app, /name="pitched_at" type="datetime-local"/);

  assert.match(routes, /outreach-tracker\/:id\/next-step/);
  assert.match(routes, /outreach-tracker\/:id\/recontact/);
  assert.match(routes, /req\.query\.sender/);
  assert.equal(isStaffSharedKingTool('/outreach-tracker/abc/next-step', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/outreach-tracker/abc/recontact', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/outreach-tracker?sender=arthur', 'GET'), true);

  assert.match(whatsapp, /pitchedByName: staffNameForNumber\(phone\)/);
  assert.doesNotMatch(whatsapp, /pitchedByName: normalizeInput\(data\.employee_intake_last_subject_name/);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS called_at/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS registered_at/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS recontacted_at/);
  assert.doesNotMatch(migration, /INSERT INTO agent_prospects/);
  assert.doesNotMatch(migration, /UPDATE agent_prospects/);
});
