'use strict';

/**
 * An agent forwarding a burst of adverts, 16 Nov 2026.
 *
 * An approved agent forwarded fifteen adverts (a video each, the advert as its
 * caption) in three minutes. He was sent a long "Saved" for each one, eleven
 * messages ending with the same three paragraphs; a house "in Nsangi - Masaka
 * road" went in under Masaka; a block "fetching $20000 per month … Price is
 * $1.4Million" went in at its monthly income, and rentals "each being rented
 * at 500k … Price is ugx. 580Million" at one room's rent; Zilobwe, Mpereerwe
 * and Gayaza were each asked for a district; and "Why" got the same list back.
 *
 * Every caption is as he sent it, without his number. Every number here is
 * made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const router = require('../routes/whatsapp');

const {
  employeePropertyFacts,
  employeePropertyMissing,
  agentAdvertBurst,
  agentHeldSavedSummary,
  agentSummaryLabel,
  agentSummaryPrice,
  agentWhyReply,
  AGENT_WHY,
  retireStaleAgentSubmissions
} = router.__test;

const NAGURU = 'Naguru; Block of fully serviced apartments for sale; 12 units of 2 and 3 bedroom. Fetching $20000 USD  per month Fully occupied. \nPrice is  $1.4Million USD';
const BUKASA = 'Rentals for sale in Muyenga bukasa!!\n\n* 9 units,  8 studio rooms , each being rented at 500k, + 1 main house of 2 bedrooms being rented at 1.5m per month with a private milo land.   Making 5.5 MILLION a month\n\nPrice is ugx. 580Million only\nReady private Mailo land title \nCONTACT';
const NSANGI = 'Bank pressure sale!!\n\nA house for sale in Nsangi - Masaka road ( 700 metres off main road)\n\n* 8 bedrooms, 4 bathrooms, sitted on 32 decimals plot size with a private milo land title!\n\nPrice is ugx. 350million only ( reduced from 600m)\nReady private Mailo land title \nCONTACT:';
const ZILOBWE = '5 ACRES OF LAND IN ZILOBWE\nWABITUNGULU TOWN\nCOMMERCIAL LAND\nEACH ACRE GOES FOR 45MILLION \nREADY PRIVATE MAILO LAND TITLE \nCONTACT:';
const MPEREERWE = 'ONE ACRE IN MPEREERWE,NAMERE\nWELFENCED 550MILLION \nREADY PRIVATE MAILO LAND TITLE \nCONTACT:';
const GAYAZA = '19 ACRES OF LAND IN GAYAZA JANDA SANGA VILLAGE \nEACH ACRE GOES FOR 45MILLION \nREADY PRIVATE MAILO LAND TITLE';
const BUNGA = 'Extraordinary Mansion villa for sale in Bunga Kampala \nFor more information \nCONTACT:';

const video = (name) => ({ url: `https://media.makaug.com/replay/${name}.mp4`, mimeType: 'video/mp4', kind: 'video' });

test('the figure the caption calls the price is the price, not what the property earns', () => {
  const naguru = employeePropertyFacts(NAGURU, {});
  assert.strictEqual(naguru.priceMetadata.price_original_currency, 'USD');
  assert.strictEqual(Number(naguru.priceMetadata.price_original), 1400000);
  assert.strictEqual(naguru.pricePeriod, 'once');

  const bukasa = employeePropertyFacts(BUKASA, {});
  assert.strictEqual(Number(bukasa.price), 580000000);
  assert.strictEqual(bukasa.pricePeriod, 'once');

  const nsangi = employeePropertyFacts(NSANGI, {});
  assert.strictEqual(Number(nsangi.price), 350000000, 'the price, not the price it was reduced from');
});

test('a district followed by "road" names the road: Nsangi - Masaka road is in Wakiso', () => {
  const facts = employeePropertyFacts(NSANGI, {});
  assert.strictEqual(facts.locationPatch.area, 'Nsangi');
  assert.strictEqual(facts.locationPatch.district, 'Wakiso');
  assert.deepStrictEqual(employeePropertyMissing(facts), []);
});

test('a place spelt the Luganda way is found: l for r, a letter doubled or not', () => {
  const zilobwe = employeePropertyFacts(ZILOBWE, {});
  assert.strictEqual(zilobwe.locationPatch.area, 'Zirobwe');
  assert.strictEqual(zilobwe.locationPatch.district, 'Luwero');
  assert.strictEqual(zilobwe.pricePeriod, 'acre');

  const mpereerwe = employeePropertyFacts(MPEREERWE, {});
  assert.strictEqual(mpereerwe.locationPatch.area, 'Mpererwe');
  assert.strictEqual(mpereerwe.locationPatch.district, 'Kampala');

  const najera = employeePropertyFacts('3 bedroom house for rent in Najera 1.5m per month', {});
  assert.strictEqual(najera.locationPatch.area, 'Najjera');
  for (const facts of [zilobwe, mpereerwe, najera]) assert.deepStrictEqual(employeePropertyMissing(facts), []);
});

test('Gayaza is the town in Wakiso, but "Nakasaja Gayaza Road" is on the road', () => {
  const gayaza = employeePropertyFacts(GAYAZA, {});
  assert.strictEqual(gayaza.locationPatch.area, 'Gayaza');
  assert.strictEqual(gayaza.locationPatch.district, 'Wakiso');
  assert.deepStrictEqual(employeePropertyMissing(gayaza), []);

  const road = employeePropertyFacts('Plots for sale in Nakasaja Gayaza Road \n\nPlot size: 12 Decimals = 45m ugx', {});
  assert.deepStrictEqual(employeePropertyMissing(road), ['which district Nakasaja is in']);
});

test('the summary names each property the way the agent will know it, at the price he quoted', () => {
  assert.strictEqual(agentSummaryLabel({ listing_type: 'sale', bedrooms: 3, area: 'Naguru', description: NAGURU }), '12 units, Naguru');
  assert.strictEqual(agentSummaryLabel({ listing_type: 'sale', property_type: 'house', bedrooms: 8, area: 'Nsangi', description: NSANGI }), '8-bed house, Nsangi');
  assert.strictEqual(agentSummaryLabel({ listing_type: 'land', area: 'Garuga' }), 'Land, Garuga');
  assert.strictEqual(agentSummaryLabel({ listing_type: 'commercial', area: 'Zirobwe', price_period: 'acre', description: ZILOBWE }), 'Commercial land, Zirobwe');
  assert.strictEqual(agentSummaryLabel({ listing_type: 'sale', property_type: 'apartment', area: 'Mutungo' }), 'Apartment, Mutungo');

  assert.strictEqual(agentSummaryPrice({ price: 5320000000, price_original: 1400000, price_original_currency: 'USD' }), 'USD 1.4M');
  assert.strictEqual(agentSummaryPrice({ price: 450000000, price_period: 'acre' }), 'USh 450M an acre');
  assert.strictEqual(agentSummaryPrice({ price: 1200000000, price_period: 'once' }), 'USh 1.2BN');
  assert.strictEqual(agentSummaryPrice({ price: 1500000, price_period: 'month' }), 'USh 1.5M a month');
  assert.strictEqual(agentSummaryPrice({ price: 0 }), 'price on application');
});

function withFakeDb(reply, run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return reply(String(sql), params) || { rows: [], rowCount: 0 };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

test('the "Saved" replies held in a burst go as one numbered list', async () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const rows = [
    { id: ids[1], listing_type: 'land', area: 'Garuga', district: 'Wakiso', price: 450000000, price_period: 'acre' },
    { id: ids[0], listing_type: 'sale', property_type: 'house', bedrooms: 8, area: 'Nsangi', district: 'Wakiso', price: 350000000, price_period: 'once', description: NSANGI }
  ];
  await withFakeDb((sql) => (/FROM properties/.test(sql) ? { rows } : null), async () => {
    const text = await agentHeldSavedSummary([...ids, 'not-an-id']);
    assert.strictEqual(text, [
      '✅ *Saved 2 of your properties for review:*',
      '1. 8-bed house, Nsangi · USh 350M',
      '2. Land, Garuga · USh 450M an acre'
    ].join('\n'), 'in the order he sent them');
  });
  await withFakeDb(() => null, async (calls) => {
    assert.strictEqual(await agentHeldSavedSummary([]), '');
    assert.strictEqual(calls.length, 0);
  });
});

test('a burst is a second advert within a minute and a half; an advert on its own is answered there and then', async () => {
  for (const [adverts, burst] of [[1, false], [2, true], [15, true]]) {
    await withFakeDb(() => ({ rows: [{ adverts }] }), async (calls) => {
      assert.strictEqual(await agentAdvertBurst('256700000123'), burst);
      assert.match(calls[0].sql, /direction = 'inbound'/);
      assert.strictEqual(calls[0].params[0], '700000123');
      assert.strictEqual(calls[0].params[1], '90');
    });
  }
  await withFakeDb(() => ({ rows: [{ adverts: 5 }] }), async (calls) => {
    assert.strictEqual(await agentAdvertBurst('123'), false);
    assert.strictEqual(calls.length, 0);
  });
});

test('"Why" is answered with the reason, about the first property, not with the list again', () => {
  for (const text of ['Why', 'why?', 'But why', 'Why not', 'what?', '??']) assert.ok(AGENT_WHY.test(text), text);
  for (const text of ['Why is the price wrong', 'price 450m', 'Bunga, Kampala']) assert.ok(!AGENT_WHY.test(text), text);

  const one = agentWhyReply({ whatsapp_agent_self_intake: true, pending_property_caption: BUNGA, pending_property_media: [video('bunga')] });
  assert.match(one, /^That property is safe with me, but I cannot send it to the team yet: it is missing something they need to check it\./);
  assert.match(one, /Extraordinary Mansion villa for sale in Bunga/);
  assert.match(one, /needs the \*price\*/);
  assert.match(one, /reply \*HELP\*/);
  assert.doesNotMatch(one, /each one/);

  const three = agentWhyReply({
    whatsapp_agent_self_intake: true,
    pending_property_caption: BUNGA,
    pending_property_media: [video('bunga')],
    pending_property_queue: [
      { caption: 'House for sale in Kira 300m', media: [] },
      { caption: 'Plot for sale', media: [video('plot')] }
    ]
  });
  assert.match(three, /^Those 3 properties are safe with me, but I cannot send them to the team yet: each one is missing something/);
  assert.match(three, /The first one, "Extraordinary Mansion/);

  assert.strictEqual(agentWhyReply({ whatsapp_agent_self_intake: true }), '', 'nothing waiting: "Why" is not this');
});

