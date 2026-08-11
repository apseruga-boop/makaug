const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isOwnWhatsappMessage } = require('../services/whatsappWebDirectionService');

assert.strictEqual(isOwnWhatsappMessage({ direction: 'out' }), true);
assert.strictEqual(isOwnWhatsappMessage({ direction: 'outbound' }), true);
assert.strictEqual(isOwnWhatsappMessage({ senderLabel: 'You' }), true);
assert.strictEqual(isOwnWhatsappMessage({ senderLabel: 'makaug.com' }), true);
assert.strictEqual(isOwnWhatsappMessage({ text: 'You\nmakaug.com | Welcome back\nCarry on?' }), true);
assert.strictEqual(isOwnWhatsappMessage({ text: 'You are looking for a house in Ntinda' }), false);
assert.strictEqual(isOwnWhatsappMessage({ direction: 'in', senderLabel: 'Customer', text: 'You' }), false);
assert.strictEqual(isOwnWhatsappMessage({ direction: 'in', senderLabel: 'Customer', text: '[image]' }), false);

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

assert(workerSource.includes('hasOutgoingDeliveryReceipt'), 'Worker must recognize delivered/read receipts as outgoing evidence');
assert(workerSource.includes("skipped: 'outgoing_message'"), 'Worker must drop outgoing snapshots before API ingestion');
assert(workerSource.includes('message_direction: snapshot.direction'), 'Worker must send direction metadata to the server guard');
assert(routeSource.includes("duplicate_reason: 'outgoing_web_message'"), 'API must independently reject outgoing WhatsApp snapshots');

console.log('WhatsApp self-reply guard checks passed');
