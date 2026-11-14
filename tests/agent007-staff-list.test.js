'use strict';

/**
 * Who can use Agent 007 (15 Nov 2026).
 *
 * Arthur: "we have a new employee working with us ... can you add her number
 * to agent 007 she will be doing the same as ronald".
 *
 * Until then the list was two numbers in the code. A third person is not added
 * there: this repository can be read by anyone, and a new member of staff
 * should not need a deploy. Arthur and Ronald stay built in; anyone else is
 * saved in King (Sales & Revenue › Settings › "Who else can use Agent 007"),
 * as a name and a full WhatsApp number.
 *
 * The people and numbers below are invented. The British number is from the
 * range kept for television, so it is nobody's.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';

const db = require('../config/database');
const intake = require('../services/whatsappEmployeeIntakeService');
const billing = require('../services/billingOpsService');
const senders = require('../services/outreachSenderName');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const ARTHUR = '+447757773202';
const RONALD = '+256709402189';
const NEW_STAFF = { name: 'Jane Example', phone: '+44 7700 900123' };
const NEW_STAFF_NUMBER = '447700900123';
const STRANGER = '+256700123616';

/** A database that holds only the billing settings; everything else is empty. */
async function withSettings(saved, run) {
  const original = { query: db.query, getClient: db.getClient };
  const state = { rows: saved === null ? [] : [{ key: 'agent007_staff', value: saved }], writes: [], sessions: [] };
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SELECT key, value FROM billing_settings/i.test(text)) return { rows: state.rows };
    if (/INSERT INTO billing_settings/i.test(text)) {
      state.writes.push({ key: params[0], value: JSON.parse(params[1]), by: params[2] });
      state.rows = [...state.rows.filter((row) => row.key !== params[0]), { key: params[0], value: JSON.parse(params[1]) }];
      return { rows: [] };
    }
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(text)) { state.sessions.push(params[1]); return { rows: [] }; }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  const before = process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  try {
    // The settings are kept for a minute: start from what this database holds.
    await billing.getSettings(db, { fresh: true });
    intake.rememberAgent007Staff([]);
    return await run(state);
  } finally {
    db.query = original.query;
    db.getClient = original.getClient;
    intake.rememberAgent007Staff([]);
    if (before === undefined) delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
    else process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = before;
  }
}

const at = (phone, step, body, data = {}) => route.handleEmployeeWhatsappIntake({ phone, body, session: { current_step: step, session_data: data } });

// ---------------------------------------------------------------------------
// The list itself
// ---------------------------------------------------------------------------

test('a saved member of staff is a name and a full number; anything else is handed back', () => {
  const { staff, rejected } = intake.parseAgent007Staff([
    { name: '  Jane   Example ', phone: '+44 7700 900123' },
    { name: 'Local Number', phone: '0772 123456' },
    { name: 'Typed with zeros', phone: '00 44 7700 900124' },
    { name: 'Jane again', phone: '447700900123' },
    { name: '', phone: '447700900125' },
    { name: 'Too Short', phone: '77009' },
    { name: 'No Country Code', phone: '7700900126' }
  ]);
  assert.deepStrictEqual(staff, [
    { name: 'Jane Example', phone: '447700900123' },
    { name: 'Local Number', phone: '256772123456' },
    { name: 'Typed with zeros', phone: '447700900124' },
    // Ten digits can be a whole number (Norway, Denmark), so it is kept as typed.
    // Without its country code it matches nobody: the person is refused, never somebody else let in.
    { name: 'No Country Code', phone: '7700900126' }
  ]);
  assert.deepStrictEqual(rejected, ['a line with no name', 'Too Short']);
  assert.strictEqual(intake.parseAgent007Staff([{ name: 'British, typed the local way', phone: '07700 900123' }]).rejected.length, 1, 'a leading 0 is not a country code');
  assert.deepStrictEqual(intake.parseAgent007Staff('Jane, 447700900123'), { staff: [], rejected: [] }, 'only a list is a list');
  assert.deepStrictEqual(intake.parseAgent007Staff(null), { staff: [], rejected: [] });
});