test('a property waiting more than three days is not raised again with every new batch', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const fourDaysAgo = new Date(now - 4 * 86400 * 1000).toISOString();
  const anHourAgo = new Date(now - 3600 * 1000).toISOString();
  const data = {
    whatsapp_agent_self_intake: true,
    pending_property_caption: 'House for sale in Nsangi 8 bedrooms',
    pending_property_media: [video('old')],
    pending_property_media_stored_at: fourDaysAgo,
    pending_property_queue: [
      { caption: BUNGA, media: [video('bunga')], storedAt: anHourAgo },
      { caption: 'Plot for sale in Kira', media: [video('kira')], storedAt: fourDaysAgo }
    ]
  };
  assert.strictEqual(retireStaleAgentSubmissions(data, now), 2);
  assert.strictEqual(data.pending_property_caption, BUNGA, 'the newest one is asked about now');
  assert.ok(!data.pending_property_queue, 'nothing else waiting');
  assert.deepStrictEqual(data.retired_agent_submissions.map((entry) => entry.caption), ['Plot for sale in Kira', 'House for sale in Nsangi 8 bedrooms']);
  assert.ok(data.retired_agent_submissions.every((entry) => entry.retired_at === new Date(now).toISOString()));

  const fresh = { whatsapp_agent_self_intake: true, pending_property_caption: BUNGA, pending_property_media: [video('b')], pending_property_media_stored_at: anHourAgo };
  assert.strictEqual(retireStaleAgentSubmissions(fresh, now), 0);
  assert.strictEqual(fresh.pending_property_caption, BUNGA);

  const staff = { pending_property_caption: BUNGA, pending_property_media: [video('s')], pending_property_media_stored_at: fourDaysAgo };
  assert.strictEqual(retireStaleAgentSubmissions(staff, now), 0, 'a staff batch is not the agent list');
});

