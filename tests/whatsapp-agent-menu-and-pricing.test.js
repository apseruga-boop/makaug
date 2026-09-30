'use strict';

/**
 * Two things an agent sees, and two numbers they must not.
 *
 * 30 Sep 2026. Four land listings went live with a per-acre rate stored as the
 * price of the whole property:
 *
 *   "8000 acres of Fertile Farmland for Sale in Nwoya at 2.5m per acre"
 *      → UGX 2,500,000
 *   "20 acres kayunga kitwe each at 8.5m"              → UGX 8,500,000
 *   "50 ACRES ... Kikyuusa at 13m per acre"            → UGX 13,000,000
 *   "200 acres ... selling all at once @ 12m each acre" → UGX 12,000,000
 *
 * Eight thousand acres of farmland sat on the marketplace for two and a half
 * million shillings and turned up in every search with a five-million ceiling.
 *
 * Two of those captions also say "Luweero district" in as many words, and both
 * went in as Nakaseke — because Kikyusa resolves to Nakaseke in the registry and
 * the lookup beat the agent.
 *
 * And a registered agent who said hello got the marketplace's customer menu:
 * list a property, search properties, find an agent. They are the agent.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  employeePropertyFacts,
  employeePropertyMissing,
  perUnitPriceFacts,
  explicitDistrictInCaption,
  agentMenuReply,
  agentShareReply
} = require('../routes/whatsapp').__test;

const facts = (caption) => employeePropertyFacts(caption, {});
const ugx = (n) => Number(n).toLocaleString('en-GB');

// ---------------------------------------------------------------------------
// The price
// ---------------------------------------------------------------------------

test('a rate per acre becomes the price of all the acres', () => {
  const cases = [
    ['8000 acres of Fertile Farmland for Sale in Nwoya District at 2.5m per acre', 20000000000],
    ['20 acres kayunga kitwe each at 8.5m last 8m with power available', 170000000],
    ['50 ACRES OF MAILO LAND FOR SALE Kayonza, Kikyuusa - Luweero District at 13m per acre', 650000000],
    ['Massive 200 acres on sale in Kamira- Kikyusa, in luweero district, selling all at once @ 12m each acre', 2400000000]
  ];
  for (const [caption, expected] of cases) {
    assert.strictEqual(Number(facts(caption).price), expected,
      `"${caption.slice(0, 40)}…" should be UGX ${ugx(expected)}, not the per-acre rate`);
  }
});

test('the rate the agent quoted is kept, not thrown away', () => {
  const perUnit = facts('20 acres kayunga kitwe each at 8.5m with power').perUnitPrice;
  assert.ok(perUnit, 'the listing has to remember it was priced by the acre');
  assert.strictEqual(perUnit.unit, 'acre');
  assert.strictEqual(perUnit.quantity, 20);
  assert.strictEqual(perUnit.unitPrice, 8500000, 'the number the agent will quote to a buyer');
  assert.strictEqual(perUnit.total, 170000000);
});

test('"each" and "per acre" are the same claim written differently', () => {
  for (const phrase of ['at 12m per acre', 'each at 12m', '@ 12m each acre', 'at 12m an acre', 'at 12m/acre']) {
    const caption = `10 acres for sale in Mukono ${phrase}`;
    assert.strictEqual(Number(facts(caption).price), 120000000, `"${phrase}" was not read as a rate`);
  }
});

test('an ordinary price is left exactly alone', () => {
  const untouched = [
    ['Selling 5 bedroom house in Kololo @600m UGX', 600000000],
    ['Plot for sale in Kira, Wakiso 50x100 at 90m', 90000000],
    ['3 bedroom house for rent in Kira, Wakiso at 1.2m per month', 1200000]
  ];
  for (const [caption, expected] of untouched) {
    assert.strictEqual(Number(facts(caption).price), expected, `"${caption}" must not be multiplied`);
    assert.strictEqual(facts(caption).perUnitPrice, null, 'and must not be marked as a rate');
  }
  // "per month" is a period, not a unit of land, and must never multiply.
  assert.strictEqual(facts('1 bedroom in Ntinda at 700k per month').perUnitPrice, null);
});

test('a rate with nothing to multiply is left as the rate', () => {
  // No quantity in the caption, so there is no honest total to compute.
  const withoutQuantity = facts('Land for sale in Mukono at 12m per acre');
  assert.strictEqual(Number(withoutQuantity.price), 12000000, 'no total may be invented');
  assert.strictEqual(withoutQuantity.perUnitPrice.quantity, 0);
  assert.strictEqual(withoutQuantity.perUnitPrice.unit, 'acre');
});

test('one acre priced per acre is just the price', () => {
  const single = perUnitPriceFacts('1 acre in Mukono at 12m per acre', 12000000);
  assert.strictEqual(single.total, 12000000, 'multiplying by one is still one');
});

// ---------------------------------------------------------------------------
// The district
// ---------------------------------------------------------------------------

test('the district the agent wrote beats the one we inferred', () => {
  // Kikyusa is registered under Nakaseke. The agent said Luweero, twice.
  const patch = facts(
    'Massive 200 acres on sale in Kamira- Kikyusa. Location: Kamira after kikyuusa Luweero (Bombo rd), '
    + 'mailo land title in luweero district, selling all at once @ 12m each acre'
  ).locationPatch;
  assert.strictEqual(patch.district, 'Luwero', 'the agent named the district and was overruled');
  assert.strictEqual(patch.area, 'Kikyusa', 'and the area they named is kept');
  assert.strictEqual(patch.canonical_location_match, 'district_stated_by_agent',
    'staff can see the district came from the caption');
});

test('a district we matched survives even when no area is found', () => {
  // Before, this yielded an empty location once the bogus area stopped being
  // accepted — the listing went live with no location at all.
  const patch = facts('8000 acres of Fertile Farmland for Sale in Nwoya District at 2.5m per acre').locationPatch;
  assert.strictEqual(patch.district, 'Nwoya');
  assert.ok(!patch.area, 'the area is genuinely unknown and must not be guessed');
  assert.deepStrictEqual(employeePropertyMissing(facts('8000 acres of Fertile Farmland for Sale in Nwoya District at 2.5m per acre')),
    ['exact area and district'], 'so intake asks for it rather than publishing a district-only listing');
});

test('explicit districts are read, made-up ones are not', () => {
  assert.strictEqual(explicitDistrictInCaption('plot in luweero district')?.match?.district, 'Luwero');
  assert.strictEqual(explicitDistrictInCaption('land for sale in Nwoya District')?.match?.district, 'Nwoya');
  assert.strictEqual(explicitDistrictInCaption('near the district headquarters'), null,
    '"district headquarters" names no district');
  assert.strictEqual(explicitDistrictInCaption('in Narnia district'), null);
});

test('a place we already resolve exactly is not disturbed', () => {
  const kololo = facts('Selling 5 bedroom house in Kololo @600m UGX').locationPatch;
  assert.strictEqual(kololo.area, 'Kololo');
  assert.strictEqual(kololo.district, 'Kampala');
  assert.strictEqual(kololo.canonical_location_match, 'exact_alias', 'a real match stays a real match');
});

// ---------------------------------------------------------------------------
// What an agent sees
// ---------------------------------------------------------------------------

const KATAMBA = {
  id: '9d1f0a3e-1111-2222-3333-444455556666',
  full_name: 'Katamba Bonny',
  phone: '256701895892',
  whatsapp: '256701895892'
};

test('an agent is greeted by name and offered an agent’s options', () => {
  const menu = agentMenuReply({ agent: KATAMBA, greet: true, savedCount: 2 });
  assert.match(menu, /Hello Katamba/, 'by name, first');
  assert.match(menu, /Post a property/);
  assert.match(menu, /Share my listings/);
  assert.match(menu, /2 properties with our team/, 'and what they have in flight');
  assert.match(menu, /you do not need the menu/, 'the menu must not become a toll gate');

  assert.doesNotMatch(menu, /Search properties|Find an agent/,
    'the customer menu offered an agent two options meant for somebody else');
});

test('sharing is one link and one picture', () => {
  const before = process.env.AGENT_REPORT_CARD_SECRET;
  process.env.AGENT_REPORT_CARD_SECRET = 'test-card-secret';
  try {
    const share = agentShareReply({ agent: KATAMBA });
    assert.match(share, new RegExp(`/agents/${KATAMBA.id}`), 'their page, which carries every live listing');
    assert.match(share, /wa\.me\/\?text=/, 'a tap-to-share link, already written for them');
    assert.match(share, new RegExp(`share-card/${KATAMBA.id}`), 'and the card for their status');
    assert.match(share, /Katamba/);
  } finally {
    if (before === undefined) delete process.env.AGENT_REPORT_CARD_SECRET;
    else process.env.AGENT_REPORT_CARD_SECRET = before;
  }
});

test('an unsigned card is left out rather than sent broken', () => {
  const saved = {
    a: process.env.AGENT_REPORT_CARD_SECRET,
    b: process.env.JWT_SECRET,
    c: process.env.WHATSAPP_WEB_BRIDGE_TOKEN
  };
  delete process.env.AGENT_REPORT_CARD_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.WHATSAPP_WEB_BRIDGE_TOKEN;
  try {
    const share = agentShareReply({ agent: KATAMBA });
    assert.doesNotMatch(share, /share-card/);
    assert.match(share, /wa\.me/, 'the link they came for still works');
  } finally {
    for (const [k, v] of [['AGENT_REPORT_CARD_SECRET', saved.a], ['JWT_SECRET', saved.b], ['WHATSAPP_WEB_BRIDGE_TOKEN', saved.c]]) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

test('the greeting is optional, so a mid-batch menu does not say hello twice', () => {
  const quiet = agentMenuReply({ agent: KATAMBA, greet: false });
  assert.doesNotMatch(quiet, /Hello/);
  assert.match(quiet, /Post a property/);
});