test('the saved number gets in, whole number for whole number, and nobody else does', () => {
  intake.rememberAgent007Staff([]);
  assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone, { allowlist: '' }), false, 'not before they are added');
  intake.rememberAgent007Staff([NEW_STAFF]);
  try {
    for (const typed of [NEW_STAFF.phone, NEW_STAFF_NUMBER, `${NEW_STAFF_NUMBER}@c.us`, `00${NEW_STAFF_NUMBER}`]) {
      assert.strictEqual(intake.employeeIntakePhoneAllowed(typed, { allowlist: '' }), true, typed);
    }
    assert.deepStrictEqual(intake.savedAgent007StaffFor(NEW_STAFF.phone), { name: 'Jane Example', phone: NEW_STAFF_NUMBER });
    // The last nine digits of a British number are the last nine of numbers elsewhere.
    for (const lookalike of ['+1 277 009 00123', '+255 700 900 123', '+256 700 900 123', '7700900123', '+44 7700 900124']) {
      assert.strictEqual(intake.employeeIntakePhoneAllowed(lookalike, { allowlist: '' }), false, lookalike);
      assert.strictEqual(intake.savedAgent007StaffFor(lookalike), null, lookalike);
    }
    // Arthur and Ronald are still built in, and a stranger is still a stranger.
    assert.strictEqual(intake.employeeIntakePhoneAllowed(ARTHUR, { allowlist: '' }), true);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(RONALD, { allowlist: '' }), true);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(STRANGER, { allowlist: '' }), false);
    // The environment list replaces the two built-in numbers, not the people added in King.
    assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone, { allowlist: '256700555001' }), true);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(RONALD, { allowlist: '256700555001' }), false);
  } finally {
    intake.rememberAgent007Staff([]);
  }
  assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone, { allowlist: '' }), false, 'taken off the list, refused again');
});

test('the code holds two numbers and no more: a third person is added in King', () => {
  const source = read('services/whatsappEmployeeIntakeService.js');
  const builtIn = source.match(/const DEFAULT_EMPLOYEE_INTAKE_NUMBERS = Object\.freeze\(\[([^\]]*)\]\);/);
  assert.ok(builtIn, 'the built-in list is where it was');
  assert.deepStrictEqual(builtIn[1].split(',').map((entry) => entry.trim()), ["'447757773202'", "'256709402189'"]);
  assert.match(read('.env.example'), /Staff added in King \(Sales &\n# Revenue > Settings > "Who else can use Agent 007"\) can use it either way/);
});

// ---------------------------------------------------------------------------
// Saving it in King
// ---------------------------------------------------------------------------

test('saving the list tidies it, and they can come in from their next message', async () => {
  await withSettings(null, async (state) => {
    assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone), false);
    await billing.setSetting(db, 'agent007_staff', [NEW_STAFF], 'admin:test');
    assert.deepStrictEqual(state.writes, [{ key: 'agent007_staff', value: [{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }], by: 'admin:test' }]);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone), true, 'no minute to wait');
    assert.deepStrictEqual((await billing.getSettings(db)).agent007_staff, [{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }]);
    // Emptied: nobody but Arthur and Ronald.
    await billing.setSetting(db, 'agent007_staff', [], 'admin:test');
    assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone), false);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(RONALD), true);
  });
});

test('a line that is not a name and a full number saves nothing at all', async () => {
  await withSettings([NEW_STAFF].map(() => ({ name: 'Jane Example', phone: NEW_STAFF_NUMBER })), async (state) => {
    await billing.loadAgent007Staff(db);
    for (const bad of [
      [{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }, { name: 'Half A Number', phone: '77009' }],
      [{ name: '', phone: '447700900124' }],
      'Jane, 447700900123',
      { name: 'Jane', phone: '447700900123' },
      null
    ]) {
      await assert.rejects(billing.setSetting(db, 'agent007_staff', bad, 'admin:test'), (error) => error.status === 400 && /Agent 007: each person needs a name and a WhatsApp number with its country code/.test(error.message));
    }
    assert.strictEqual(state.writes.length, 0);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(NEW_STAFF.phone), true, 'the list that was there still stands');
  });
});

test('only an admin can change it: it is not one of the tools staff share', () => {
  assert.strictEqual(isStaffSharedKingTool('/revenue/settings/agent007_staff', 'PUT'), false);
  assert.strictEqual(isStaffSharedKingTool('/revenue/settings/confirmers', 'PUT'), false);
});

// ---------------------------------------------------------------------------
// On WhatsApp
// ---------------------------------------------------------------------------

