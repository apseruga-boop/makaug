'use strict';

/**
 * One WhatsApp message is answered once.
 *
 * 29 Sep 2026, 06:35. Arthur forwarded 22 properties through Agent 007 and
 * typed COMPLETE at 06:37:45. The batch closed cleanly a second later — and
 * then, from 06:37:54, the bot answered seventeen of his own property captions
 * as though he were house-hunting:
 *
 *   "🟩🟨 makaug.com | Affordability search — here are the cheapest live
 *    makaug.com matches I found. 🎯 Land • up to USh 110M"
 *   "✅ Filters applied: max USh 1.6B — 12 matching properties found in Naguru"
 *   "📍 Which area or district are you looking in?"
 *
 * The intent log names the cause: every one of those turns ran at
 * current_step `main_menu` — after COMPLETE had closed the batch — and several
 * captions appear in it twice, ten seconds apart. The same messages had been
 * delivered to makaug more than once, and the later copies landed after the
 * session had gone back to the customer menu.
 *
 * The bridge is right to retry. A handover that stalls used to be abandoned,
 * leaving makaug to wait for WhatsApp's own redelivery — that is what turned a
 * half-minute database stall into Arthur's six-minute "Hello" on 28 Sep.
 * At-least-once delivery is the contract. Being answered twice is the defect,
 * and the defect is on the receiving side:
 *
 *   SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1   -- nothing yet
 *   ...queue it, run the whole conversation, and only THEN write the row
 *
 * The row that the check looks for is written at the END of the work. So for
 * the entire time a message is queued or in progress — precisely the window in
 * which a slow handover is retried — it is invisible to its own duplicate
 * check. It could only ever catch a copy arriving after the original had fully
 * finished: the one case that never happens.
 *
 * These run against a real PostgreSQL, because the fix is an atomic INSERT ..
 * ON CONFLICT and a unit test with a fake client would prove nothing about the
 * one property that matters.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');

const HAS_DB = Boolean(process.env.DATABASE_URL);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_phone TEXT NOT NULL,
    wa_message_id TEXT,
    direction TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wa_message_id_key
    ON whatsapp_messages (wa_message_id);
`;

// The caption Arthur sent at 06:36:08 that came back to him as an
// "Affordability search • Land up to USh 110M".
const CAPTION = '12 decimals Commercial plot Kira kiwologoma on sale UGX 110 million';
const PHONE = '447757773202';
// WAHA's id for one concrete message. It is identical across retries of the
// same handover, which is what makes it usable as an idempotency key.
const WA_ID = 'false_58248765960252@lid_A5C5345D7';

let api = null;
let db = null;

async function reset() {
  await db.query(SCHEMA);
  await db.query('DELETE FROM whatsapp_messages');
}

function load() {
  if (api) return api;
  db = require('../config/database');
  api = require('../routes/whatsapp').__test;
  return api;
}

after(async () => {
  if (!HAS_DB || !db) return;
  await db.pool.end().catch(() => {});
});

const inbound = (overrides = {}) => ({
  userPhone: PHONE,
  waMessageId: WA_ID,
  messageType: 'text',
  payload: { provider: 'web_bridge', body: CAPTION },
  ...overrides
});

test('the second copy of a message in flight is refused', async (t) => {
  if (!HAS_DB) { t.skip('needs a real PostgreSQL'); return; }
  const { claimInboundMessage } = load();
  await reset();

  // The bridge's first handover. makaug takes the message and starts work.
  const first = await claimInboundMessage(inbound());
  assert.strictEqual(first.claimed, true, 'the first copy is ours to answer');

  // Ten seconds later, with the conversation still running and no row written
  // yet, the bridge retries. This is the copy that answered Arthur with an
  // affordability search.
  const retry = await claimInboundMessage(inbound());
  assert.strictEqual(retry.claimed, false,
    'the retry must be recognised while the original is still being worked on');
});

test('two copies racing at the same instant cannot both win', async (t) => {
  if (!HAS_DB) { t.skip('needs a real PostgreSQL'); return; }
  const { claimInboundMessage } = load();
  await reset();

  // Two web instances behind the load balancer, same message, same moment.
  const results = await Promise.all([
    claimInboundMessage(inbound()),
    claimInboundMessage(inbound()),
    claimInboundMessage(inbound())
  ]);
  assert.strictEqual(results.filter((r) => r.claimed).length, 1,
    'exactly one of them answers; a unique index decides, not a read-then-write');
});

test('a finished message stays finished', async (t) => {
  if (!HAS_DB) { t.skip('needs a real PostgreSQL'); return; }
  const { claimInboundMessage, logWhatsappMessage, releaseInboundMessageClaim } = load();
  await reset();

  await claimInboundMessage(inbound());
  // The runtime finishes and writes the real row over the claim.
  await logWhatsappMessage({
    userPhone: PHONE,
    waMessageId: WA_ID,
    direction: 'inbound',
    messageType: 'text',
    payload: { provider: 'web_bridge', body: CAPTION, effectiveBody: CAPTION }
  });

  const stored = await db.query('SELECT payload FROM whatsapp_messages WHERE wa_message_id = $1', [WA_ID]);
  assert.strictEqual(stored.rows.length, 1, 'one row, not two');
  assert.strictEqual(stored.rows[0].payload.effectiveBody, CAPTION,
    'and it carries what the runtime worked out, not the bare claim');
  assert.ok(!stored.rows[0].payload.claim, 'the claim marker is gone once the row is real');

  // The bridge's socket died after makaug had already answered. Releasing must
  // not undo a message that was genuinely handled.
  await releaseInboundMessageClaim(WA_ID);
  const survived = await db.query('SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1', [WA_ID]);
  assert.strictEqual(survived.rows.length, 1, 'a handled message is never released');

  const late = await claimInboundMessage(inbound());
  assert.strictEqual(late.claimed, false, 'so its retry is still a duplicate');
});

test('a message that really failed is given back', async (t) => {
  if (!HAS_DB) { t.skip('needs a real PostgreSQL'); return; }
  const { claimInboundMessage, releaseInboundMessageClaim } = load();
  await reset();

  await claimInboundMessage(inbound());
  // The turn threw. Nothing was answered, so the id must not be burned — that
  // is the failure mode the bridge's own claim was rewritten to avoid, where a
  // forwarded album of eight photos lost six.
  await releaseInboundMessageClaim(WA_ID);

  const retry = await claimInboundMessage(inbound());
  assert.strictEqual(retry.claimed, true, 'a genuine retry after a genuine error gets through');
});

test('an abandoned claim does not hold the message for ever', async (t) => {
  if (!HAS_DB) { t.skip('needs a real PostgreSQL'); return; }
  const { claimInboundMessage } = load();
  await reset();

  await claimInboundMessage(inbound());
  // The instance holding it was restarted mid-turn and will never finish or
  // release. Backdate the claim past the stale window.
  await db.query(
    `UPDATE whatsapp_messages
        SET payload = jsonb_set(payload, '{claim,at}', to_jsonb((NOW() - INTERVAL '2 hours')::text))
      WHERE wa_message_id = $1`,
    [WA_ID]
  );
  const retaken = await claimInboundMessage(inbound());
  assert.strictEqual(retaken.claimed, true, 'a claim nobody is holding is not a tombstone');
});

test('the check it replaces would have let Arthur’s copy through', async (t) => {
  if (!HAS_DB) { t.skip('needs a real PostgreSQL'); return; }
  load();
  await reset();

  // The old order of operations, exactly: look for a row, find nothing because
  // the row is not written until the work finishes, and accept the copy.
  const oldCheckAccepts = async () => {
    const seen = await db.query('SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1', [WA_ID]);
    return seen.rows.length === 0;
  };

  assert.strictEqual(await oldCheckAccepts(), true, 'first copy accepted — correct');
  assert.strictEqual(await oldCheckAccepts(), true,
    'and so is the retry, because nothing has been written yet. '
    + 'This is the bug: a test that cannot show it failing is not evidence of anything.');
});

// ---------------------------------------------------------------------------
// The other end of the same morning.
// ---------------------------------------------------------------------------

/**
 * Ronald typed COMPLETE at 06:22:08 and got "2 properties sent for staff
 * review". Seventeen seconds later twenty-five of his property messages landed
 * at once — he had re-forwarded them. The batch was shut, so the session was
 * back at the customer menu and makaug sold him the marketplace: the numbered
 * "1️⃣ List a property 2️⃣ Search properties" menu, then a lecture about
 * buying land safely. Nothing in either said his properties had not been saved.
 */
