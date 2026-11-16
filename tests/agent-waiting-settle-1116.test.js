'use strict';

/**
 * What an agent has waiting, settled. 16 Nov 2026.
 *
 * After the spelling and price fixes, an agent's waiting list was led by a
 * house from five days earlier that was now complete ("Najera" is Najjera,
 * Wakiso), with three more adverts that had waited for a district we now know.
 * Nothing would have saved them until he sent another batch, and "Why" would
 * have told him the house "will save shortly". Now anything complete is saved
 * (at "Why", at the batch summary, or by staff), and "Why" is about the first
 * one that still needs something.
 *
 * Every number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const { agentWhyReply, settleAgentWaitingAdverts, agentWaitingAdvertsReport } = require('../routes/whatsapp').__test;

const NAJERA = 'GOOD DEAL 👍 \nNAJERA ESELA  SHELL HOUSE 🏠 \n6 BEDROOMS 16 DECIMALS \nQUICK SALE 420MILLION \nREADY PRIVATE MAILO LAND TITLE \nCONTACT:';
const BUNGA = 'Extraordinary Mansion villa for sale in Bunga Kampala \nFor more information \nCONTACT:';
const video = (name) => ({ url: `https://media.makaug.com/replay/${name}.mp4`, mimeType: 'video/mp4', kind: 'video' });

test('"Why" is about the first one that still needs something, and never promises a save', () => {
  const data = {
    whatsapp_agent_self_intake: true,
    pending_property_caption: NAJERA,
    pending_property_media: [video('najera')],
    pending_property_queue: [{ caption: BUNGA, media: [video('bunga')] }]
  };
  const why = agentWhyReply(data);
  assert.match(why, /^That property is safe with me/);
  assert.match(why, /The first one, "Extraordinary Mansion villa/);
  assert.match(why, /needs the \*price\*/);
  assert.doesNotMatch(why, /NAJERA/);
  assert.doesNotMatch(why, /save shortly/);

  const complete = { whatsapp_agent_self_intake: true, pending_property_caption: NAJERA, pending_property_media: [video('najera')] };
  assert.strictEqual(agentWhyReply(complete), '', 'nothing needs anything: there is no reason to give');
});

test('staff see what is waiting and what each one needs', () => {
  const report = agentWaitingAdvertsReport({
    whatsapp_agent_self_intake: true,
    pending_property_caption: NAJERA,
    pending_property_media: [video('najera')],
    pending_property_media_stored_at: '2026-11-11T09:30:53.000Z',
    pending_property_queue: [
      { caption: BUNGA, media: [video('bunga')], storedAt: '2026-11-16T13:01:40.000Z' },
      { caption: 'Plot for sale in Kira 50m', media: [], storedAt: '2026-11-16T13:02:00.000Z' }
    ]
  });
  assert.deepStrictEqual(report.map((item) => item.missing), [[], ['price'], ['its photos or video']]);
  assert.strictEqual(report[0].stored_at, '2026-11-11T09:30:53.000Z');
  assert.match(report[0].label, /NAJERA/);
  assert.strictEqual(report[1].media, 1);
});

test('settling stops at the first one still missing something, without touching the database', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql) => { calls.push(String(sql)); return { rows: [], rowCount: 0 }; };
  try {
    const data = {
      whatsapp_agent_self_intake: true,
      pending_property_caption: BUNGA,
      pending_property_media: [video('bunga')],
      pending_property_media_stored_at: new Date().toISOString()
    };
    const result = await settleAgentWaitingAdverts({ phone: '', data });
    assert.deepStrictEqual(result.saved, []);
    assert.strictEqual(result.retired, 0);
    assert.strictEqual(data.pending_property_caption, BUNGA);
    assert.strictEqual(calls.length, 0);

    const staff = { pending_property_caption: NAJERA, pending_property_media: [video('n')] };
    assert.deepStrictEqual((await settleAgentWaitingAdverts({ phone: '', data: staff })).saved, [], 'a staff batch is left alone');
    assert.strictEqual(staff.pending_property_caption, NAJERA);
  } finally {
    db.query = originalQuery;
  }
});

test('"Why", the batch summary and staff all settle first; staff can look before anything is saved', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const whyAt = src.indexOf('AGENT_WHY.test(cleanBody)');
  const whyBlock = src.slice(whyAt, whyAt + 1200);
  assert.ok(whyBlock.indexOf('settleAgentWaitingAdverts(') < whyBlock.indexOf('agentWhyReply(data)'), 'settle before explaining');
  assert.match(whyBlock, /agentHeldSavedSummary\(settled\.saved\.map/);

  const summary = src.slice(src.indexOf('async function buildEmployeeBatchSummary'), src.indexOf('const employeeBatchSummaryLastSent'));
  assert.match(summary, /\(await settleAgentWaitingAdverts\(\{ phone, data \}\)\)\.saved/);
  assert.match(summary, /const listKept = heldBefore\.length > 0 \|\| keptSaved\.length > 1/);

  const settle = src.slice(src.indexOf('async function settleAgentWaitingAdverts'), src.indexOf('function agentWaitingAdvertsReport'));
  assert.doesNotMatch(settle, /queueWhatsappWebBridgeAutoReply|outbound_message_queue/, 'nothing is sent from it');

  const admin = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  const endpoint = admin.slice(admin.indexOf("'/whatsapp/conversations/:phone/settle-waiting-adverts'"), admin.indexOf("'/whatsapp/conversations/:phone/import-forwarded-adverts'"));
  assert.match(endpoint, /parseBooleanLike\(req\.body\?\.dry_run, true\)/, 'a dry run unless staff say otherwise');
  assert.match(endpoint, /settleAgentWaitingAdvertsForPhone\(phone, \{ dryRun \}\)/);
  assert.match(endpoint, /whatsapp_agent_waiting_adverts_settled/);
  assert.doesNotMatch(endpoint, /outbound_message_queue|queueWhatsapp/);
});

test('a waiting list stored with no send times is put in order by when each one was stored', () => {
  // The live list on 16 Nov 2026 had none: the house at the front saved, and
  // three complete adverts behind the villa waiting for its price did not.
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const kept = src.slice(src.indexOf('async function saveReadyKeptSubmissions'), src.indexOf('async function settleAgentWaitingAdverts'));
  assert.match(kept, /const pendingAt = Number\(data\.pending_caption_sender_ms \|\| 0\) \|\| Date\.parse\(data\.pending_property_media_stored_at \|\| ''\) \|\| 0;/);
  assert.match(kept, /const entryAt = Number\(entry\.senderMs \|\| 0\) \|\| Date\.parse\(entry\.storedAt \|\| ''\) \|\| 0;/);
  assert.match(kept, /entry\.media\.length > 0 && entryAt > pendingAt/);
  const settle = src.slice(src.indexOf('async function settleAgentWaitingAdverts'), src.indexOf('function agentWaitingAdvertsReport'));
  assert.match(settle, /await saveCompleteOnes\(\);\n  const retired = retireStaleAgentSubmissions\(data\);\n  if \(retired\) \{[\s\S]*?await saveCompleteOnes\(\);/, 'what comes to the front after a stale one is retired is settled too');
});
