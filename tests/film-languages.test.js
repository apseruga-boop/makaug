'use strict';

/**
 * The four films in Luganda and Swahili (14 Nov 2026).
 *
 * Arthur: "can they be silent please also swahili and luganda", and in the
 * brief: "we can also change it in different languages based on the individual".
 *
 * So each film has a Luganda and a Swahili twin, and a staff member asks for
 * one with a word after the number:
 *
 *     Kato Brian | 0772123456 | Luganda
 *
 * Nothing said is English, exactly as before. The message that goes with the
 * film is in the same language as the film. The words the assistant listens
 * for (AGENT, LIST, SOLD…) are never translated, because a translated word
 * would not be answered.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Films and team notices go the way they do in production: through the bridge's queue.
process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const intake = require('../services/whatsappEmployeeIntakeService');
const controlRoom = require('../services/agent007ControlRoom');
const films = require('../services/filmLanguageService');

const ROOT = path.join(__dirname, '..');
const RONALD = '+256709402189';

// ---------------------------------------------------------------------------
// Which language was asked for
// ---------------------------------------------------------------------------

test('a language word is understood however the staff member writes it', () => {
  for (const word of ['Luganda', 'luganda', 'LG', 'lug', 'Oluganda', 'L']) assert.strictEqual(films.filmLanguage(word), 'lg', word);
  for (const word of ['Swahili', 'Kiswahili', 'sw', 'SWA', 'S']) assert.strictEqual(films.filmLanguage(word), 'sw', word);
  for (const word of ['English', 'en', '', 'Wakiso', 'yes', '0772123456']) assert.strictEqual(films.filmLanguage(word), '', `"${word}" is the English film`);
  assert.strictEqual(films.filmLanguageName('lg'), 'Luganda');
  assert.strictEqual(films.filmLanguageName('sw'), 'Swahili');
  assert.strictEqual(films.filmLanguageName(''), 'English');
});

test('the twin film is the same file name with the language at the end', () => {
  assert.strictEqual(films.filmPath('/assets/marketing/makaug-agent-intro-v5.mp4', 'lg'), '/assets/marketing/makaug-agent-intro-v5-lg.mp4');
  assert.strictEqual(films.filmPath('/assets/marketing/makaug-owner-intro-v1.mp4', 'sw'), '/assets/marketing/makaug-owner-intro-v1-sw.mp4');
  assert.strictEqual(films.filmPath('/assets/marketing/makaug-owner-intro-v1.mp4', ''), '/assets/marketing/makaug-owner-intro-v1.mp4');
  assert.strictEqual(films.filmPath('/assets/marketing/makaug-owner-intro-v1.mp4', 'fr'), '/assets/marketing/makaug-owner-intro-v1.mp4', 'a language with no twin is the English film');
});

test('every film has its Luganda and Swahili twin on disk', () => {
  for (const [kind, video] of Object.entries(route.EXPLAINER_VIDEOS)) {
    for (const lang of ['lg', 'sw']) {
      const file = path.join(ROOT, films.filmPath(video.path, lang));
      assert.ok(fs.existsSync(file), `${kind} in ${lang}: ${path.basename(file)} is missing`);
      const size = fs.statSync(file).size;
      assert.ok(size > 1000000 && size < 16 * 1024 * 1024, `${path.basename(file)} is ${size} bytes: WhatsApp takes a video up to 16 MB`);
    }
  }
});

// ---------------------------------------------------------------------------
// "Name | phone | Luganda"
// ---------------------------------------------------------------------------

test('the contact line takes a language at the end, and is unchanged without one', () => {
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772123456'), { fullName: 'Kato Brian', phone: '0772123456' });
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772123456 | Luganda'), { fullName: 'Kato Brian', phone: '0772123456', lang: 'lg' });
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772123456 | kiswahili'), { fullName: 'Kato Brian', phone: '0772123456', lang: 'sw' });
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772 123 456 Luganda'), { fullName: 'Kato Brian', phone: '0772 123 456', lang: 'lg' }, 'the language straight after the number');
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772123456 | English'), { fullName: 'Kato Brian', phone: '0772123456' }, 'English is what goes anyway');
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772123456 | Wakiso'), { fullName: 'Kato Brian', phone: '0772123456' }, 'a third part that is not a language changes nothing');
});

test('the quick "next one" line may carry a language too, and nothing else', () => {
  assert.strictEqual(route.isBarePitchContact('Kato Brian | 0772123456'), true);
  assert.strictEqual(route.isBarePitchContact('Kato Brian | 0772123456 | Luganda'), true);
  assert.strictEqual(route.isBarePitchContact('Kato Brian | 0772123456 Swahili'), true);
  assert.strictEqual(route.isBarePitchContact('Kato Brian | 0772123456 | Wakiso'), false, 'three parts that are not name, number, language are a property, not a contact');
  assert.strictEqual(route.isBarePitchContact('3 bedroom house | 290m | Buwaate'), false);
});

// ---------------------------------------------------------------------------
// What the staff member is asked, and told
// ---------------------------------------------------------------------------

test('each "who should it go to" prompt says how to ask for Luganda or Swahili', () => {
  for (const prompt of [controlRoom.agentFilmPrompt(), controlRoom.ownerFilmPrompt(), controlRoom.howToContactPrompt('agent'), controlRoom.howToContactPrompt('owner')]) {
    assert.match(prompt, /In Luganda or Swahili\? Add it at the end/);
    assert.match(prompt, /\| 0772123456 \| Luganda/);
    assert.match(prompt, /\*Name \| phone number\*/, 'the two fields that are always needed are still first');
  }
});

