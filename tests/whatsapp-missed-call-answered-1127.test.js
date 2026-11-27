'use strict';

/**
 * 27 Nov 2026. Arthur sent a photo of the phone's Calls tab: six people had
 * rung the makaug number since 4 Nov, two of them twice, and makaug knew of
 * none of them. Now a missed call reaches makaug (the bridge, see
 * services/waha-bridge/calls.js on its branch), Arthur and Ronald are told who
 * rang and how to call back, and the caller is sent one kind message: sorry we
 * missed your call, someone will call you back, or write what you need here.
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const desk = require('../services/leadDeskService');
const bridge = require('../services/whatsappWebBridgeService');

const CALLER = '256700000161';

function withEnv(values, run) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return Promise.resolve(run()).finally(() => {
    for (const [key, old] of Object.entries(previous)) {
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  });
}

function withDb(answer, run) {
  const saved = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    const out = answer(String(sql), params);
    return out || { rows: [], rowCount: 0 };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = saved; });
}

test('the caller is sent one short, kind message; at night the call back is in the morning', () => {
  const day = route.missedCallCallerReply({ greeting: 'Testa', at: new Date('2026-11-27T10:02:00Z') });
  assert.strictEqual(day, [
    'Hi Testa 👋 Sorry we missed your call.',
    '',
    'Someone from our team will call you back shortly. Or, if it\'s easier, reply here with what you need and I\'ll help straight away.',
    '',
    'Phillip, makaug.com'
  ].join('\n'));
  // 23:30 and 06:10 in Kampala.
  for (const at of ['2026-11-27T20:30:00Z', '2026-11-28T03:10:00Z']) {
    const night = route.missedCallCallerReply({ at: new Date(at) });
    assert.match(night, /^Hi 👋 Sorry we missed your call\./);
    assert.match(night, /will call you back in the morning\./);
  }
  assert.doesNotMatch(day, /https?:|\+?\d{9,}/, 'no link and no number in it');
});

test('the team is told who rang, when, how often today, what the caller was told, and how to call back', async () => {
  await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: 'off' }, () => withDb(() => null, async () => {
    const result = await desk.alertTeamMissedCall(db, {
      phone: CALLER, contactName: 'Testa Caller', callType: 'voice', status: 'missed', at: new Date('2026-11-27T10:02:00Z'),
      caller: { kind: 'new' }, callsToday: 2, told: 'They have been sent: "Sorry we missed your call. Someone from our team will call you back."',
      extraRecipients: ['256700000997']
    });
    assert.deepStrictEqual(result.results.map((r) => r.to), ['256700000001', '256700000997'], 'Arthur and Ronald');
    assert.strictEqual(result.body, [
      '📞 *Missed WhatsApp call: please call them back*',
      'Testa Caller · number ending 161',
      'Called Fri 27 Nov, 13:02 Kampala, not answered (2nd call today)',
      'New: has never written to makaug.',
      'They have been sent: "Sorry we missed your call. Someone from our team will call you back."',
      `Call back: https://wa.me/${CALLER}`
    ].join('\n'));
  }));
  const who = (caller) => desk.missedCallWho(caller);
  assert.strictEqual(who({ kind: 'agent', agentNumber: 'MKA-AG-0000001' }), 'An agent (MKA-AG-0000001).');
  assert.strictEqual(who({ kind: 'former_agent', removedAt: '2026-11-23T14:11:00Z' }), 'A former agent, removed 23 Nov.');
  assert.strictEqual(who({ kind: 'customer', wroteAt: '2026-11-25T08:13:00Z' }), 'Has written to us before (last on Wed 25 Nov).');
  assert.strictEqual(who({}), '');
});

test('a call whose number WhatsApp kept hidden still reaches the team, without a made-up number', async () => {
  await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: 'off' }, () => withDb(() => null, async () => {
    const result = await desk.alertTeamMissedCall(db, { phone: '', callType: 'video', status: 'missed', at: new Date('2026-11-27T10:02:00Z'), numberHidden: true });
    assert.strictEqual(result.body, [
      '📞 *Missed WhatsApp video call: please call them back*',
      'Someone · WhatsApp did not share their number',
      'Called Fri 27 Nov, 13:02 Kampala, not answered',
      'Their number is in the Calls tab on the makaug phone.'
    ].join('\n'));
  }));
  assert.strictEqual(route.rememberHiddenNumberCall('HIDDEN-1'), true);
  assert.strictEqual(route.rememberHiddenNumberCall('HIDDEN-1'), false, 'told once per call');
});

test('who rang: an agent, a former agent, somebody who has written, or somebody new', async () => {
  const agentRow = { id: '0f0f0f0f-0000-4000-8000-000000000161', full_name: 'Testa Agent', greeting_name: 'Testa', makaug_agent_number: 'MKA-AG-0000161', status: 'approved' };
  await withDb((sql) => (/FROM agents\s+WHERE removed_at IS NULL/i.test(sql) ? { rows: [agentRow] } : null), async () => {
    const caller = await route.whoIsCalling(CALLER, { contactName: 'Whatever' });
    assert.deepStrictEqual([caller.kind, caller.name, caller.greeting, caller.agentNumber], ['agent', 'Testa Agent', 'Testa', 'MKA-AG-0000161']);
  });
  await withDb((sql) => (/ORDER BY \(removed_at IS NULL\) DESC/i.test(sql) ? { rows: [{ ...agentRow, removed_at: '2026-11-23T14:11:00Z' }] } : null), async () => {
    const caller = await route.whoIsCalling(CALLER, {});
    assert.deepStrictEqual([caller.kind, caller.greeting], ['former_agent', 'Testa']);
  });
  await withDb(() => null, async () => {
    const known = await route.whoIsCalling(CALLER, { contactName: 'Mr Property', inquiryContext: { recentMessages: [{ text: 'Hello', createdAt: '2026-11-25T08:13:00Z' }] } });
    assert.deepStrictEqual([known.kind, known.name, known.greeting], ['customer', 'Mr Property', ''], 'a WhatsApp name is shown to the team, not used to greet');
    const fresh = await route.whoIsCalling(CALLER, { contactName: 'Mr Property' });
    assert.strictEqual(fresh.kind, 'new');
  });
});

test('the caller is not messaged when the number is paused, on the never-message list, or was answered today', async () => {
  const at = new Date('2026-11-27T10:02:00Z');
  await withDb((sql) => (/FROM billing_settings/.test(sql) ? { rows: [{ value: { tails: [CALLER.slice(-9)] } }] } : null), async () => {
    const reply = await route.missedCallReplyFor({ phone: CALLER, caller: { kind: 'new' }, at });
    assert.deepStrictEqual(reply, { message: '', told: 'Not messaged: their number is paused.' });
  });
  await withDb(() => null, async () => {
    const reply = await route.missedCallReplyFor({ phone: CALLER, caller: { kind: 'agent', fullName: 'Promise Ahimbisibwe' }, at });
    assert.strictEqual(reply.message, '');
    assert.match(reply.told, /never-message list/);
  });
  await withDb((sql) => (/message_kind' = 'missed_call_reply'/.test(sql) ? { rows: [{ '?column?': 1 }] } : null), async (calls) => {
    const reply = await route.missedCallReplyFor({ phone: CALLER, caller: { kind: 'new' }, at });
    assert.strictEqual(reply.message, '');
    assert.match(reply.told, /earlier today/);
    const check = calls.find((c) => /missed_call_reply/.test(c.sql));
    assert.match(check.sql, /created_at >= NOW\(\) - INTERVAL '24 hours'/);
  });
  await withDb(() => null, async () => {
    const reply = await route.missedCallReplyFor({ phone: CALLER, caller: { kind: 'agent', greeting: 'Testa', fullName: 'Testa Agent' }, at });
    assert.match(reply.message, /^Hi Testa 👋 Sorry we missed your call\./);
  });
});

test('ringing again within half an hour is not news, and the count is of today in Kampala', async () => {
  await withDb((sql) => (/IS DISTINCT FROM/.test(sql) ? { rows: [{ '?column?': 1 }] } : null), async (calls) => {
    assert.strictEqual(await route.missedCallToldRecently(CALLER, 'CALL-2'), true);
    assert.match(calls[0].sql, /\(\$4::text \|\| ' minutes'\)::interval/);
    assert.strictEqual(calls[0].params[3], '30');
  });
  await withDb((sql) => (/COUNT\(\*\)::int AS n FROM whatsapp_call_events/.test(sql) ? { rows: [{ n: 3 }] } : null), async (calls) => {
    assert.strictEqual(await route.missedCallsToday(CALLER, new Date('2026-11-27T22:30:00Z')), 3);
    assert.strictEqual(calls[0].params[2], '2026-11-27T21:00:00.000Z', 'midnight in Kampala on the 28th, the call\'s day there');
  });
});

test('the answer to a call may go to somebody who has never written, but only while the call is fresh', () => {
  const sql = bridge.hasWrittenSql('q');
  assert.match(sql, /AND m\.message_type <> 'call'/, 'a call is still not a message');
  assert.match(sql, /AND \(m\.message_type <> 'call' OR m\.created_at >= NOW\(\) - INTERVAL '2 hours'\)/);
});

test('a quiet member of the team is noticed: the others are asked, once a day, to get them to write', async () => {
  const sent = [];
  const deliver = async (msg) => { sent.push(msg); return { status: 'queued' }; };
  const rule = { onlyToPeopleWhoWrote: () => true, wroteWithinDays: () => 7, hasWrittenToUs: async (to) => !String(to).endsWith('000997') };
  let marked = true;
  await withEnv({ AGENT_HELP_CONTACT_NAME: 'Ronald', AGENT_HELP_CONTACT_PHONE: '+256700000997' }, () => withDb((sql) => (/team_quiet_warned_at/.test(sql) ? { rows: marked ? [{ phone: '256700000997' }] : [] } : null), async () => {
    const first = await desk.warnAboutQuietTeamMembers(db, ['256700000001', '256700000997'], { bridge: rule, deliver });
    assert.deepStrictEqual(first, { quiet: 1, told: 1 });
    assert.deepStrictEqual(sent.map((m) => m.to), ['256700000001'], 'told to the one who can be reached');
    assert.strictEqual(sent[0].body, [
      '⚠️ *Ronald isn\'t getting the team notes*',
      'Ronald hasn\'t written to the makaug number in the last 7 days. To keep the number safe from WhatsApp\'s spam checks, it only messages people who have written lately, so the notes for Ronald are waiting.',
      'Please ask them to send any message (even "hi") to this number: the notes from the last 12 hours go to them straight away.'
    ].join('\n'));
    marked = false;
    const again = await desk.warnAboutQuietTeamMembers(db, ['256700000001', '256700000997'], { bridge: rule, deliver });
    assert.deepStrictEqual(again, { quiet: 1, told: 0 }, 'not again the same day');
    assert.strictEqual(sent.length, 1);
  }));
  assert.deepStrictEqual(await desk.warnAboutQuietTeamMembers(db, ['256700000001'], { bridge: { ...rule, onlyToPeopleWhoWrote: () => false }, deliver }), { skipped: 'rule_off' });
});

test('the pieces are wired: the chat stays with the assistant, the answer rides on the call, a hidden number is told', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const handler = source.slice(source.indexOf('async function handleWhatsappCallEvent'), source.indexOf('async function handleMissedCallNeedReply'));
  const missedPart = handler.slice(handler.indexOf('const caller = await whoIsCalling'));
  assert.doesNotMatch(missedPart, /status: 'needs_human'|ai_mode: 'copilot'/, 'a missed call no longer silences the assistant');
  assert.match(handler, /if \(String\(status \|\| ''\)\.toLowerCase\(\) === 'answered'\) \{[\s\S]*?return \{ duplicate: false, message: '', nextStep: preservedStep, lead: null \};/);
  assert.match(missedPart, /if \(!\(await missedCallToldRecently\(cleanPhone, callId\)\)\) \{\n\s+await alertTeamMissedCall\(/);
  assert.match(missedPart, /message: reply\.message,/);
  const callRoute = source.slice(source.indexOf("router.post('/web-bridge/call'"), source.indexOf('// GET /api/whatsapp/web-bridge/employee-video-recovery-targets') > 0 ? source.indexOf('// GET /api/whatsapp/web-bridge/employee-video-recovery-targets') : undefined);
  assert.match(callRoute, /inboundMessageId: `call:web_bridge:\$\{callId\}`,/);
  assert.match(callRoute, /kind: 'missed_call_reply'/);
  assert.match(callRoute, /if \(!phone && inboundMetadata\.number_hidden === true/);
  assert.match(source, /waMessageId: callId \? `call:\$\{provider\}:\$\{callId\}` : null,/, 'the call is logged under the id its answer names');
});