const closedBatchSession = (minutesAgo = 1) => ({
  phone: '256709402189',
  current_step: 'main_menu',
  session_data: {
    employee_intake_last_completed_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    employee_intake_last_subject_name: 'Sewa sewa',
    employee_intake_last_properties_set_up: 2
  }
});

test('a property sent just after the batch closed is not answered as a customer', () => {
  const { recentlyClosedEmployeeBatchReply } = load();
  const reply = recentlyClosedEmployeeBatchReply({
    phone: '256709402189',
    session: closedBatchSession(),
    cleanBody: 'PRIME 100×100FT PLOT FOR SALE – WAMALA TOWN, ENTEBBE ROAD AT 130M. Ready Mailo Land Title.',
    mediaUrl: '',
    runtime: {}
  });
  assert.ok(reply, 'staff must be told, not sold to');
  assert.match(reply, /not\* been saved/, 'the important fact first');
  assert.match(reply, /Sewa sewa/, 'and which batch it was');
  assert.match(reply, /Agent 007/, 'with the way to send them properly');
  assert.doesNotMatch(reply, /Search properties|Land safety/,
    'this is the reply he actually got, and it must never come back');
});

test('the rest of the burst is taken quietly, not answered twenty-five times', () => {
  const { recentlyClosedEmployeeBatchReply } = load();
  const session = closedBatchSession();
  const send = () => recentlyClosedEmployeeBatchReply({
    phone: '256709402189',
    session,
    cleanBody: '',
    mediaUrl: 'https://bridge.example/media/photo.jpg',
    runtime: { mediaCount: 1 }
  });
  const first = send();
  assert.ok(first, 'the first one explains');
  for (let i = 0; i < 24; i += 1) {
    assert.strictEqual(send(), '',
      'the other twenty-four are swallowed — handled, but silent');
  }
});