test('the "sent" message says which language went, and what stays in English', () => {
  const lg = controlRoom.filmSentMessage({ kind: 'owner', name: 'Sarah Nakato', phone: '256772123456', lang: 'lg' });
  assert.match(lg, /Owner film sent to Sarah Nakato/);
  assert.match(lg, /\*Luganda\*: the film's words and the message/);
  assert.match(lg, /my replies to them, are in English/, 'the staff member must know the chat itself is not in Luganda');
  const sw = controlRoom.howToSentMessage({ kind: 'agent', name: 'Kato Brian', phone: '256772123456', lang: 'sw' });
  assert.match(sw, /\*Swahili\*/);
  for (const english of [
    controlRoom.filmSentMessage({ kind: 'owner', name: 'Sarah Nakato', phone: '256772123456' }),
    controlRoom.filmSentMessage({ kind: 'agent', name: 'Kato Brian', phone: '256772123456' }),
    controlRoom.howToSentMessage({ kind: 'owner', name: 'Sarah Nakato', phone: '256772123456' })
  ]) assert.ok(!/Luganda|Swahili/.test(english.split('\n').slice(0, 4).join('\n')), 'nothing is added when the English film went');
});

// ---------------------------------------------------------------------------
// The message that goes with the film
// ---------------------------------------------------------------------------

test('the message is in the film\'s language and keeps the word to reply with', () => {
  const agentLg = films.filmMessage('agent', 'lg', { first: 'Kato' });
  assert.match(agentLg, /^Oli otya Kato 👋/);
  assert.match(agentLg, /Ddamu \*AGENT\* wano/, 'AGENT is what the assistant listens for');
  assert.match(agentLg, /komisoni/);
  const ownerSw = films.filmMessage('owner', 'sw', { first: 'Sarah', ownerFee: 'UGX 20,000' });
  assert.match(ownerSw, /^Habari Sarah 👋/);
  assert.match(ownerSw, /Jibu \*LIST\* hapa/);
  assert.match(ownerSw, /\*UGX 20,000 kwa mwezi kwa kila mali\*/, 'the fee, from the same place the English message takes it');
  assert.match(films.filmMessage('lister', 'lg', { ownerFee: 'UGX 20,000' }), /UGX 20,000 buli mwezi ku buli kirango/);
  assert.match(films.filmMessage('lister', 'lg'), /Ddamu \*LIST\* wano okutandika/);
  const howto = films.filmMessage('agent_howto', 'sw', { first: 'Kato' });
  for (const word of ['SHARE', 'STATUS', 'SOLD', 'HELP']) assert.ok(howto.includes(`*${word}*`), `${word} stays as it is`);
  assert.strictEqual(films.filmMessage('agent', '', { first: 'Kato' }), '', 'English is not kept here');
  assert.strictEqual(films.filmMessage('agent', 'en', { first: 'Kato' }), '');
});

test('no message in any language promises a free period or an automatic charge', () => {
  for (const lang of ['lg', 'sw']) {
    for (const kind of ['agent', 'owner', 'lister', 'agent_howto']) {
      const message = films.filmMessage(kind, lang, { first: 'Kato', ownerFee: 'UGX 20,000' });
      assert.ok(message.length > 60, `${kind} in ${lang} has a message`);
      assert.ok(!/free|bure|bwereere|trial/i.test(message), `${kind} in ${lang}: no free period (10 Nov 2026)`);
      assert.ok(!/undefined|\[object/.test(message));
    }
  }
});

// ---------------------------------------------------------------------------
// The whole exchange: Agent 007 → 4 → "Name | phone | Luganda"
// ---------------------------------------------------------------------------

function withStubbedWorld(run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const sent = [];
  const audits = [];
  let session = null;
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      const blob = params.find((p) => typeof p === 'string' && p.trim().startsWith('{'));
      if (blob) session = JSON.parse(blob);
      return { rows: [] };
    }
    if (/INSERT INTO outbound_message_queue/i.test(sql)) { sent.push(params); return { rows: [{ id: 'queued-1' }] }; }
    if (/INSERT INTO audit_logs/i.test(sql)) { audits.push(params); return { rows: [] }; }
    if (/INSERT INTO agent_prospects/i.test(sql)) return { rows: [{ full_name: params[0], phone: params[1], status: 'pitched', newly_created: true }] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  const at = (step, body, data) => route.handleEmployeeWhatsappIntake({ phone: RONALD, body, session: { current_step: step, session_data: data } });
  return Promise.resolve(run({ at, sent, audits, getSession: () => session }))
    .finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

test('4, then "Name | number | Luganda": the Luganda owner film and its Luganda message go out', async () => {
  await withStubbedWorld(async ({ at, sent, audits }) => {
    const done = await at('employee_owner_pitch_contact', 'Sarah Nakato | 0772123456 | Luganda', { whatsapp_employee_intake: true, employee_role: 'owner_pitch' });
    assert.match(done.message, /Owner film sent to Sarah Nakato/);
    assert.match(done.message, /\*Luganda\*: the film's words and the message/);
    assert.strictEqual(sent.length, 1, 'one message, one film');
    const payload = sent.map((p) => JSON.stringify(p)).join(' ');
    assert.match(payload, /makaug-owner-intro-v1-lg\.mp4/, 'the Luganda twin');
    assert.ok(!/makaug-owner-intro-v1\.mp4/.test(payload), 'and not the English film as well');
    assert.match(payload, /Oli otya Sarah/);
    assert.match(payload, /Ddamu \*LIST\* wano/);
    assert.match(audits.map((p) => JSON.stringify(p)).join(' '), /\\"lang\\":\\"lg\\"/, 'recorded, so her LIST brings the how-to in Luganda too');
  });
});

test('3, then "Name | number Swahili": the Swahili agent film', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const done = await at('employee_pitch_contact', 'Kato Brian | 0772123456 Swahili', { whatsapp_employee_intake: true, employee_role: 'pitch' });
    assert.match(done.message, /Video sent to Kato Brian/);
    assert.match(done.message, /\*Swahili\*/);
    const payload = sent.map((p) => JSON.stringify(p)).join(' ');
    assert.match(payload, /makaug-agent-intro-v5-sw\.mp4/);
    assert.match(payload, /Habari Kato/);
    assert.match(payload, /Jibu \*AGENT\* hapa/);
  });
});

test('no language named: the English film and the English message, exactly as before', async () => {
  await withStubbedWorld(async ({ at, sent, audits }) => {
    const done = await at('employee_owner_pitch_contact', 'Sarah Nakato | 0772123456', { whatsapp_employee_intake: true, employee_role: 'owner_pitch' });
    assert.ok(!/Luganda|Swahili/.test(done.message.split('\n').slice(0, 4).join('\n')));
    const payload = sent.map((p) => JSON.stringify(p)).join(' ');
    assert.match(payload, /makaug-owner-intro-v1\.mp4/);
    assert.match(payload, /Hello Sarah/);
    assert.match(payload, /Reply \*LIST\* here/);
    assert.ok(!/\\"lang\\"/.test(audits.map((p) => JSON.stringify(p)).join(' ')), 'the record of an English send is unchanged');
  });
});

// ---------------------------------------------------------------------------
// What follows by itself: the how-to, when an owner says LIST
// ---------------------------------------------------------------------------

const OWNER = '256772123456';
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

/** An owner who was sent the owner film two hours ago, in `lang` ('' is English). */
function withOwnerWhoGotTheFilm(lang, run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const queued = [];
  db.query = async (sql, params = []) => {
    if (/INSERT INTO outbound_message_queue/i.test(sql)) { queued.push(params); return { rows: [{ id: `queued-${queued.length}`, status: 'pending' }] }; }
    if (/details->>'kind' = 'owner' OR/i.test(sql)) {
      return { rows: [{ created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), details: { kind: 'owner', name: 'Sarah Nakato', sent_by: '447757773202', employee_pitch: true, ...(lang ? { lang } : {}) } }] };
    }
    if (/FROM agent_prospects/i.test(sql)) return { rows: [{ full_name: 'Sarah Nakato', video_kind: 'owner', status: 'pitched', pitched_by_name: 'Arthur' }] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  require('../routes/whatsapp').forgetAgentPhone(OWNER);
  return Promise.resolve(run({ text: () => queued.map((p) => JSON.stringify(p)).join('\n') }))
    .finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

test('an owner who got the film in Luganda and says LIST gets the how-to in Luganda', async () => {
  await withOwnerWhoGotTheFilm('lg', async ({ text }) => {
    const reply = await route.handleOwnerFilmReply({ phone: OWNER, body: 'List', step: 'main_menu', lang: 'en', contactName: 'Sarah N' });
    assert.strictEqual(reply.startListing, true, 'the listing starts as it does for anyone');
    await settle();
    assert.match(text(), /makaug-owner-how-to-list-v4-lg\.mp4/, 'the Luganda how-to');
    assert.ok(!/makaug-owner-how-to-list-v4\.mp4/.test(text()), 'and not the English one as well');
    assert.match(text(), /Engeri y’okulanga/, 'with its Luganda caption');
    assert.match(text(), /UGX 20,000 buli mwezi ku buli kirango/);
  });
});

test('an owner who got the English film and says LIST gets the English how-to, as before', async () => {
  await withOwnerWhoGotTheFilm('', async ({ text }) => {
    await route.handleOwnerFilmReply({ phone: OWNER, body: 'List', step: 'main_menu', lang: 'en', contactName: 'Sarah N' });
    await settle();
    assert.match(text(), /makaug-owner-how-to-list-v4\.mp4/);
    assert.match(text(), /How to list your property on makaug/);
    assert.ok(!/-lg\.mp4|-sw\.mp4/.test(text()));
  });
});

// ---------------------------------------------------------------------------
// The words on screen (scripts/films/lang)
// ---------------------------------------------------------------------------

function wordsFor(lang) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'scripts', 'films', 'lang', `${lang}.js`), 'utf8'), sandbox);
  return sandbox.window.L;
}
const tagsOf = (html) => (html.match(/<\/?[a-z]+[^>]*>/g) || []).join('');
const KEPT = /\b(SHARE|STATUS|SOLD|LET|MY PHOTO|SHORT STAY|HELP|REMOVE|LIST|AGENT|AGREE)\b/g;

