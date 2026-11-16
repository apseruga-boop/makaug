'use strict';

/**
 * A message has to be queued under a name the bridge asks for.
 *
 * The bridge that carries makaug's WhatsApp asks the queue for messages by
 * source, and unless it is told otherwise for two: whatsapp_runtime and
 * whatsapp_missed_call. A message queued under any other name is never handed
 * over. It stays "pending", nobody is told, and the person never hears.
 *
 * Staff replies were lost to that until 5 Oct 2026. On 16 Nov 2026 three
 * sign-in codes and six short-stay booking messages were found there, the
 * oldest twelve days old: 'otp', 'short_stay_request' and 'agent_booking' had
 * never been carried. An earlier one had been cleared away by a migration
 * (184) without the cause being found.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const bridge = require('../services/whatsappWebBridgeService');
const stays = require('../services/shortTermBookingService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the name the bridge asks for is one place, and can be changed with the bridge', () => {
  const saved = process.env.WHATSAPP_REPLY_BRIDGE_SOURCE;
  delete process.env.WHATSAPP_REPLY_BRIDGE_SOURCE;
  try {
    assert.strictEqual(bridge.bridgeCarriedSource(), 'whatsapp_runtime');
    assert.deepStrictEqual(bridge.BRIDGE_CARRIED_SOURCES, ['whatsapp_runtime', 'whatsapp_missed_call']);
    process.env.WHATSAPP_REPLY_BRIDGE_SOURCE = ' Other_Name ';
    assert.strictEqual(bridge.bridgeCarriedSource(), 'other_name');
  } finally {
    if (saved === undefined) delete process.env.WHATSAPP_REPLY_BRIDGE_SOURCE; else process.env.WHATSAPP_REPLY_BRIDGE_SOURCE = saved;
  }
});

test('every message queued by name is queued under a name the bridge carries', () => {
  // The admin panel's "outreach WhatsApp" has never been carried either. It is
  // a message to somebody who has not written to the number, so it is left
  // held on purpose (tests/whatsapp-only-to-people-who-wrote.test.js).
  const heldOnPurpose = { admin_outreach_whatsapp: 'routes/admin.js' };
  const found = [];
  for (const dir of ['routes', 'services', 'utils']) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.js'))) {
      const lines = read(path.join(dir, file)).split('\n');
      lines.forEach((line, index) => {
        if (!/(queueWhatsappWebBridgeMessage|queueWhatsappWebBridgeAutoReply|\bqueue)\(\{/.test(line) || /function /.test(line)) return;
        const named = lines.slice(index, index + 16).join('\n').match(/\bsource:\s*'([a-z0-9_:-]+)'/);
        if (named) found.push({ where: `${dir}/${file}:${index + 1}`, source: named[1] });
      });
    }
  }
  assert.ok(found.length >= 15, `the scan found the queue calls (${found.length})`);
  const lost = found.filter(({ where, source }) => !bridge.BRIDGE_CARRIED_SOURCES.includes(source)
    && !(heldOnPurpose[source] && where.startsWith(heldOnPurpose[source])));
  assert.deepStrictEqual(lost, [], 'a message queued under a name the bridge does not ask for is never sent');
});

test('a short-stay message to a host or a guest goes under that name, and still says what it is', async () => {
  const queued = [];
  const out = await stays.deliverStayNotice(
    { phone: '+256700555091', email: '', text: 'New stay request MKS-TEST', reference: 'MKS-TEST', event: 'request_created', role: 'host' },
    { bridgeEnabled: true, queueWhatsappWebBridgeMessage: async (args) => { queued.push(args); return { id: 'q-1' }; }, sendSupportEmail: async () => ({ sent: false }) }
  );
  assert.strictEqual(out.whatsapp_queued, true);
  assert.strictEqual(queued.length, 1);
  assert.strictEqual(queued[0].source, 'whatsapp_runtime');
  assert.deepStrictEqual(queued[0].metadata, { message_kind: 'short_stay_request', stay_reference: 'MKS-TEST', event: 'request_created', role: 'host' });
});

test('the answer to a host, the answer to an agent about a viewing, and both kinds of code go under it too', () => {
  const whatsapp = read('routes/whatsapp.js');
  assert.match(whatsapp, /nextStep: 'stay_request',[\s\S]{0,360}source: whatsappWebBridgeService\.bridgeCarriedSource\(\),\s+kind: 'short_stay_request',/);
  assert.match(whatsapp, /nextStep: 'agent_booking',[\s\S]{0,200}source: whatsappWebBridgeService\.bridgeCarriedSource\(\),\s+kind: 'agent_booking',/);
  assert.match(whatsapp, /makaug listing verification: \$\{otp\}\. Valid 10 mins\. Do not share\.`,\s+source: whatsappWebBridgeService\.bridgeCarriedSource\(\),/);
  assert.match(whatsapp, /queued_by: kind \|\| source,\s+\.\.\.\(kind \? \{ message_kind: kind \} : \{\}\),/, 'what it is stays in its details');
  assert.match(read('services/phoneOtpDeliveryService.js'), /whatsappWebBridgeService\.bridgeCarriedSource\(\)\s+: 'whatsapp_runtime',\s+actorId: 'system',\s+metadata: \{ kind: 'otp' \}/);
  assert.doesNotMatch(whatsapp, /source: '(?:otp|short_stay_request|agent_booking)'/);
});

test('a one-time code is kept nowhere once it has been sent, or has run out', () => {
  assert.strictEqual(
    bridge.withoutTheCode('makaug.com sign-in verification: your code is 123456. It expires in 10 minutes. Do not share it with anyone.'),
    'makaug.com sign-in verification: your code is ••••••. It expires in 10 minutes. Do not share it with anyone.'
  );
  assert.strictEqual(bridge.withoutTheCode('makaug listing verification: 4821. Valid 10 mins. Do not share.'), 'makaug listing verification: ••••••. Valid 10 mins. Do not share.');
  assert.strictEqual(bridge.carriesACode({ metadata: { kind: 'otp', source: 'whatsapp_runtime' } }), true);
  assert.strictEqual(bridge.carriesACode({ metadata: { source: 'otp' } }), true, 'one queued before the name changed');
  assert.strictEqual(bridge.carriesACode({ metadata: { source: 'whatsapp_runtime', message_kind: 'agent_welcome' } }), false);
  assert.strictEqual(bridge.carriesACode({}), false);

  const whatsapp = read('routes/whatsapp.js');
  // On the way out: the conversation staff read, and the queue row itself.
  assert.match(whatsapp, /const wasACode = whatsappWebBridgeService\.carriesACode\(updated\);/);
  assert.match(whatsapp, /wasACode\s+\? whatsappWebBridgeService\.withoutTheCode\(String\(updated\.payload\?\.text \|\| ''\)\.trim\(\)\)/);
  assert.match(whatsapp, /SET payload = jsonb_set\(COALESCE\(payload, '\{\}'::jsonb\), '\{text\}', to_jsonb\(\$2::text\)\)\s+WHERE id = \$1/);
  // And the outbox view, sent or not.
  assert.match(read('routes/admin.js'), /\(row\.kind === 'otp' \|\| row\.source === 'otp'\)\s+\? require\('\.\.\/services\/whatsappWebBridgeService'\)\.withoutTheCode\(row\.preview\)/);
});
