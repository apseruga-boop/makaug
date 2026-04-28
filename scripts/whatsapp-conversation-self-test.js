require('dotenv').config();

const crypto = require('crypto');
const db = require('../config/database');
const whatsappRouter = require('../routes/whatsapp');

const { processInboundRuntime } = whatsappRouter.__test;

const RUN_ID = `selftest-${Date.now().toString(36)}`;
const PHONE_PREFIX = `sim-${RUN_ID}`;
const LIVE_BASE_URL = String(process.env.WHATSAPP_SELF_TEST_BASE_URL || '').replace(/\/+$/, '');
const BRIDGE_TOKEN = String(process.env.WHATSAPP_WEB_BRIDGE_TOKEN || '').trim();
const SOAK_MINUTES = Math.max(0, Number(process.env.WHATSAPP_SELF_TEST_MINUTES || 0));
const SOAK_UNTIL = SOAK_MINUTES > 0 ? Date.now() + SOAK_MINUTES * 60 * 1000 : 0;

const scenarios = [
  {
    name: 'English greeting starts friendly menu',
    messages: ['Hello'],
    expect: [
      { step: 'main_menu', includes: ['property assistant', 'List my property'] }
    ]
  },
  {
    name: 'Luganda greeting keeps language',
    messages: ['Oli otya'],
    expect: [
      { step: 'main_menu', includes: ['MakaUg assistant'] }
    ]
  },
  {
    name: 'Kiswahili greeting keeps language',
    messages: ['Habari'],
    expect: [
      { step: 'main_menu', includes: ['MakaUg', 'Tafuta'] }
    ]
  },
  {
    name: 'Natural property search asks for area when missing',
    messages: ['I need a 2 bedroom house to rent'],
    expect: [
      { step: 'search_area', includes: ['area', 'district'] }
    ]
  },
  {
    name: 'English search menu stays English',
    messages: ['2'],
    expect: [
      {
        step: 'search_type',
        includes: ['What are you looking for?', 'For sale', 'To rent'],
        excludes: ['Onoonya', 'Wandiika', 'Ebitundibwa']
      }
    ]
  },
  {
    name: 'Commercial properties in Kampala are handled',
    messages: ['I am looking for commercial properties in Kampala'],
    expect: [
      { step: 'main_menu', includesAny: ['Commercial', 'Kampala', 'listings', 'request', 'MakaUg'], excludes: ['Wandiika', 'Onoonya'] }
    ]
  },
  {
    name: 'Student accommodation in Kampala searches like the website',
    messages: ['I need student accommodation in Kampala'],
    expect: [
      { step: 'main_menu', includesAny: ['MakaUg', 'listings', 'request', 'student', 'Kampala'], excludes: ['Wandiika', 'Onoonya'] }
    ]
  },
  {
    name: 'User challenges a no-match result without becoming a fake area',
    messages: ['I need student accommodation in Kampala', 'Yes you do I looked at the website'],
    expect: [
      { step: 'main_menu', includesAny: ['MakaUg', 'listings', 'request', 'student', 'Kampala'] },
      { step: 'main_menu', includesAny: ['filtered too narrowly', 'admin', 'live website', 'listings'] }
    ]
  },
  {
    name: 'Property search with area returns results or saves no-match lead',
    messages: ['2', 'Muyenga'],
    expect: [
      { step: 'search_type', includes: ['Onoonya', 'Ebitundibwa'] },
      { step: 'main_menu', includesAny: ['MakaUg', 'listings', 'request'] }
    ]
  },
  {
    name: 'Shared location search progresses',
    messages: [
      '2',
      '6',
      { body: '', location: { lat: 0.3476, lng: 32.5825, label: 'Kampala Central' } }
    ],
    expect: [
      { step: 'search_type' },
      { step: 'search_area' },
      { step: 'main_menu', includesAny: ['km away', 'listings', 'request', 'MakaUg'] }
    ]
  },
  {
    name: 'Find an agent from main menu',
    messages: ['I need to find an agent'],
    expect: [
      { step: 'agent_area', includesAny: ['agent', 'district', 'area'], excludes: ['kitundu', 'Wandiika'] }
    ]
  },
  {
    name: 'Agent search drives to agent website profiles',
    messages: ['I need an agent in Kampala', 'Kampala'],
    expect: [
      { step: 'agent_area', includesAny: ['agent', 'district', 'area'] },
      { step: 'main_menu', includesAny: ['/agents/', 'Profile:', 'verified agent', 'No verified'], excludes: ['Wandiika'] }
    ]
  },
  {
    name: 'Agent registration points to broker website page',
    messages: ['How do I sign up as an agent?'],
    expect: [
      { step: 'main_menu', includesAny: ['Register as a broker', '#page-brokers', 'broker'], excludes: ['Wandiika'] }
    ]
  },
  {
    name: 'Mid-flow intent switch to agent',
    messages: ['1', '1', '1', 'Nice house in Ntinda', 'I need to find an agent'],
    expect: [
      { step: 'listing_type' },
      { step: 'ownership' },
      { step: 'title' },
      { step: 'district' },
      { step: 'agent_area', includesAny: ['agent', 'district', 'kitundu'] }
    ]
  },
  {
    name: 'Listing photo flow accepts five web media placeholders',
    messages: [
      '1',
      '1',
      '1',
      '3 bedroom house in Ntinda',
      'Kampala',
      'Ntinda',
      '250000000',
      '3',
      'Modern home near the main road with parking and security.',
      { mediaUrl: 'whatsapp-web://front', mediaType: 'image' },
      { mediaUrl: 'whatsapp-web://living-room', mediaType: 'image' },
      { mediaUrl: 'whatsapp-web://bedroom', mediaType: 'image' },
      { mediaUrl: 'whatsapp-web://kitchen', mediaType: 'image' },
      { mediaUrl: 'whatsapp-web://bathroom', mediaType: 'image' },
      'DONE'
    ],
    expectLast: { step: 'ask_id_number', includesAny: ['National ID', 'NIN'] }
  },
  {
    name: 'Commercial listing reaches commercial details',
    messages: [
      '1',
      '5',
      '1',
      'Retail shop in Kampala',
      'Kampala',
      'Kololo',
      '3000000',
      '0'
    ],
    expectLast: { step: 'description', includesAny: ['Describe your property'] }
  },
  {
    name: 'Student listing asks nearest university',
    messages: [
      '1',
      '4',
      '1',
      'Student hostel near Makerere',
      'Kampala',
      'Wandegeya',
      '800000',
      '1'
    ],
    expectLast: { step: 'ask_university', includesAny: ['nearest university'] }
  },
  {
    name: 'Out-of-country support request routes to human support',
    messages: ['I am in London and need human help with my account'],
    expect: [
      { step: 'main_menu', includesAny: ['Human support', 'info@makaug.com', '+256'] }
    ]
  },
  {
    name: 'STOP opts out cleanly',
    messages: ['STOP'],
    expect: [
      { step: 'main_menu', includes: ['unsubscribed'] }
    ]
  }
];