test('a translated line keeps the markup, the reply words, the money and the codes of its English line', () => {
  for (const lang of ['lg', 'sw']) {
    const words = wordsFor(lang);
    const lines = Object.entries(words);
    assert.ok(lines.length >= 160, `${lang}: ${lines.length} lines`);
    for (const [english, translated] of lines) {
      assert.ok(translated && translated.trim(), `${lang}: "${english}" has no translation`);
      assert.strictEqual(tagsOf(translated), tagsOf(english), `${lang}: the markup of "${english}"`);
      assert.deepStrictEqual((translated.match(KEPT) || []).sort(), (english.match(KEPT) || []).sort(), `${lang}: the reply words in "${english}"`);
      for (const fixed of english.match(/UGX [\d,]+|\*165\*3#|27248497|makaug\.com|4,700\+|4,708/g) || []) {
        assert.ok(translated.includes(fixed), `${lang}: "${fixed}" must survive in "${translated}"`);
      }
      assert.ok(!/free|bure\b|bwereere/i.test(translated), `${lang}: no free period in "${translated}"`);
    }
  }
});

test('the film sources never name a language file that is not there', () => {
  for (const lang of ['lg', 'sw']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'films', 'lang', `${lang}.js`)));
  }
  const render = fs.readFileSync(path.join(ROOT, 'scripts', 'films', 'render.js'), 'utf8');
  assert.match(render, /\['lg', 'sw'\]\.includes\(flag\('--lang'\)\)/, 'render.js --lang only takes the languages that exist');
});