test('in a burst the "Saved" and "added to" replies wait for the one summary', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const runtime = src.slice(src.indexOf('const batchSummaryApplies = provider'), src.indexOf("detectedIntent: 'employee_property_intake'"));
  assert.match(runtime, /\/\^✅ \\\*\(\?:Saved\|Also saved\) —\/\.test/);
  assert.match(runtime, /\/\^📸 Thank you — I have added \/\.test/);
  assert.strictEqual((runtime.match(/await agentAdvertBurst\(phone\)/g) || []).length, 2, 'only in a burst');
  assert.match(runtime, /holdAgentSavedConfirmations\(/);
  assert.match(runtime, /holdAgentNote\(/);

  const summary = src.slice(src.indexOf('async function buildEmployeeBatchSummary'), src.indexOf('const employeeBatchSummaryLastSent'));
  assert.match(summary, /agentHeldSavedSummary\(heldIds\)/);
  assert.match(summary, /session_data - 'agent_held_saved_ids'/);
  assert.match(summary, /session_data - 'agent_held_notes'/);
  assert.match(summary, /retireStaleAgentSubmissions\(data\)/);
  assert.match(summary, /!agentHeldSomething\) return ''/);
});

test('a property sent again with a video is thanked for a video, and says which property', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const topUp = src.slice(src.indexOf('async function agentTopUpExistingProperty'), src.indexOf('function staffDroppedMediaWarning'));
  assert.match(topUp, /item\.kind === 'video'/);
  assert.match(topUp, /to your property\$\{place \? ` in \$\{place\}` : ''\} that you sent us before/);
  assert.doesNotMatch(topUp, /'photos\/videos'/);
});