test('an ordinary message after a batch is still an ordinary message', () => {
  const { recentlyClosedEmployeeBatchReply } = load();
  for (const body of ['thanks', 'ok', 'Hello', 'How many did that save?']) {
    assert.strictEqual(
      recentlyClosedEmployeeBatchReply({ phone: '256709402189', session: closedBatchSession(), cleanBody: body }),
      null,
      `"${body}" is conversation, and must go to the normal engine`
    );
  }
});

test('the grace window closes', () => {
  const { recentlyClosedEmployeeBatchReply } = load();
  assert.strictEqual(
    recentlyClosedEmployeeBatchReply({
      phone: '256709402189',
      session: closedBatchSession(60 * 24),
      cleanBody: 'PRIME 100×100FT PLOT FOR SALE – WAMALA TOWN AT 130M ready mailo title'
    }),
    null,
    'a property sent a day later is a new batch, not a stray'
  );
});

test('someone who never ran a batch is unaffected', () => {
  const { recentlyClosedEmployeeBatchReply } = load();
  assert.strictEqual(
    recentlyClosedEmployeeBatchReply({
      phone: '256700111222',
      session: { phone: '256700111222', current_step: 'main_menu', session_data: {} },
      cleanBody: 'PRIME 100×100FT PLOT FOR SALE – WAMALA TOWN AT 130M ready mailo title'
    }),
    null,
    'a customer describing a property they want is still a customer'
  );
});
