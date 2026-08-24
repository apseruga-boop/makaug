const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const helperStart = source.indexOf('function normalizeInput');
const helperEnd = source.indexOf('function inferListingTypeFromStartRequest');

assert(helperStart > -1 && helperEnd > helperStart, 'WhatsApp ownership helper block must remain testable');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
${source.slice(helperStart, helperEnd)}
this.mapOwnershipInput = mapOwnershipInput;
`, sandbox);

const ownerReplies = [
  '1',
  'owner',
  'I am the owner',
  "I'm the owner",
  'I’m the owner',
  'Im owner',
  'am the owner',
  'I own it',
  'This is my property',
  'Mine',
  'Nze nnyini',
  'Mimi ni mmiliki'
];

for (const reply of ownerReplies) {
  assert.strictEqual(sandbox.mapOwnershipInput(reply), 'owner', `Should recognise owner reply: ${reply}`);
}

const agentReplies = [
  '2',
  'agent',
  'I am an agent',
  "I'm the agent",
  'Im a broker',
  'I am a realtor',
  'I am an agent listing on behalf of the owner',
  'Listing on behalf of the owner',
  'Nze agent',
  'Mimi ni wakala'
];

for (const reply of agentReplies) {
  assert.strictEqual(sandbox.mapOwnershipInput(reply), 'agent', `Should recognise agent reply: ${reply}`);
}

for (const reply of ['owner financing', 'find an agent', 'the owner is abroad', 'maybe']) {
  assert.strictEqual(sandbox.mapOwnershipInput(reply), null, `Should not guess ownership from: ${reply}`);
}

assert(
  source.includes("if (currentStep === 'ownership') return Boolean(mapOwnershipInput(clean)) || Boolean(mapListingTypeInput(clean));"),
  'Natural ownership replies must count as actionable step replies'
);
assert(
  source.includes("const ownershipReply = mapOwnershipInput(cleanBody);"),
  'Ownership step must use the natural-language ownership parser'
);
assert(
  source.includes("&& !actionableStepReply"),
  'A valid active-step reply must not be stolen by global intent routing'
);

console.log('WhatsApp natural ownership reply tests passed');
