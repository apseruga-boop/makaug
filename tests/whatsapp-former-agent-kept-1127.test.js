'use strict';

/**
 * 26 Nov 2026. An agent removed for not paying sent a 58M house with nine
 * photos the afternoon after the kind note with his payment link had gone. The
 * note goes once a day, so the bot said nothing; his house was kept for when he
 * rejoins, but from his side it went nowhere, and the team's inbox still showed
 * the note we had sent the night before. Now: once the burst is over he is told
 * what is kept, his photos are kept at once, and the inbox shows he wrote.
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
const handoff = require('../services/leadHandoffService');
const billing = require('../services/billingOpsService');

const PHONE = '256700000151';
const AGENT = { id: '0f0f0f0f-0000-4000-8000-000000000003', full_name: 'Testa Agent', greeting_name: 'Testa' };
const HOUSE = 'Good deal !!! At Only Ugx #58M\nHouse on quick sale\nLocated at Buwambo Kasangati in trading centre\nHaving 4 bedrooms sitting dining kitchen bathrooms and garage';
const PLOT = 'Quick sale located in Gayaza Manyangwa Plot Size 12 decimals (50x100fts)\nPlot Quick Sale 55m last Price\nReady Private Mailo land title';

function chatRows({ noteAt, keptUrl = '' }) {
  const at = (iso) => new Date(iso);
  return [
    { id: 1, wa_message_id: 'm-plot', created_at: at('2026-11-25T20:50:20Z'), message_type: 'text', payload: { body: PLOT } },
    { id: 2, wa_message_id: 'm-plot-1', created_at: at('2026-11-25T20:50:22Z'), message_type: 'media', payload: { body: '', mediaUrl: 'https://bridge.example/media?p=a&m=aW1hZ2UvanBlZw', mediaType: 'image' } },
    { id: 3, wa_message_id: 'm-house', created_at: at('2026-11-26T13:19:53Z'), message_type: 'text', payload: { body: HOUSE } },
    { id: 4, wa_message_id: 'm-house-1', created_at: at('2026-11-26T13:20:31Z'), message_type: 'media', payload: { body: '', mediaUrl: 'https://bridge.example/media?p=b&m=aW1hZ2UvanBlZw', mediaType: 'image', ...(keptUrl ? { keptMediaUrl: keptUrl, keptMediaType: 'image/jpeg' } : {}) } }
  ].filter((row) => !noteAt || true);
}

function withFakes({ snapshot, rows }, run) {
  const saved = { query: db.query, deliver: handoff.deliverWhatsapp, settings: billing.getSettings };
  const sent = [];
  const updates = [];
  db.query = async (sql, params = []) => {
    const s = String(sql);
    if (/FROM agents WHERE id = \$1/i.test(s)) return { rows: [{ ...AGENT, removed_at: '2026-11-23T14:11:00Z', removal_snapshot: snapshot }] };
    if (/FROM whatsapp_messages/i.test(s) && /direction = 'inbound'/i.test(s)) return { rows };
    if (/UPDATE agents SET removal_snapshot/i.test(s)) { updates.push(s); snapshot.kept_note_at = new Date().toISOString(); return { rows: [] }; }
    return { rows: [] };
  };
  handoff.deliverWhatsapp = async ({ to, body, kind }) => { sent.push({ to, body, kind }); return { status: 'queued' }; };
  billing.getSettings = async () => ({ agent_fee: { monthly_ugx: 50000 } });
  return Promise.resolve(run({ sent, updates })).finally(() => {
    db.query = saved.query;
    handoff.deliverWhatsapp = saved.deliver;
    billing.getSettings = saved.settings;
  });
}

test('what is kept is named the way an agent would say it', () => {
  const house = route.employeePropertyFacts(HOUSE, {});
  const plot = route.employeePropertyFacts(PLOT, {});
  assert.strictEqual(route.keptAdvertLabel({ caption: HOUSE, facts: house }), '4-bedroom house in Buwambo · UGX 58,000,000');
  assert.strictEqual(route.keptAdvertLabel({ caption: PLOT, facts: plot }), 'Plot in Manyangwa · UGX 55,000,000');
});

test('a house sent after the note is answered, once the burst is over, with everything kept', async () => {
  // The note went with the plot at 20:50 the night before; the house came the next afternoon.
  const snapshot = { rejoin_sent_at: '2026-11-25T20:50:27Z' };
  await withFakes({ snapshot, rows: chatRows({}) }, async ({ sent, updates }) => {
    const result = await route.sendKeptAdvertsNote({ agent: AGENT, phone: PHONE });
    assert.strictEqual(result.sent, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, PHONE);
    assert.strictEqual(sent[0].kind, 'former_agent_kept');
    assert.strictEqual(sent[0].body, [
      'Thank you, Testa 🙏 I\'ve kept this one safe with the others you sent:',
      '',
      '• 4-bedroom house in Buwambo · UGX 58,000,000',
      '• Plot in Manyangwa · UGX 55,000,000',
      '',
      'They all go to our team for review as soon as you rejoin (the agent plan is UGX 50,000 a month), and your earlier listings come back up at the same time. The payment link is in my message above.',
      '',
      'Any questions, just reply here.'
    ].join('\n'));
    assert.strictEqual(updates.length, 1, 'remembered, so it is said once');
    const again = await route.sendKeptAdvertsNote({ agent: AGENT, phone: PHONE });
    assert.strictEqual(again.reason, 'nothing_new');
    assert.strictEqual(sent.length, 1, 'never twice for the same adverts');
  });
});

test('nothing new since the note: nothing is said', async () => {
  const snapshot = { rejoin_sent_at: '2026-11-26T14:00:00Z' };
  await withFakes({ snapshot, rows: chatRows({}) }, async ({ sent }) => {
    const result = await route.sendKeptAdvertsNote({ agent: AGENT, phone: PHONE });
    assert.strictEqual(result.reason, 'nothing_new');
    assert.strictEqual(sent.length, 0);
  });
});

test('a photo kept when it arrived is the one used when they come back', async () => {
  const kept = 'https://media.makaug.com/whatsapp-employee-intake/image/kept-house-1.jpg';
  const saved = db.query;
  db.query = async (sql) => (/FROM whatsapp_messages/i.test(String(sql)) ? { rows: chatRows({ keptUrl: kept }) } : { rows: [] });
  try {
    const { groups } = await route.groupForwardedAdverts(PHONE, { since: '2026-11-23T14:11:00Z' });
    const house = groups.find((group) => /Buwambo/.test(group.caption));
    assert.deepStrictEqual(house.media.map((item) => [item.url, item.mimeType]), [[kept, 'image/jpeg']]);
    const plot = groups.find((group) => /Manyangwa/.test(group.caption));
    assert.match(plot.media[0].url, /^https:\/\/bridge\.example\//, 'no kept copy: the bridge\'s');
  } finally {
    db.query = saved;
  }
});

test('the pieces are wired: the note after the burst, the media kept, the inbox told', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const reply = source.slice(source.indexOf('async function removedAgentReply'), source.indexOf('/** An agent paused for an unpaid fee messages us'));
  assert.match(reply, /if \(property\) keptAdvertsNoteLater\(\{ agent, phone \}\);\n\s+return \{ message: '', silent: true \};/);
  assert.match(source, /if \(formerAgent\) \{\n\s+answeredEarly\('former_agent'\);\n\s+if \(effectiveMediaUrl && !isAudioNote\) \{\n\s+deferWhatsappWork\('keep a former agent\\'s media', \(\) => keepFormerAgentMedia\(/);
  assert.match(source, /if \(paymentReply\) \{\n\s+answeredEarly\('payment_claim'\);/);
  assert.match(source, /if \(pausedReply\) \{\n\s+answeredEarly\('paused_agent'\);/);
  assert.match(source, /const answeredEarly = \(reason\) => deferWhatsappWork\('early answer conversation sync', \(\) => syncWhatsappConversationState\(\{\n\s+phone,\n\s+direction: 'inbound',/);
});