function messageText(item) {
  if (typeof item === 'string') return item;
  return item.body || item.text || item.mediaUrl || '[location]';
}

function makePhone(index) {
  return `${PHONE_PREFIX}-${String(index + 1).padStart(2, '0')}`;
}

async function cleanupPhones(phones) {
  if (!phones.length) return;
  await db.query('DELETE FROM whatsapp_messages WHERE user_phone = ANY($1)', [phones]);
  await db.query('DELETE FROM whatsapp_intent_logs WHERE user_phone = ANY($1)', [phones]);
  await db.query('DELETE FROM whatsapp_user_profiles WHERE phone = ANY($1)', [phones]);
  await db.query('DELETE FROM whatsapp_conversation_state WHERE phone = ANY($1)', [phones]);
  await db.query('DELETE FROM property_search_requests WHERE user_phone = ANY($1)', [phones]);
  await db.query('DELETE FROM property_leads WHERE phone = ANY($1)', [phones]);
  await db.query('DELETE FROM transcriptions WHERE user_phone = ANY($1)', [phones]);
  await db.query('DELETE FROM whatsapp_sessions WHERE phone = ANY($1)', [phones]);
}

async function sendDirect({ phone, item, index }) {
  const payload = typeof item === 'string' ? { body: item } : item;
  return processInboundRuntime({
    phone,
    inboundMessageId: `${phone}:${index}:${crypto.randomUUID()}`,
    body: payload.body || payload.text || '',
    mediaUrl: payload.mediaUrl || null,
    mediaType: payload.mediaType || '',
    sharedLocation: payload.location || null,
    provider: 'conversation_self_test'
  });
}

