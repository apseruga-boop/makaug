'use strict';

/**
 * A report of land thieves is not a property search, and a missed call is
 * not an email.
 *
 * 3 Nov 2026, 18:01 Kampala: +31 6 84960002 ("Handy") sent three photos with
 * names under them and two Luganda voice notes warning about land grabbers on
 * Hoima Road — Kakiri, Gobero, Kikandwa — with fake police and courts, sticks
 * and pangas. The keyword classifier matched the Acholi "ot" inside "kooti"
 * and "simuyote", called each note a property search, and the assistant
 * answered twice with "no listing in *Kuba*" plus three houses in Kira, and
 * filed five leads. Nobody human saw it until the next morning.
 *
 * The same morning Arthur saw a missed call on the phone that the system had
 * no record of: since the move to WAHA in September no call event had reached
 * makaug, and even before that a missed call only sent an email.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const { heuristicIntent } = require('../services/aiService');
const desk = require('../services/leadDeskService');
const route = require('../routes/whatsapp').__test;

const VOICE_NOTE_1 = 'Abasajja babiina endaga muntu z\'anjawulo, okuva kubba metekeka abantu. Obalabira kutakalyo kuwatejja yambiya, kuwatejambya kubwa kukubyi. Babakolessa poliisi ekachiri, babakolessa ekooti ekachiri. Olutukayo bugebattekamunda, babbiba mataka. Obalabida kuba kukubyi, obalabida kutakalyo kuwatejambya, kuwatebja kuba kukubyi. Babakolessa muzungu z\'anjawulo, poliisi ekachiri jibakozesa ne kooti ekachiri.';
const VOICE_NOTE_2 = 'nange special na usimentiwa group member abasajja bano babibwa amagataka ku yimarodi. Obalaba kutakaliyo kuata miggu, oba kuata jambiya, kuliko omugeni Paul, omugeni Taroya, mumbiwa amagataka, mugisha Patrick, babibwa amagataka, njula David, awe na babibwa amagataka. Nabalabila kutakaliyo kuata miggu, kuata jambiya kuba wukubi. Babane polisi kachiri, kuba bilahwe security ya kuata miggu kube. Kube miggu kuba kuata sinudo ku TikTok, Facebook, mliwamuote mbi.';

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

function withFakeDb(run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/INSERT INTO notifications/i.test(sql)) return { rows: [{ id: 'n-1' }] };
    return { rows: [], rowCount: 1 };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

test('the Acholi word for house no longer hides inside Luganda words', () => {
  assert.notStrictEqual(heuristicIntent(VOICE_NOTE_1).intent, 'property_search', 'kooti is a court, not a house');
  assert.notStrictEqual(heuristicIntent(VOICE_NOTE_2).intent, 'property_search', 'simuyote is not a house either');
  assert.strictEqual(heuristicIntent('amito ot i Gulu').intent, 'property_search', 'a real Acholi request still is');
  assert.strictEqual(heuristicIntent('2 bedroom house in Kampala').intent, 'apply_filters');
});

test('both voice notes go to a person, by their own words, whatever the classifier said', () => {
  for (const transcript of [VOICE_NOTE_1, VOICE_NOTE_2]) {
    const verdict = route.messageOutsideTheAssistant({ transcript, intent: { intent: 'property_search', confidence: 0.62, model: 'heuristic_fast' }, step: 'main_menu' });
    assert.strictEqual(verdict?.reason, 'needs_person', transcript.slice(0, 40));
    assert.ok(verdict.cue, 'the cue that decided it is named');
  }
  const typed = route.messageOutsideTheAssistant({ text: 'These men are land grabbers using fake police on Hoima road, they come with pangas', intent: { intent: 'property_search', model: 'heuristic_fast' }, step: 'main_menu' });
  assert.strictEqual(typed?.reason, 'needs_person', 'a typed report with a strong cue goes to a person too');
});

test('a real request keeps going to the assistant; a long aimless voice note gets a question, not a search', () => {
  const search = { intent: 'property_search', confidence: 0.62, model: 'heuristic_fast' };
  assert.strictEqual(route.messageOutsideTheAssistant({ transcript: 'I am looking for a 2 bedroom house to rent in Kira under 800k a month', intent: search, step: 'main_menu' }), null);
  assert.strictEqual(route.messageOutsideTheAssistant({ transcript: 'njagala ennyumba ya rent e Ntinda ebbeeyi ya 1m', intent: search, step: 'main_menu' }), null);
  assert.strictEqual(route.messageOutsideTheAssistant({ transcript: 'a plot near the Kira police station, 50 by 100', intent: search, step: 'main_menu' }), null, 'a police station is a landmark when there is a request beside it');
  assert.strictEqual(route.messageOutsideTheAssistant({ text: 'is this listing fake', intent: { intent: 'report_listing', model: 'heuristic_fast' }, step: 'main_menu' }), null, 'a typed report keeps its own flow');
  const aimless = route.messageOutsideTheAssistant({ transcript: 'hello my friend how are you today I hope you are fine greetings from the whole family we are all well here', intent: search, step: 'main_menu' });
  assert.strictEqual(aimless?.reason, 'no_property_request');
  assert.strictEqual(route.messageOutsideTheAssistant({ transcript: VOICE_NOTE_2, intent: search, step: 'photos' }), null, 'a listing under way is never interrupted');
  assert.match(route.personWillReplyMessage('lg'), /^Nkuwulidde\./);
  assert.match(route.personWillReplyMessage('en'), /passed it to a person at makaug/);
});

test('the needs-a-person alert reaches Arthur in the day and is held on the conversation at night', async () => {
  await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: 'off' }, () => withFakeDb(async (calls) => {
    const result = await desk.alertTeamConversationNeedsPerson(db, { phone: '31684960002', contactName: 'Handy', summary: VOICE_NOTE_2, reason: 'Voice note about jambiya — not a property request', language: 'Luganda' });
    assert.strictEqual(result.sent, true);
    assert.deepStrictEqual(result.results.map((r) => r.to), ['256700000001']);
    assert.ok(!calls.some((c) => /team_alert_deferred/.test(c.sql)));
  }));
  await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: '0-24' }, () => withFakeDb(async (calls) => {
    const result = await desk.alertTeamConversationNeedsPerson(db, { phone: '+31 6 84960002', contactName: 'Handy', summary: VOICE_NOTE_2, reason: 'Voice note about jambiya' });
    assert.deepStrictEqual(result, { deferred: true, conversationPhone: '31684960002' });
    const hold = calls.find((c) => /whatsapp_conversation_state/.test(c.sql) && /team_alert_deferred/.test(c.sql));
    assert.ok(hold, 'held on the conversation, since there is no listing to hold it on');
    assert.strictEqual(hold.params[0], '31684960002');
    assert.match(hold.params[1], /^🙋 \*WhatsApp message that needs a person\*\nHandy · \+31684960002/);
    assert.strictEqual(hold.params[3], 'needs_person');
  }));
});

test('a missed call WhatsApps Arthur and Ronald at once, whatever the hour', async () => {
  await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: '0-24' }, () => withFakeDb(async () => {
    const result = await desk.alertTeamMissedCall(db, {
      phone: '31684960002', contactName: 'Handy', callType: 'voice', status: 'missed',
      at: new Date('2026-11-04T05:38:00Z'), lastMessage: 'LUGYA DAVID', extraRecipients: ['+256 709 402189']
    });
    assert.strictEqual(result.sent, true);
    assert.deepStrictEqual(result.results.map((r) => r.to), ['256700000001', '256709402189'], 'Arthur, then Ronald, each once');
  }));
  await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256709402189', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: 'off' }, () => withFakeDb(async () => {
    const result = await desk.alertTeamMissedCall(db, { phone: '31684960002', extraRecipients: ['256709402189'] });
    assert.deepStrictEqual(result.results.map((r) => r.to), ['256709402189'], 'Ronald already on the list is not messaged twice');
  }));
  const sent = [];
  const originalSend = desk.sendToTeam;
  // The route helper adds Ronald itself and reads the caller's last words.
  const outcome = await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', WHATSAPP_DELIVERY_MODE: 'test', LEAD_DESK_QUIET_HOURS: 'off' }, () => withFakeDb(async () => route.alertTeamMissedCall({
    phone: '31684960002', contactName: 'Handy', callType: 'video', callStatus: 'missed',
    inquiryContext: { recentMessages: [{ text: 'LUGYA DAVID', createdAt: '2026-11-03T15:02:15Z' }], likelyInquiry: 'Property search' }
  })));
  assert.strictEqual(outcome.sent, true);
  assert.deepStrictEqual(outcome.results.map((r) => r.to), ['256700000001', '256709402189']);
  void sent; void originalSend;
});

test('the morning round-up carries held conversations beside held listings', async () => {
  const property = { id: 'a051c867-b4a7-40c2-924f-e3d76af41a26', created_at: '2026-11-03T23:02:48Z', deferred: { kind: 'submitted', body: '🏠 *New property from Segawa Frederick Kevin SFK — waiting for review*\n🏠 land · for sale', extra_recipients: [], deferred_at: '2026-11-03T23:02:49Z' } };
  const chat = { phone: '31684960002', created_at: '2026-11-03T15:02:50Z', deferred: { kind: 'needs_person', body: '🙋 *WhatsApp message that needs a person*\nHandy · +31684960002\nWhy: Voice note about jambiya', extra_recipients: [], deferred_at: '2026-11-03T15:02:50Z' } };
  const originalQuery = db.query;
  const marked = [];
  db.query = async (sql, params = []) => {
    if (/FROM properties/i.test(sql) && /team_alert_deferred/.test(sql)) return { rows: [property] };
    if (/FROM whatsapp_conversation_state/i.test(sql) && /team_alert_deferred/.test(sql)) return { rows: [chat] };
    if (/UPDATE/i.test(sql) && /sent_at/.test(sql)) marked.push({ table: /properties/.test(sql) ? 'properties' : 'conversations', ids: params[0] });
    return { rows: [] };
  };
  try {
    await withEnv({ LEAD_DESK_ALERT_WHATSAPP: '256700000001', LEAD_DESK_QUIET_HOURS: 'off' }, async () => {
      const bodies = [];
      const result = await desk.sendDeferredPropertyAlerts(db, { send: async (_db, body) => { bodies.push(body); return [{ to: '256700000001', status: 'queued' }]; } });
      assert.strictEqual(result.sent, 2);
      assert.match(bodies[0], /^🌙 \*Overnight while the desk was closed: 1 property from agents waiting for review, 1 message needs a person\*/);
      assert.match(bodies[0], /1\. 🙋 \*WhatsApp message that needs a person\*\nHandy/, 'the earlier one comes first');
      assert.match(bodies[0], /2\. \*Segawa Frederick Kevin SFK\*/);
      assert.deepStrictEqual(marked, [{ table: 'properties', ids: [property.id] }, { table: 'conversations', ids: ['31684960002'] }]);
    });
  } finally {
    db.query = originalQuery;
  }
});