test('Agent 007 opens for the saved number and stays shut for everybody else', async () => {
  await withSettings([{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }], async () => {
    // Nothing has read the list yet in this process: the first message does.
    assert.strictEqual(intake.savedAgent007StaffList().length, 0);
    const menu = await at(NEW_STAFF.phone, 'main_menu', 'Agent 007');
    assert.strictEqual(menu.handled, true);
    assert.strictEqual(menu.nextStep, 'employee_intake_role');
    assert.match(menu.message, /Agent 007/);
    assert.deepStrictEqual(menu.message, (await at(RONALD, 'main_menu', 'Agent 007')).message, 'the same menu Ronald gets');

    const refused = await at(STRANGER, 'main_menu', 'Agent 007');
    assert.strictEqual(refused.nextStep, 'main_menu');
    assert.match(refused.message, /Agent 007 is for the makaug team only/);
    const lookalike = await at('+1 277 009 00123', 'main_menu', 'Agent 007');
    assert.match(lookalike.message, /Agent 007 is for the makaug team only/);
  });
});

test('taken off the list in King, the number is refused from its next message, even half way through', async () => {
  await withSettings([{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }], async (state) => {
    assert.strictEqual((await at(NEW_STAFF.phone, 'main_menu', 'Agent 007')).nextStep, 'employee_intake_role');
    await billing.setSetting(db, 'agent007_staff', [], 'admin:test');
    const refused = await at(NEW_STAFF.phone, 'employee_new_agent_details', 'Kato Brian/0772123456/Kato Homes/Wakiso', { employee_role: 'agent' });
    assert.strictEqual(refused.nextStep, 'main_menu');
    assert.match(refused.message, /Agent 007 is for the makaug team only/);
    assert.ok(state.sessions.includes('main_menu'), 'and what they had open is closed');
  });
});

test('with no list saved, or a database that cannot be read, Arthur and Ronald are untouched', async () => {
  await withSettings(null, async () => {
    assert.strictEqual((await at(RONALD, 'main_menu', 'Agent 007')).nextStep, 'employee_intake_role');
    assert.strictEqual((await at(ARTHUR, 'main_menu', 'Agent 007')).nextStep, 'employee_intake_role');
    assert.match((await at(NEW_STAFF.phone, 'main_menu', 'Agent 007')).message, /makaug team only/);
  });
  await withSettings([{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }], async () => {
    await route.refreshAgent007Staff();
    assert.strictEqual(intake.savedAgent007StaffList().length, 1);
    // Two minutes on, the settings kept in memory are too old to use, and the
    // database cannot be read: the list in hand stands.
    const working = db.query;
    const realNow = Date.now;
    let asked = 0;
    db.query = async (sql, params) => { if (/billing_settings/i.test(String(sql))) { asked += 1; throw new Error('database is away'); } return working(sql, params); };
    Date.now = () => realNow() + 2 * 60 * 1000;
    try {
      await route.refreshAgent007Staff();
      assert.ok(asked >= 1, 'it did try to read them');
      assert.strictEqual(intake.savedAgent007StaffList().length, 1);
      assert.strictEqual((await at(NEW_STAFF.phone, 'main_menu', 'Agent 007')).nextStep, 'employee_intake_role');
    } finally {
      Date.now = realNow;
      db.query = working;
    }
  });
});

test('they are staff from their first message: "I want to post houses" opens Agent 007, not the customer questions', async () => {
  await withSettings([{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }], async () => {
    await route.refreshAgent007Staff();
    assert.strictEqual(route.isStaffIntakeNumber({ phone: NEW_STAFF.phone, session: {} }), true);
    assert.strictEqual(route.isStaffIntakeNumber({ phone: STRANGER, session: {} }), false);
    assert.strictEqual(route.staffNameForNumber(NEW_STAFF.phone), 'Jane');
    // Their first hello brings the staff menu, which says how to start.
    assert.match(route.staffIntakeGreetingReply({ phone: NEW_STAFF.phone, session: {}, cleanBody: 'Hello' }), /\*Staff menu\*[\s\S]*reply \*Agent 007\*/);
    assert.strictEqual(route.staffIntakeGreetingReply({ phone: STRANGER, session: {}, cleanBody: 'Hello' }), '');
    assert.strictEqual(route.staffIntakeGreetingReply({ phone: '+1 277 009 00123', session: {}, cleanBody: 'Hello' }), '');
    const opened = await at(NEW_STAFF.phone, 'main_menu', 'I WANT TO POST HOUSES');
    assert.strictEqual(opened.nextStep, 'employee_intake_role');
    const stranger = await at(STRANGER, 'main_menu', 'I WANT TO POST HOUSES');
    assert.notStrictEqual(stranger.nextStep, 'employee_intake_role');
  });
});

