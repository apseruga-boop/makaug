'use strict';

/**
 * 18 Nov 2026. Every name and number here is made up.
 *
 * A student pressed WhatsApp on the website's Kyambogo University page. The
 * site wrote "Hi makaug, I'm looking for student accommodation ... Page:
 * makaug.com/student-accommodation/university/kyambogo". Seven seconds later
 * the student's thumb sent "Hl9".
 *
 * 1. The page address was read as a place called "University": "I do not have
 *    an approved Student listing in University right now", then rooms at
 *    Makerere. The Kyambogo University page itself listed thirteen.
 * 2. "Hl9" was answered with the menu, on top of the answer.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const SITE = "Hi makaug, I'm looking for student accommodation. Please help me find safe rooms near campus, with price, distance, rules, and availability. Page: ";

test('a university page is read as that university, never as a place called "University"', () => {
  assert.strictEqual(route.websitePrefillSearchText(`${SITE}makaug.com/student-accommodation/university/kyambogo`), 'student accommodation near Kyambogo University');
  assert.strictEqual(route.websitePrefillSearchText(`${SITE}makaug.com/student-accommodation/university/mubs`), 'student accommodation near Makerere University Business School (MUBS)');
  assert.strictEqual(route.websitePrefillSearchText(`${SITE}makaug.com/hostels/makerere`), 'student accommodation near Makerere University');
  // Unchanged: a place in the address is the place.
  assert.strictEqual(route.websitePrefillSearchText(`${SITE}makaug.com/student-accommodation/kikoni`), 'student accommodation in Kikoni');
  assert.strictEqual(route.websitePrefillSearchText(`${SITE}makaug.com/student-accommodation`), 'student accommodation');
  for (const page of ['makaug.com/student-accommodation/university/not-a-real-one', 'makaug.com/student-accommodation/university']) {
    assert.doesNotMatch(route.websitePrefillSearchText(`${SITE}${page}`), /\bUniversity\b(?! of)/, page);
  }
});

function withRows(rows, run) {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push(String(sql));
    if (/p\.latitude IS NOT NULL AND p\.longitude IS NOT NULL/.test(sql)) return { rows: [] };
    if (/LIMIT 500/.test(sql)) return { rows };
    return { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = original; });
}

const room = (id, university, km = null, extra = {}) => ({
  id, title: `Replay room ${id}`, listing_type: 'rent', area: 'Replay', district: 'Kampala', price: 400000, price_period: 'month',
  nearest_university: university, distance_to_uni_km: km, extra_fields: extra
});

test('student rooms near a university are the ones that name it, nearest first, as its page lists them', async () => {
  const rows = [
    room('a1', 'Kyambogo University'),
    room('a2', 'Makerere University', 0.4),
    room('a3', '', null, { student_university: 'kyambogo' }),
    room('a4', 'Kyambogo University', 1.7),
    room('a5', 'Makerere University Business School (MUBS)', 0.9)
  ];
  await withRows(rows, async () => {
    const found = await route.findStudentRowsForUniversity('Kyambogo University', {});
    assert.deepStrictEqual(found.map((row) => row.id), ['a4', 'a1', 'a3'], 'the one that says how near first, then the rest in order');
    assert.ok(found.every((row) => row.total_count === 3));
  });
  await withRows(rows, async () => {
    const results = await route.findPropertiesNearLandmark({
      searchType: 'student',
      proximity: { radiusMiles: 2, target: 'kyambogo university', kind: 'university', center: { lat: 0.35, lng: 32.63, name: 'Kyambogo University' }, label: 'Kyambogo University' }
    });
    assert.deepStrictEqual(results.map((row) => row.id), ['a4', 'a1', 'a3'], 'none have a map pin inside the radius, and they are still found');
    assert.ok(results.every((row) => row.proximity_header === 'near Kyambogo University'));
    assert.strictEqual(results[0].distance_label, '1.7 km (1.1 mi) from Kyambogo University');
    assert.strictEqual(results[1].distance_label, '');
  });
  // Not a student search, or not a university: unchanged.
  await withRows(rows, async (calls) => {
    const results = await route.findPropertiesNearLandmark({
      searchType: 'rent',
      proximity: { radiusMiles: 2, target: 'kyambogo university', kind: 'university', center: { lat: 0.35, lng: 32.63, name: 'Kyambogo University' }, label: 'Kyambogo University' }
    });
    assert.deepStrictEqual(results, []);
    assert.ok(!calls.some((sql) => /LIMIT 500/.test(sql)));
  });
  assert.strictEqual(route.whatsappSearchResultsUrl('student', 'Kyambogo University'), 'https://makaug.com/student-accommodation/university/kyambogo', 'and "see all" is the university page');
  assert.match(route.whatsappSearchResultsUrl('student', 'Kikoni'), /\/student-accommodation\?listing_type=student&area=Kikoni$/);
});

test('stray keys in the middle of a conversation get no menu', async () => {
  for (const stray of ['Hl9', 'k9', 'Hl', 'hm', 'ab12']) assert.strictEqual(route.isStrayKeys(stray), true, stray);
  for (const real of ['Hi', 'ok', '1', '12', 'MORE', 'yes', 'no', 'Kira', '2bed', '500k', '3br', 'Help', 'rent in Kira']) {
    assert.strictEqual(route.isStrayKeys(real), false, real);
  }
  const original = db.query;
  let seen = null;
  db.query = async (sql, params = []) => {
    seen = { sql: String(sql), params };
    return { rows: params[2] === 'wamid-old' ? [] : [{ '?column?': 1 }] };
  };
  try {
    assert.strictEqual(await route.talkingWithThemJustNow('256700000397', { waMessageId: 'wamid-now' }), true);
    assert.match(seen.sql, /FROM whatsapp_messages[\s\S]*created_at > NOW\(\) - \(\$2 \|\| ' seconds'\)::interval[\s\S]*COALESCE\(wa_message_id, ''\) <> \$3/);
    assert.deepStrictEqual(seen.params[0], ['256700000397', '256700000397', '+256700000397']);
    assert.strictEqual(seen.params[1], '120');
    assert.strictEqual(await route.talkingWithThemJustNow('256700000397', { waMessageId: 'wamid-old' }), false);
  } finally {
    db.query = original;
  }
  // Wired in where the menu would otherwise go, after every real reading of the message.
  const source = read('routes/whatsapp.js');
  const guard = source.indexOf("if (isStrayKeys(cleanBody) && await talkingWithThemJustNow(phone, { waMessageId: runtime.waMessageId })) {");
  const fallback = source.indexOf('await conversationalAssistantFallback({', guard);
  const routed = source.lastIndexOf('const next = await routeReply(lang, inferredRoute, { phone, text: cleanBody });', guard);
  // Between them since 18 Nov: the answers for somebody who has asked to join.
  assert.ok(routed > 0 && guard > routed && fallback > guard && fallback - guard < 1500);
  assert.match(source.slice(guard, guard + 200), /return respond\('', 'main_menu'\);/);
});
