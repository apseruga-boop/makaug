'use strict';

/**
 * 19 Nov 2026. Every name and number here is made up; the adverts are as sent.
 *
 * Ronald loaded a new agent's properties on Agent 007 by forwarding them from
 * the agent's chat: eight descriptions as plain texts, then the photos, all in
 * twenty-two seconds.
 *
 * 1. "1.5 billions negotiable … akright City … 6 bedroom, land size 25
 *    decimals" waited for a price: "billions" was not read.
 * 2. "Plots for sale located at lutembe … 23decimals at 220m", short of its
 *    district only, was taken as the answer. The Akright house went live as
 *    "Land for sale in Akright City, UGX 220,000,000".
 * 3. "Commercial plots located at nican resort … bunamwaya-kitebi" was added to
 *    the Bwebajja plot, which was waiting for nothing, and it was saved as
 *    "Commercial property in Bunamwaya".
 * 4. "Blue available on main road at 290m" and "Green taken, blue is 140m…"
 *    were filed under places called Blue and Green.
 * 5. Four descriptions waited behind the photos longer than the bridge would
 *    wait; it sent them again and each was kept twice.
 * 6. 39 photos were reported as 116.
 *
 * The evening before, a prospect who had the agent film sent "House for sale
 * … Price 160m" and was told what joining costs; his video got the menu.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const agentFilm = require('../services/agentFilmReplyService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const AKRIGHT = '1.5 billions negotiable \nLocation akright City estates entebbe road sectors,6 bedroom, land size 25 decimals title on table';
const BWEBAJJA = '25decimals for sale with clear lake view located at bwebajja -dundu  3mtrs from New lutembe tarmac asking price is 220m';
const LUTEMBE = 'Plots for sale located at lutembe next to ebony shores with clear lake view all plots are 23decimals at 220m';
const BUNAMWAYA = 'Commercial plots located at nican resort after  round about on bunamwaya-kitebi main tarmac';
const BLUE = 'Blue available on main road at 290m each is 12decimals';
const GREEN = 'Green taken, blue is 140m ,pink is 200m commercial plots  ,red is 150m 14decimals  and yellow is 250m commercial 15decimals';

test('prices in billions and millions are read, and a house with bedrooms is a house', () => {
  assert.strictEqual(route.parseListingPriceDraft('1.5 billions negotiable'), 1500000000);
  assert.strictEqual(route.parseListingPriceDraft('selling at 220 millions'), 220000000);
  assert.strictEqual(route.parseListingPriceDraft('500 thousands'), 500000);
  assert.strictEqual(route.parseListingPriceDraft('1.5 billion'), 1500000000, 'unchanged');
  const akright = route.employeePropertyFacts(AKRIGHT, {});
  assert.strictEqual(akright.price, 1500000000);
  assert.strictEqual(akright.listingType, 'sale', 'six bedrooms on 25 decimals is a house');
  assert.deepStrictEqual(route.employeePropertyMissing(akright), []);
  // A plot is still a plot, near houses or not.
  assert.strictEqual(route.employeePropertyFacts('Plot for sale in Kira 50x100 next to 4 bedroom houses at 45m', {}).listingType, 'land');
  assert.strictEqual(route.employeePropertyFacts(LUTEMBE, {}).listingType, 'land');
});

test('the colour of a plot on a site plan is not a place', () => {
  for (const caption of [BLUE, GREEN]) {
    const area = String(route.employeePropertyFacts(caption, {}).locationPatch?.area || '');
    assert.doesNotMatch(area, /^(?:blue|green)$/i, caption);
  }
});

test('a description of another property is never taken as the waiting one\'s missing detail', () => {
  const facts = (text) => route.employeePropertyFacts(text, {});
  // The Akright house waiting for its price (as it was, before "billions" was read).
  const waitingForPrice = AKRIGHT.replace('1.5 billions negotiable', 'negotiable');
  assert.deepStrictEqual(route.employeePropertyMissing(facts(waitingForPrice)), ['price']);
  assert.strictEqual(route.employeeTextDescribesAnotherProperty(waitingForPrice, facts(LUTEMBE), {}), true, 'its own place, size and price');
  // The Bwebajja plot was missing nothing: nothing to answer.
  assert.strictEqual(route.employeeTextDescribesAnotherProperty(BWEBAJJA, facts(BUNAMWAYA), {}), true);
  // Answers are still answers.
  assert.strictEqual(route.employeeTextDescribesAnotherProperty(waitingForPrice, facts('UGX 1.5bn'), {}), false);
  assert.strictEqual(route.employeeTextDescribesAnotherProperty(waitingForPrice, facts('1.5 billion negotiable'), {}), false);
  const waitingForDistrict = 'Plot for sale at Replayville 50x100 at 45m';
  assert.ok(route.employeePropertyMissing(facts(waitingForDistrict)).some((item) => /district/.test(item)));
  for (const answer of ['Wakiso district', 'Wakiso', 'Kira, Wakiso']) {
    assert.strictEqual(route.employeeTextDescribesAnotherProperty(waitingForDistrict, facts(answer), {}), false, answer);
  }
  // Wired into the reply-merging step.
  const source = read('routes/whatsapp.js');
  assert.match(source, /if \(pendingStoredMedia\.length && pendingCaption && textOnlyMissing\.length\n\s+&& !employeeTextDescribesAnotherProperty\(pendingCaption, textOnlyFacts, data\)\) \{/);
});

test('what to type matches what is missing', () => {
  assert.match(route.employeeMissingExample(['price']), /UGX 250m/);
  assert.doesNotMatch(route.employeeMissingExample(['price']), /Kayunga/);
  assert.match(route.employeeMissingExample(['which district Lutembe is in']), /Kayunga town, Kayunga/);
  assert.match(route.employeeMissingExample(['sale/rent/land/commercial/student type']), /for sale/);
});

test('the same description twice is kept once, and the summary counts each photo once', async () => {
  const source = read('routes/whatsapp.js');
  const guard = source.indexOf('const theseWords = sameWords(cleanBody);');
  const merge = source.indexOf('&& !employeeTextDescribesAnotherProperty(pendingCaption, textOnlyFacts, data)) {');
  assert.ok(guard > 0 && merge > guard && merge - guard < 1200);
  assert.match(source.slice(guard, guard + 600), /return \{ handled: true, nextStep: currentStep, message: '' \};/);

  const photo = (id, sha) => ({ url: `https://media.makaug.com/replay/${sha}.jpg`, kind: 'image', sha256: sha, inbound_message_id: id });
  const held = [];
  for (let i = 1; i <= 3; i += 1) {
    // Each photo kept three times over: its previews and the file itself.
    held.push(photo(`wamid-${i}`, `a${i}`), photo(`wamid-${i}`, `b${i}`), photo(`wamid-${i}:ordered-replay:ab12`, `c${i}`));
  }
  const session = {
    current_step: 'employee_property_media',
    session_data: {
      employee_name: 'Replay Staff',
      property_batch_mode: 'multiple',
      property_ids: [],
      pending_property_caption: GREEN,
      pending_property_queue: [
        { caption: BLUE, media: [] },
        { caption: GREEN, media: [] },
        { caption: LUTEMBE, media: [] }
      ],
      employee_unassigned_media: held
    }
  };
  const original = db.query;
  db.query = async (sql) => (/FROM whatsapp_sessions/.test(String(sql)) ? { rows: [session] } : { rows: [] });
  try {
    const summary = await route.buildEmployeeBatchSummary('256700000301', new Date(Date.now() - 60000));
    assert.match(summary, /3 photos\/videos sent without a description/);
    assert.strictEqual((summary.match(/Green taken/g) || []).length, 1, 'listed once');
    assert.match(summary, /Blue available/);
    assert.match(summary, /lutembe/);
  } finally {
    db.query = original;
  }
});

test('a turn already with the runtime keeps its claim when the bridge hangs up', () => {
  const source = read('routes/whatsapp.js');
  const start = source.indexOf("router.post('/web-bridge/inbound'");
  const route_ = source.slice(start, source.indexOf("router.get('/web-bridge/status'", start));
  assert.match(route_, /res\.on\('close', \(\) => \{ if \(!res\.writableFinished && !turnHandedToRuntime\) releaseClaimUnlessHandled\(\); \}\);/);
  const handed = route_.indexOf('turnHandedToRuntime = true;');
  const runtime = route_.indexOf('turn = await processInboundRuntime({');
  assert.ok(handed > 0 && runtime > handed && runtime - handed < 80);
  // A turn that fails still gives the id back for the retry.
  assert.match(route_.slice(runtime, runtime + 600), /catch \(error\) \{[\s\S]*releaseClaimUnlessHandled\(\);[\s\S]*throw error;/);
});

test('an advert from a prospect is an advert, not a question about money', async () => {
  const advert = 'House for sale\nLocation📍\nMaganjo\nAlong bombo road\n1.5km from maganjo town\nSeated\n50 by 100ft\nPrivate mailo land\n2 bedrooms\n2 bathroom\nSitting\nDinning\nKitchen\nGarage\n\n3 double rentals\nSelf-contained\nPrice 160m';
  assert.strictEqual(agentFilm.prospectFollowUpKind(advert), 'advert');
  assert.strictEqual(agentFilm.prospectFollowUpKind('Plot for sale in Kira 50x100 at 45m'), 'advert');
  // Questions about money are still questions.
  for (const question of ['Hope no money z required', 'How much is it to list a house for sale at 150m?', 'What is the price', 'Is it free?']) {
    assert.strictEqual(agentFilm.prospectFollowUpKind(question), 'money', question);
  }
  const reply = agentFilm.prospectFollowUpReply({ kind: 'advert', first: 'Kato', helpName: 'Ronald', fee: 50000, text: advert, passedOn: true, sentBy: 'Ronald' });
  assert.match(reply, /^Thank you, Kato! 🏠 A property like this is exactly what makaug is for\. I've passed this one to Ronald\./);
  assert.match(reply, /UGX 50,000 a month\* covers all your listings/);
  assert.match(reply, /Reply \*AGENT\* and Ronald will call you to set you up\.$/);
  assert.doesNotMatch(reply, /Fair question/);
  assert.doesNotMatch(agentFilm.prospectFollowUpReply({ kind: 'advert', first: 'Kato', passedOn: false }), /passed/);
  assert.match(agentFilm.prospectFollowUpReply({ kind: 'advert', first: 'Kato', interested: true, passedOn: true, sentBy: 'Ronald' }), /^Thank you, Kato! 🏠 I've passed this one to Ronald\. Once your agent page is set up/);
  assert.strictEqual(agentFilm.prospectNoteWorthy('advert'), true);
  assert.match(agentFilm.prospectNote({ digits: '256700000777', name: 'Kato Replay', said: advert, kind: 'advert' }), /^🏠 \*An agent prospect sent a property\*/);

  // The video that follows the advert is part of it: no menu.
  const original = db.query;
  let asked = null;
  db.query = async (sql, params) => { asked = { sql: String(sql), params }; return { rows: [{ '?column?': 1 }] }; };
  try {
    const result = await route.handleAgentFilmReply({ phone: '+256 700 000 777', body: '', hasMedia: true, step: 'main_menu' });
    assert.deepStrictEqual(result, { message: '', nextStep: 'main_menu', silent: true });
    assert.match(asked.sql, /action = 'agent_prospect_advert' AND details->>'phone' = \$1 AND created_at > NOW\(\) - INTERVAL '15 minutes'/);
    assert.deepStrictEqual(asked.params, ['256700000777']);
    db.query = async () => ({ rows: [] });
    assert.strictEqual(await route.handleAgentFilmReply({ phone: '256700000778', body: '', hasMedia: true, step: 'main_menu' }), null, 'any other photo goes on as before');
  } finally {
    db.query = original;
  }
});