async function sendLiveDryRun({ phone, item, index }) {
  if (!BRIDGE_TOKEN) {
    throw new Error('WHATSAPP_WEB_BRIDGE_TOKEN is required for WHATSAPP_SELF_TEST_BASE_URL mode.');
  }

  const payload = typeof item === 'string' ? { body: item } : item;
  const response = await fetch(`${LIVE_BASE_URL}/api/whatsapp/web-bridge/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-whatsapp-web-bridge-token': BRIDGE_TOKEN
    },
    body: JSON.stringify({
      client_id: 'makaug-conversation-self-test',
      operator_name: 'Conversation Self Test',
      phone,
      body: payload.body || payload.text || '',
      media_url: payload.mediaUrl || '',
      media_type: payload.mediaType || '',
      shared_location: payload.location || null,
      message_id: `${phone}:${index}:${crypto.randomUUID()}`,
      dry_run: true,
      metadata: { run_id: RUN_ID, scenario_index: index }
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) {
    throw new Error(`Live dry-run failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }

  return {
    message: json.data?.message || '',
    nextStep: json.data?.next_step || ''
  };
}

function assertExpectation({ scenario, index, result, expectation }) {
  if (!expectation) return [];
  const failures = [];
  const text = String(result.message || '');

  if (expectation.step && result.nextStep !== expectation.step) {
    failures.push(`expected step ${expectation.step}, got ${result.nextStep}`);
  }

  for (const needle of expectation.includes || []) {
    if (!text.toLowerCase().includes(String(needle).toLowerCase())) {
      failures.push(`expected reply to include "${needle}"`);
    }
  }

  for (const needle of expectation.excludes || []) {
    if (text.toLowerCase().includes(String(needle).toLowerCase())) {
      failures.push(`expected reply not to include "${needle}"`);
    }
  }

  if (expectation.includesAny?.length) {
    const ok = expectation.includesAny.some((needle) => text.toLowerCase().includes(String(needle).toLowerCase()));
    if (!ok) failures.push(`expected reply to include one of ${expectation.includesAny.map((x) => `"${x}"`).join(', ')}`);
  }

  return failures.map((failure) => `${scenario.name} message ${index + 1}: ${failure}`);
}

async function runScenario(scenario, scenarioIndex) {
  const phone = makePhone(scenarioIndex);
  const transcript = [];
  let failures = [];

  for (let i = 0; i < scenario.messages.length; i += 1) {
    const item = scenario.messages[i];
    const startedAt = Date.now();
    const result = LIVE_BASE_URL
      ? await sendLiveDryRun({ phone, item, index: i })
      : await sendDirect({ phone, item, index: i });
    const elapsedMs = Date.now() - startedAt;
    transcript.push({
      user: messageText(item),
      reply: result.message,
      nextStep: result.nextStep,
      elapsedMs
    });
    failures = failures.concat(assertExpectation({
      scenario,
      index: i,
      result,
      expectation: scenario.expect?.[i]
    }));
  }

  if (scenario.expectLast) {
    const last = transcript[transcript.length - 1];
    failures = failures.concat(assertExpectation({
      scenario,
      index: transcript.length - 1,
      result: { message: last.reply, nextStep: last.nextStep },
      expectation: scenario.expectLast
    }));
  }

  return {
    name: scenario.name,
    phone,
    ok: failures.length === 0,
    failures,
    transcript
  };
}

async function main() {
  const phones = scenarios.map((_, index) => makePhone(index));
  if (!LIVE_BASE_URL) await cleanupPhones(phones);

  const allResults = [];
  let iteration = 0;
  do {
    iteration += 1;
    const results = [];
    console.log(`\nConversation self-test iteration ${iteration}${SOAK_MINUTES ? ` (${SOAK_MINUTES} minute soak)` : ''}`);
    for (let i = 0; i < scenarios.length; i += 1) {
      const result = await runScenario(scenarios[i], i + (iteration - 1) * scenarios.length);
      results.push(result);
      allResults.push(result);
      const symbol = result.ok ? 'PASS' : 'FAIL';
      console.log(`${symbol} ${result.name}`);
      if (!result.ok) {
        result.failures.forEach((failure) => console.log(`  - ${failure}`));
        const last = result.transcript[result.transcript.length - 1];
        console.log(`  last step: ${last?.nextStep || 'n/a'}`);
        console.log(`  last reply: ${String(last?.reply || '').replace(/\s+/g, ' ').slice(0, 240)}`);
      }
    }

    const failed = results.filter((result) => !result.ok);
    console.log(`${results.length - failed.length}/${results.length} WhatsApp conversation scenarios passed in iteration ${iteration}.`);
    if (failed.length || !SOAK_UNTIL) break;
  } while (Date.now() < SOAK_UNTIL);

  const failed = allResults.filter((result) => !result.ok);
  console.log(`\n${allResults.length - failed.length}/${allResults.length} total WhatsApp conversation scenario runs passed.`);

  if (!LIVE_BASE_URL && process.env.WHATSAPP_SELF_TEST_KEEP_DATA !== 'true') {
    await cleanupPhones(phones);
  }

  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!LIVE_BASE_URL) await db.pool.end().catch(() => {});
  });
