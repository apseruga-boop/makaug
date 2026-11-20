'use strict';

/**
 * The number only writes to people who have written to it.
 *
 * 15 Nov 2026, 15:42:03: WhatsApp removed the link that carries every message
 * and restricted the number for "spam, automated or bulk messaging". Two
 * seconds earlier the number had sent "your property is live" to a new agent
 * who had never written to it.
 *
 * 16 Nov 2026: the number was linked again at 05:15. At 05:28:12 the link was
 * removed again. Two seconds earlier a lead-desk notice had gone to a member
 * of staff's number that had been sent 186 automatic messages in a month and
 * had never once answered. In the thirteen minutes between, replies to five
 * people who had written were all delivered.
 *
 * So a message is handed to the bridge only when the person it is for has
 * written to the number, or when it answers a message of theirs. Anything
 * else waits, and goes the moment they write.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const bridge = require('../services/whatsappWebBridgeService');
const links = require('../services/filmLinkService');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function withFakeDb(reply, run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return reply(String(sql), params) || { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

function withRule(value, run) {
  const saved = process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE;
  if (value === undefined) delete process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE; else process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = value;
  return Promise.resolve(run()).finally(() => {
    if (saved === undefined) delete process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE; else process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = saved;
  });
}

test('the rule is on unless it is turned off, and stays out of tests of other things', () => {
  assert.strictEqual(bridge.onlyToPeopleWhoWrote({ NODE_ENV: 'production' }), true);
  assert.strictEqual(bridge.onlyToPeopleWhoWrote({}), true);
  assert.strictEqual(bridge.onlyToPeopleWhoWrote({ NODE_ENV: 'production', WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE: 'off' }), false);
  assert.strictEqual(bridge.onlyToPeopleWhoWrote({ NODE_ENV: 'test' }), false);
  assert.strictEqual(bridge.onlyToPeopleWhoWrote({ NODE_TEST_CONTEXT: 'child-v8' }), false);
  assert.strictEqual(bridge.onlyToPeopleWhoWrote({ NODE_ENV: 'test', WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE: 'on' }), true);
});

test('"has written" is a message of theirs, by their number, and a call is not a message', () => {
  const sql = bridge.hasWrittenSql('q');
  assert.match(sql, /FROM whatsapp_messages m\s+WHERE m\.direction = 'inbound'/);
  assert.match(sql, /AND m\.message_type <> 'call'/, 'somebody who only rang has not written');
  // By the number as it is stored, with and without the plus: all three use the index.
  assert.match(sql, /m\.user_phone IN \(\s+q\.user_phone,\s+regexp_replace\(COALESCE\(q\.user_phone, ''\), '\\D', '', 'g'\),\s+'\+' \|\| regexp_replace/);
  // Or the row answers a message of theirs, whatever form the number is kept in.
  assert.match(sql, /m\.wa_message_id = q\.metadata->>'inbound_message_id'/);
  assert.match(sql, /RIGHT\(regexp_replace\(m\.user_phone, '\\D', '', 'g'\), 9\)\s+= RIGHT\(regexp_replace\(COALESCE\(q\.user_phone, ''\), '\\D', '', 'g'\), 9\)/);
  // No cast that a strange value could break: one bad row must not stop every message.
  assert.doesNotMatch(sql, /::uuid|::int/);
});

test('nothing is handed to the bridge for somebody who has never written', async () => {
  await withRule('on', () => withFakeDb(() => null, async (calls) => {
    await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
    const claim = calls.find((c) => /WITH claimable AS/i.test(c.sql));
    assert.ok(claim, 'the claim ran');
    assert.match(claim.sql, /AND \(NOT \$9::boolean OR \(\s+EXISTS \(\s+SELECT 1 FROM whatsapp_messages m/);
    assert.strictEqual(claim.params[8], true);
  }));
  await withRule('off', () => withFakeDb(() => null, async (calls) => {
    await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
    const claim = calls.find((c) => /WITH claimable AS/i.test(c.sql));
    assert.strictEqual(claim.params[8], false, 'with the rule off the claim is as it was');
  }));
});

test('what is waiting is not failed: it stays in the queue, and what nobody comes for is let go later', async () => {
  await withRule('on', () => withFakeDb((sql) => (/had not written to the makaug number lately/.test(sql) ? { rows: [], rowCount: 3 } : null), async (calls) => {
    assert.strictEqual(await bridge.letGoOfWhatNobodyCameFor({ force: true }), 3);
    const sweep = calls[0].sql;
    assert.match(sweep, /SET status = 'failed',\s+last_error = 'Not sent: they had not written to the makaug number lately\.'/);
    assert.match(sweep, /"failure_class":"never_wrote"/);
    assert.match(sweep, /q\.status IN \('pending', 'retry'\)/);
    // A notice to staff, a Morning Brief, "sorry we missed your call": twelve hours. A welcome: seven days.
    assert.match(sweep, /'\^\(agent_brief\|lead_handoff_\)\|_notice\$'\s+OR LOWER\(COALESCE\(q\.metadata->>'source', ''\)\) = 'whatsapp_missed_call'\s+THEN INTERVAL '12 hours' ELSE INTERVAL '7 days' END/);
    assert.match(sweep, /AND NOT \(\s+EXISTS \(\s+SELECT 1 FROM whatsapp_messages m/, 'never anything for somebody who has written');
    // Once a minute at most: it runs beside every hand-over.
    assert.strictEqual(await bridge.letGoOfWhatNobodyCameFor(), 0);
    assert.strictEqual(calls.length, 1);
  }));
  await withRule('off', () => withFakeDb(() => null, async (calls) => {
    assert.strictEqual(await bridge.letGoOfWhatNobodyCameFor({ force: true }), 0);
    assert.strictEqual(calls.length, 0, 'with the rule off nothing is let go');
  }));
});

test('whether somebody has written is asked by their number, and when it cannot be told the answer is no', async () => {
  await withFakeDb((sql) => (/FROM whatsapp_messages/.test(sql) ? { rows: [{ '?column?': 1 }] } : null), async (calls) => {
    assert.strictEqual(await bridge.hasWrittenToUs('+256 700 555 061'), true);
    assert.match(calls[0].sql, /direction = 'inbound' AND message_type <> 'call' AND user_phone = ANY\(\$1::text\[\]\)/);
    assert.ok(calls[0].params[0].includes('256700555061') && calls[0].params[0].includes('+256700555061'));
  });
  await withFakeDb(() => ({ rows: [] }), async () => {
    assert.strictEqual(await bridge.hasWrittenToUs('256700555062'), false);
  });
  assert.strictEqual(await bridge.hasWrittenToUs('12345'), false, 'not a number');
  const originalQuery = db.query;
  db.query = async () => { throw new Error('no database'); };
  try {
    assert.strictEqual(await bridge.hasWrittenToUs('256700555063'), false);
  } finally {
    db.query = originalQuery;
  }
});

test('a member of staff is not told a film was sent when it would only wait', async () => {
  // Somebody who has never written: refused, with the reason.
  await withRule('on', () => withFakeDb(() => ({ rows: [] }), async () => {
    const refused = await route.firstContactAllowed('256700555064');
    assert.strictEqual(refused.ok, false);
    assert.strictEqual(refused.code, 'only_to_people_who_wrote');
    assert.strictEqual(refused.why, links.ONLY_WROTE_WHY);
    assert.match(refused.why, /only writes to people who have written to it in the last 7 days/);
    assert.match(refused.why, /restricted it on 15, 16, 17 and 20 Nov, each time just after it wrote to somebody who had not written to it lately/);
  }));
  // Somebody who has: as before.
  await withRule('on', () => withFakeDb((sql) => (/FROM whatsapp_messages/.test(sql) ? { rows: [{ ok: 1 }] } : null), async () => {
    assert.deepStrictEqual(await route.firstContactAllowed('256700555065'), { ok: true, wrote: true });
  }));
  // And Agent 007 says so before she types a name.
  assert.strictEqual(
    links.firstContactNote({ onlyWrote: true }),
    '_The number itself writes first to nobody. A name and number sent here gets the film only if they have written to this number in the last 7 days. For everybody else, your link._'
  );
  assert.match(read('routes/whatsapp.js'), /firstContactNote\(\{ now, onlyWrote: whatsappWebBridgeService\.onlyToPeopleWhoWrote\(\) \}\)/);
});

test('a sign-in code is not queued for somebody the number may not write to, and the outbox shows what is waiting', () => {
  const otp = read('services/phoneOtpDeliveryService.js');
  assert.match(otp, /whatsappWebBridgeService\.onlyToPeopleWhoWrote\(\)\s+&& !\(await whatsappWebBridgeService\.hasWrittenToUs\(recipient\)\.catch\(\(\) => false\)\)/);
  assert.match(otp, /reason: 'they_have_not_written_to_the_number'/);
  assert.match(otp, /if \(whatsappBridgeEnabled\(\) && !needsLinking && !mayNotWriteToThem\) \{/);
  const admin = read('routes/admin.js');
  assert.match(admin, /AS waiting_for_first_message/);
  assert.match(admin, /waiting_for_first_message: row\.waiting_for_first_message === true/);
});

// ---------------------------------------------------------------------------
// A number staff have paused (16 Nov 2026: a member of staff's number that had
// been sent 186 automatic notices in a month, taken off them for now).
// ---------------------------------------------------------------------------

test('a paused number is sent nothing unasked: the message is recorded as not sent, with the reason', async () => {
  const paused = { rows: [{ value: { tails: ['700555071'], notes: {} } }] };
  await withFakeDb((sql) => {
    if (/SELECT value FROM billing_settings WHERE key = \$1/.test(sql)) return paused;
    if (/INSERT INTO outbound_message_queue/.test(sql)) return { rows: [{ id: 'q-held', status: 'failed' }] };
    return null;
  }, async (calls) => {
    await bridge.pausedNumbers({ fresh: true });
    const held = await bridge.queueWhatsappWebBridgeMessage({ recipient: '+256700555071', text: 'New on the makaug lead desk (1)', source: 'whatsapp_runtime', metadata: { message_kind: 'lead_handoff_lead_desk_new_alert' } });
    assert.strictEqual(held.rejected, true);
    assert.strictEqual(held.rejected_reason, 'paused_number');
    const insert = calls.find((c) => /INSERT INTO outbound_message_queue/.test(c.sql));
    assert.match(insert.sql, /VALUES \(\$1, \$2::jsonb, 'failed', 0, NOW\(\)/);
    assert.match(insert.params[3], /"failure_class":"paused_number"/);
    assert.strictEqual(insert.params[4], 'Not sent: this number is paused and is sent nothing for now.');
  });
  // An answer to a message of theirs is not stopped.
  await withFakeDb((sql) => {
    if (/SELECT value FROM billing_settings WHERE key = \$1/.test(sql)) return paused;
    if (/INSERT INTO outbound_message_queue/.test(sql)) return { rows: [{ id: 'q-answer', status: 'pending' }] };
    return null;
  }, async (calls) => {
    await bridge.pausedNumbers({ fresh: true });
    await bridge.queueWhatsappWebBridgeMessage({ recipient: '+256700555071', text: 'Hello again', source: 'whatsapp_runtime', metadata: { inbound_message_id: 'in-1' } });
    const insert = calls.find((c) => /INSERT INTO outbound_message_queue/.test(c.sql));
    assert.doesNotMatch(insert.sql, /'failed'/);
  });
  await withFakeDb(() => ({ rows: [] }), async () => { await bridge.pausedNumbers({ fresh: true }); });
});

test('pausing lets go of what is already waiting for them; letting them receive again does not', async () => {
  await withFakeDb((sql) => {
    if (/SELECT value FROM billing_settings WHERE key = \$1/.test(sql)) return { rows: [] };
    if (/UPDATE outbound_message_queue/.test(sql)) return { rows: [], rowCount: 2 };
    return null;
  }, async (calls) => {
    const result = await bridge.setNumberPaused('+256 700 555 072', true, { by: 'admin', note: 'off the notices for now' });
    assert.deepStrictEqual(result.tails, ['700555072']);
    assert.strictEqual(result.let_go, 2);
    assert.strictEqual(result.notes['700555072'].note, 'off the notices for now');
    const saved = calls.find((c) => /INSERT INTO billing_settings/.test(c.sql));
    assert.strictEqual(saved.params[0], 'whatsapp_paused_numbers');
    assert.deepStrictEqual(JSON.parse(saved.params[1]).tails, ['700555072'], 'only the last nine digits are kept');
    const cleared = calls.find((c) => /UPDATE outbound_message_queue/.test(c.sql));
    assert.match(cleared.sql, /last_error = 'Not sent: this number was paused\.'/);
    assert.match(cleared.sql, /status IN \('pending', 'retry'\)/);
    assert.match(cleared.sql, /COALESCE\(metadata->>'inbound_message_id', ''\) = ''/, 'an answer already waiting still goes');
    assert.deepStrictEqual(cleared.params, ['700555072']);
  });
  await withFakeDb((sql) => {
    if (/SELECT value FROM billing_settings WHERE key = \$1/.test(sql)) return { rows: [{ value: { tails: ['700555072'], notes: { 700555072: { by: 'admin' } } } }] };
    return null;
  }, async (calls) => {
    const result = await bridge.setNumberPaused('256700555072', false, { by: 'admin' });
    assert.deepStrictEqual(result.tails, []);
    assert.deepStrictEqual(result.notes, {});
    assert.ok(!calls.some((c) => /UPDATE outbound_message_queue/.test(c.sql)), 'nothing is touched when the pause is lifted');
  });
  await assert.rejects(() => bridge.setNumberPaused('12345', true), /not a phone number/);
  await withFakeDb(() => ({ rows: [] }), async () => { await bridge.pausedNumbers({ fresh: true }); });
});

test('nothing unasked is handed over for a paused number, and staff can see and change the list, masked', async () => {
  const sql = bridge.pausedSql('q');
  assert.match(sql, /COALESCE\(q\.metadata->>'inbound_message_id', ''\) = ''/);
  assert.match(sql, /b\.key = 'whatsapp_paused_numbers'/);
  assert.match(sql, /\(b\.value->'tails'\) \? RIGHT\(regexp_replace\(COALESCE\(q\.user_phone, ''\), '\\D', '', 'g'\), 9\)/);
  await withRule('on', () => withFakeDb(() => null, async (calls) => {
    await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
    const claim = calls.find((c) => /WITH claimable AS/i.test(c.sql));
    assert.match(claim.sql, /-- Nothing unasked to a number staff have paused\.\s+AND NOT \(\s+COALESCE\(q\.metadata->>'inbound_message_id', ''\) = ''/);
  }));
  const admin = read('routes/admin.js');
  assert.match(admin, /router\.get\('\/whatsapp\/paused-numbers'/);
  assert.match(admin, /router\.post\('\/whatsapp\/paused-numbers'/);
  assert.match(admin, /number: `•••\$\{tail\.slice\(-3\)\}`/, 'a number is never shown whole');
  assert.match(admin, /writeAudit\(paused \? 'whatsapp_number_paused' : 'whatsapp_number_unpaused'/);
});
