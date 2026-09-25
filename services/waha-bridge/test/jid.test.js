'use strict';

/**
 * The addresses WhatsApp actually sends us, and what they have to become.
 *
 * Run: node test/jid.test.js
 *
 * On 24 Sep 2026 a colleague messaged makaug from a linked device. WhatsApp
 * addressed the chat by a LID, the real JID in the envelope was
 * `256709402189:2@s.whatsapp.net`, and the `:2` — the device number — ended up
 * glued to his phone number. Eight messages landed on a conversation for
 * "2567094021892", a number nobody owns, and every reply was undeliverable. He
 * typed "Hello" five times into silence.
 */

const assert = require('assert');
const { hasDeviceSuffix, toChatId, toPhone } = require('../jid');

const cases = [
  // The address that caused the outage.
  ['256709402189:2@s.whatsapp.net', '256709402189', 'a linked device must not change the number'],
  ['256709402189:12@s.whatsapp.net', '256709402189', 'two-digit device ids too'],
  ['256709402189:0@s.whatsapp.net', '256709402189', 'device 0 is still a device'],
  // Everything that already worked has to keep working.
  ['256709402189@s.whatsapp.net', '256709402189', 'a plain JID is unchanged'],
  ['256709402189@c.us', '256709402189', 'the c.us form is unchanged'],
  ['+256 709 402 189', '256709402189', 'a typed number is still read'],
  ['256709402189', '256709402189', 'bare digits pass through'],
  ['58248765960252@lid', '58248765960252', 'a LID keeps its own digits for the caller to judge'],
  ['', '', 'nothing in, nothing out'],
  [null, '', 'null is not a number']
];

for (const [input, want, why] of cases) {
  assert.strictEqual(toPhone(input), want, `${why} (${JSON.stringify(input)})`);
}

// A reply has to reach the person. An address WhatsApp gave us is used as-is;
// only bare digits get the c.us suffix.
assert.strictEqual(toChatId('256709402189'), '256709402189@c.us');
assert.strictEqual(toChatId('+256 709 402 189'), '256709402189@c.us');
assert.strictEqual(toChatId('58248765960252@lid'), '58248765960252@lid',
  'an unmapped LID is replied to on its own address, never converted to a fake number');
assert.strictEqual(toChatId('120363000000000000@g.us'), '120363000000000000@g.us', 'groups keep their id');
assert.strictEqual(toChatId(''), '');

assert.strictEqual(hasDeviceSuffix('256709402189:2@s.whatsapp.net'), true);
assert.strictEqual(hasDeviceSuffix('256709402189@s.whatsapp.net'), false);
assert.strictEqual(hasDeviceSuffix('58248765960252@lid'), false);

console.log(`All ${cases.length + 8} JID cases passed.`);
