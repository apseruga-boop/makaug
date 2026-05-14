require('dotenv').config();

const crypto = require('crypto');
const db = require('../config/database');
const {
  getConfiguredOwnerPhones,
  isAiCeoOwnerPhone,
  isAiCeoPhoneCommand
} = require('../services/aiCeoControlService');

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.name = 'AiCeoPhoneTestTimeout';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function maskPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'not-configured';
  if (digits.length <= 4) return `***${digits}`;
  return `${digits.slice(0, 3)}***${digits.slice(-4)}`;
}

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.name = 'AiCeoPhoneTestError';
    throw error;
  }
}

function summarizeError(error) {
  return error?.message || error?.code || error?.name || String(error || '') || 'unknown_error';
}

async function closePoolForCli() {
  await Promise.race([
    db.pool.end().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
}

async function main() {
  const owners = getConfiguredOwnerPhones();
  const ownerPhone = process.env.AI_CEO_PHONE_TEST_OWNER || owners[0] || '';
  const commandText = process.env.AI_CEO_PHONE_TEST_COMMAND || 'CEO report';
  const nonOwnerPhone = process.env.AI_CEO_PHONE_TEST_NON_OWNER || '+15550001111';
  const timeoutMs = Math.max(5000, Number(process.env.AI_CEO_PHONE_TEST_TIMEOUT_MS || 15000));

  assert(ownerPhone, 'Set AI_CEO_OWNER_PHONES or AI_CEO_PHONE_TEST_OWNER before running the CEO phone test.');
  assert(isAiCeoPhoneCommand(commandText), 'The test command was not recognised as an AI CEO command.');
  assert(isAiCeoOwnerPhone(ownerPhone), `The owner test phone ${maskPhone(ownerPhone)} is not authorised in AI_CEO_OWNER_PHONES.`);
  assert(!isAiCeoOwnerPhone(nonOwnerPhone), 'The non-owner guard phone unexpectedly matched the owner list.');
  assert(process.env.DATABASE_URL, 'Set DATABASE_URL before running the CEO phone test because it verifies live command logging and WhatsApp runtime state.');

  const whatsappRouter = require('../routes/whatsapp');
  const { handleOwnerWhatsappCommand } = require('../services/aiCeoControlService');
  const { processInboundRuntime } = whatsappRouter.__test || {};

  const blocked = await withTimeout(handleOwnerWhatsappCommand({
    phone: nonOwnerPhone,
    commandText,
    contactName: 'Blocked Test'
  }), timeoutMs, 'Non-owner guard command');
  assert(blocked && blocked.handled === false, 'Non-owner phone command was not blocked.');

  const ownerDirect = await withTimeout(handleOwnerWhatsappCommand({
    phone: ownerPhone,
    commandText,
    contactName: 'Founder Phone Test'
  }), timeoutMs, 'Owner direct command');
  assert(ownerDirect && ownerDirect.handled === true, 'Owner phone command was not handled by AI CEO.');
  assert(ownerDirect.response || ownerDirect.summary, 'Owner phone command did not return a report response.');

  assert(typeof processInboundRuntime === 'function', 'WhatsApp runtime test hook is not available.');
  const runtime = await withTimeout(processInboundRuntime({
    phone: ownerPhone,
    inboundMessageId: `ai-ceo-phone-test:${Date.now()}:${crypto.randomUUID()}`,
    body: commandText,
    provider: 'ai_ceo_phone_test',
    metadata: {
      contact_name: 'Founder Phone Test',
      test: true
    }
  }), timeoutMs, 'WhatsApp runtime intercept');
  assert(runtime && runtime.message, 'WhatsApp runtime did not return a CEO reply.');
  assert(
    /MakaUg AI CEO|listing report|lead report|WhatsApp health|revenue report/i.test(runtime.message),
    'WhatsApp runtime reply did not look like an AI CEO response.'
  );

  console.log(JSON.stringify({
    ok: true,
    owner_phone: maskPhone(ownerPhone),
    command: commandText,
    owner_authorized: true,
    non_owner_blocked: true,
    direct_command_handled: true,
    whatsapp_runtime_intercepted: true,
    next_step: runtime.nextStep || null,
    response_preview: String(runtime.message || '').slice(0, 220)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: summarizeError(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePoolForCli();
    process.exit(process.exitCode || 0);
  });