// ---------------------------------------------------------------------------
// The key itself
// ---------------------------------------------------------------------------

test('the key is Agent 007 however a thumb types it, and it is still the whole message', () => {
  for (const typed of ['Agent 007', 'AGENT007', 'agent007', '  agent   007  ', 'Agent-007', 'Agent 007.', '“Agent 007”', '*Agent 007*', 'Agent OO7']) {
    assert.strictEqual(intake.isEmployeeIntakeTrigger(typed), true, typed);
  }
  for (const typed of ['Agent 007 please', '007', 'agent 0077', 'agent 07', 'my agent 007', 'agent 1007', 'agent', 'find an agent', 'Agent 007\nKato Brian']) {
    assert.strictEqual(intake.isEmployeeIntakeTrigger(typed), false, typed);
  }
  for (const typed of ['007', ' 007 ', 'OO7', '007.']) assert.strictEqual(intake.isEmployeeIntakeShortTrigger(typed), true, typed);
  for (const typed of ['7', '0007', '007 please', '1007', 'Kato Brian\n007']) assert.strictEqual(intake.isEmployeeIntakeShortTrigger(typed), false, typed);
});

test('AGENT007 from staff opens the menu, and so does 007 alone, but only for staff with nothing open', async () => {
  await withSettings([{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }], async () => {
    const menu = (await at(RONALD, 'main_menu', 'Agent 007')).message;
    // 14 Nov 2026: typed twice by a new member of staff, and answered "I think you meant: find a broker".
    for (const typed of ['AGENT007', 'agent007', 'Agent 007.', '007']) {
      const opened = await at(NEW_STAFF.phone, 'main_menu', typed);
      assert.strictEqual(opened.nextStep, 'employee_intake_role', typed);
      assert.strictEqual(opened.message, menu, `${typed}: the same menu`);
    }
    assert.strictEqual((await at(RONALD, 'main_menu', '007')).nextStep, 'employee_intake_role');
    assert.strictEqual((await at(ARTHUR, 'greeting', 'agent007')).nextStep, 'employee_intake_role');
    // With a question from the customer assistant left hanging in their session, as hers was.
    const hanging = await at(NEW_STAFF.phone, 'main_menu', 'AGENT007', { pending_intent_confirmation: { intent: 'agent_search' } });
    assert.strictEqual(hanging.nextStep, 'employee_intake_role');
    // Somebody else: the full key is refused as before, and 007 alone is not the key at all.
    assert.match((await at(STRANGER, 'main_menu', 'AGENT007')).message, /Agent 007 is for the makaug team only/);
    const stranger = await at(STRANGER, 'main_menu', '007');
    assert.notStrictEqual(stranger.nextStep, 'employee_intake_role');
    assert.doesNotMatch(String(stranger.message || ''), /makaug team only/, 'left to the ordinary assistant');
    // Half way through a step, 007 is part of what they are typing, not the key.
    const midway = await at(NEW_STAFF.phone, 'employee_agent_lookup', '007', { employee_role: 'agent' });
    assert.notStrictEqual(midway.message, menu);
  });
});

// ---------------------------------------------------------------------------
// By name, wherever Arthur and Ronald are named
// ---------------------------------------------------------------------------

test('what they send is put down to them by first name, and the desk can be filtered to them', () => {
  intake.rememberAgent007Staff([]);
  assert.deepStrictEqual(senders.staffSenderChoices(), [{ key: 'arthur', name: 'Arthur' }, { key: 'ronald', name: 'Ronald' }]);
  assert.strictEqual(senders.knownOutreachSenderName(NEW_STAFF.phone), '');
  intake.rememberAgent007Staff([NEW_STAFF, { name: 'Ronald Namesake', phone: '256700555010' }]);
  try {
    assert.deepStrictEqual(senders.staffSenderChoices(), [{ key: 'arthur', name: 'Arthur' }, { key: 'ronald', name: 'Ronald' }, { key: 'jane', name: 'Jane' }], 'first names only, and never a number');
    assert.strictEqual(senders.knownOutreachSenderName(NEW_STAFF.phone), 'Jane');
    assert.strictEqual(senders.knownOutreachSenderName(RONALD), 'Ronald');
    assert.strictEqual(senders.knownOutreachSenderName(ARTHUR), 'Arthur');
    assert.strictEqual(senders.resolveOutreachSenderName({ pitched_by: NEW_STAFF_NUMBER }), 'Jane');
    assert.strictEqual(senders.nameForStorage({ pitchedBy: NEW_STAFF_NUMBER, pitchedByName: '', prospectName: 'Kato Brian' }), 'Jane');
    assert.strictEqual(senders.senderBucket('Jane'), 'jane');
    assert.strictEqual(senders.senderBucket('Jane Example'), 'jane');
    assert.strictEqual(senders.senderBucket('Ronald Namesake'), 'ronald');
    assert.strictEqual(senders.senderBucket('Somebody Else'), 'other');
  } finally {
    intake.rememberAgent007Staff([]);
  }
  assert.strictEqual(senders.senderBucket('Jane'), 'other');
});

test('when they try the assistant out as a customer, it is not put on the lead desk as a lead', async () => {
  const desk = require('../services/leadDeskService');
  const asked = [];
  const fake = { query: async (sql) => { asked.push(String(sql)); return { rows: [{ value: [{ name: 'Ronald', phone: '256700555001' }] }, { value: [{ name: 'Jane Example', phone: NEW_STAFF_NUMBER }] }] }; } };
  await desk.loadExtraInternalPhones(fake);
  assert.match(asked[0], /WHERE key IN \('confirmers', 'agent007_staff'\)/);
  assert.ok(desk.internalPhoneKeys().includes(NEW_STAFF_NUMBER.slice(-9)), 'the saved member of staff');
  assert.ok(desk.internalPhoneKeys().includes('700555001'), 'and the people who confirm payments, as before');
  await desk.loadExtraInternalPhones({ query: async () => ({ rows: [] }) });
  assert.ok(!desk.internalPhoneKeys().includes(NEW_STAFF_NUMBER.slice(-9)));
});

test('King: the list is in the billing settings, and the Outreach desk takes its senders from the server', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /<span class="font-bold">Who else can use Agent 007<\/span>/);
  assert.match(app, /name="agent007_staff"/);
  assert.match(app, /Arthur and Ronald always can\. Anyone here also gets the team notices you and Ronald get: an agent or owner replying to a film, a new property waiting, a listing going live\. A change here takes effect within a minute: a new number can come in, and one taken out is refused\./);
  assert.match(app, /Saved only when the box was changed, so a page left open cannot put an old list back\./);
  assert.match(app, /await put\("agent007_staff", agent007List\.map\(\(\{ name, phone \}\) => \(\{ name, phone \}\)\)\);/);
  assert.match(app, /Agent 007: \$\{adminEscape\(\["Arthur", "Ronald", \.\.\./);
  // Arthur and Ronald keep their chips; anyone added in King gets one after them, from the server.
  assert.match(app, /moreSenders\.map\(\(s\) => chip\(s\.key, `Sent by \$\{s\.name\}`, sender, "staffOutreachSenderFilter"\)\)/);
  assert.match(app, /<option value="Ronald">Ronald<\/option>\$\{moreSenders\.map\(\(s\) => `<option value="\$\{adminAttr\(s\.name\)\}">\$\{adminEscape\(s\.name\)\}<\/option>`\)\.join\(""\)\}<option value="">Someone else<\/option>/);
  assert.match(app, /!\["arthur", "ronald", "other", "all"\]\.includes\(s\.key\)/, 'a key from the server is only ever letters and digits, and never one of the fixed chips');
  assert.match(read('routes/outreachTracker.js'), /senders: require\('\.\.\/services\/outreachSenderName'\)\.staffSenderChoices\(\)/);
  assert.match(read('services/agentProspectService.js'), /loadAgent007Staff\(db\)\.catch\(\(\) => null\);\n\s+const known = knownOutreachSenders\(\);/);
  // The messages are read with the list already in hand.
  const whatsapp = read('routes/whatsapp.js');
  assert.match(whatsapp, /getWhatsappConversationControl\(phone\),\n\s+\/\/ Who is staff, before anything below treats this number as a customer's\.\n\s+refreshAgent007Staff\(\)/);
  assert.match(whatsapp, /await refreshAgent007Staff\(\);\n\s+if \(!employeeIntakePhoneAllowed\(phone, \{ ownerAuthorized: isAiCeoOwnerPhone\(phone\) \}\)\) \{\n\s+return res\.status\(403\)/);
});

test.after(async () => {
  await db.pool?.end?.().catch?.(() => {});
});
