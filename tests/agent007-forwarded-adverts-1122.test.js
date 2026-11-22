'use strict';

/**
 * 22 Nov 2026, 09:47 in Kampala. An agent's twenty adverts were forwarded to
 * Agent 007 in three seconds. Several things went wrong; the first fix (the
 * same morning) placed each photo with no caption on the captioned photo or
 * video sent just before it. That afternoon every photo was looked at, and the
 * order did not say whose a photo was:
 *
 *  - The Kira house's caption was on its second photo, so its first photo came
 *    between the Kasangati plot and the Kira caption.
 *  - Three more Kira house photos came after the Shimoni video and the
 *    Nakwero and Najjera captions, a tenth of a second after the rest.
 *  - Two videos had their descriptions written inside the video (a Mbalwa
 *    house, a Kisubi plot): separate adverts, not the Namugongo plot's.
 *  - Closing the batch put what was left on "the closest match": seven Kira
 *    house photos would have gone on the Nakwero plot.
 *
 * Arthur: in a batch of several adverts a photo with no description is held
 * and named, never guessed. Also covered here: a different plot at the same
 * price is not a repeat, and the same file at the same price is.
 *
 * Captions are the real ones; the ids and numbers are made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const { decideIntakeRepeat, captionsStateDifferentFacts, captionLandDecimals, captionBedrooms } = require('../utils/listingIntakeQuality');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const photo = (n) => ({ url: `https://media.example.invalid/p${n}.jpg`, sha256: `sha-p${n}`, kind: 'image', mimeType: 'image/jpeg', name: `p${n}.jpg` });
const clip = (n) => ({ url: `https://media.example.invalid/v${n}.mp4`, sha256: `sha-v${n}`, kind: 'video', mimeType: 'video/mp4', name: `v${n}.mp4` });

/** The batch once each advert that came with its description has made its property. */
function batch() {
  const data = { property_ids: [] };
  const made = (id, media, caption) => {
    route.noteEmployeePropertyCreated(data, id, media, caption);
    route.noteEmployeeBatchDescription(data, caption);
    data.property_ids.push(id);
  };
  made('kasangati', [photo(1)], '24 decimals Kasangati Mawule nalusugga 3 km off kasangati matugga tarmac UGX 90 million');
  made('kira-house', [photo(3)], 'Kira 4 bedrooms house with staff quarters on 13 decimals plot UGX 550 million');
  made('nakwero', [photo(9)], '12 decimals plot Kira Nakwero UGX 65 million');
  made('najjera', [clip(10)], 'One acre NAJEERA UGX1 billion');
  made('namugongo', [clip(17)], '25 decimals commercial plot NAMUGONGO UGX 300 million');
  made('bulindo', [clip(20)], 'KIRA BULINDO TOWN 12 DOUBLE RENTAL UNITS APARTMENT BLOCK 11M MONTHLY INCOME SELLING UGX 1.1BILLION');
  return data;
}

async function withAttachSpy(fn) {
  const original = db.query;
  const attempted = [];
  db.query = async (sql, params) => {
    if (/FROM properties\s+WHERE id = \$1 AND status = 'pending'/.test(sql)) attempted.push(params[0]);
    return { rows: [] };
  };
  try { await fn(attempted); } finally { db.query = original; }
}

test('in a batch of several adverts, photos with no description are not placed, not even when it closes', async () => {
  await withAttachSpy(async (attempted) => {
    const data = batch();
    data.pending_property_media = [photo(2), photo(4), photo(5), photo(6), photo(8), photo(11), photo(12), clip(18), clip(19)];
    await route.settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, [], 'nothing placed while the batch is open');
    await route.settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, [], 'and nothing when it closes: the last photo listing was Nakwero, a plot');
    assert.strictEqual(route.employeePendingStoredMedia(data).length, 9, 'all nine still held, to be named');
  });
});

test('when the batch described one advert, its photos go on it when the batch closes', async () => {
  await withAttachSpy(async (attempted) => {
    const data = { property_ids: [], pending_property_media: [photo(2), photo(4)] };
    route.noteEmployeePropertyCreated(data, 'kira-house', [photo(3)], 'Kira 4 bedrooms house with staff quarters on 13 decimals plot UGX 550 million');
    route.noteEmployeeBatchDescription(data, 'Kira 4 bedrooms house with staff quarters on 13 decimals plot UGX 550 million');
    // The same words again (a second forward of the same advert) are still one advert.
    route.noteEmployeeBatchDescription(data, '  Kira 4 bedrooms house with staff quarters on 13 decimals plot UGX 550 million ');
    data.property_ids.push('kira-house');
    await route.settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, [], 'not while the batch is open');
    await route.settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, ['kira-house']);
  });
});

test('one property but two adverts described (one a repeat): nothing placed', async () => {
  await withAttachSpy(async (attempted) => {
    const data = { property_ids: ['kira-house'], pending_property_media: [photo(8)] };
    route.noteEmployeePropertyCreated(data, 'kira-house', [photo(3)], 'Kira 4 bedrooms house');
    route.noteEmployeeBatchDescription(data, 'Kira 4 bedrooms house with staff quarters on 13 decimals plot UGX 550 million');
    route.noteEmployeeBatchDescription(data, '12.4 decimals Kira Shimoni with 4 bedrooms shell house UGX 175 million negotiable', { repeat: true });
    await route.settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, []);
  });
});

test('photos after a repeat are held, not given to the property before it; a new description ends that', () => {
  const data = {};
  route.noteEmployeeBatchDescription(data, '12.4 decimals Kira Shimoni with 4 bedrooms shell house UGX 175 million', { repeat: true });
  assert.strictEqual(data.employee_after_repeat, true);
  route.noteEmployeeBatchDescription(data, '12 decimals plot Kira Nakwero UGX 65 million');
  assert.strictEqual(data.employee_after_repeat, undefined);
  const source = read('routes/whatsapp.js');
  const held = source.slice(source.indexOf('const heldFromBurst = !caption'), source.indexOf('if (heldFromBurst) data.pending_media_from_burst = true;'));
  assert.match(held, /employeeInForwardedBurst\(data\)/);
  assert.match(held, /Number\(runtime\.describedWaiting \|\| 0\) > 0/, 'another description waiting in line');
  assert.match(held, /data\.employee_after_repeat === true && data\.whatsapp_agent_self_intake !== true/, 'staff batches only');
});

test('the send-order guess is gone', () => {
  const source = read('routes/whatsapp.js');
  for (const gone of ['employeeOwnerBySendOrder', 'noteEmployeeCaptionMark', 'employee_caption_marks', 'current_sender_ms_known', 'EMPLOYEE_ALBUM_FOLLOW_MS', 'EMPLOYEE_ORPHAN_MEDIA_WINDOW_MS']) {
    assert.ok(!source.includes(gone), `${gone} should be gone`);
  }
  // Every description in a batch is counted where it is handled.
  assert.match(source, /if \(looksLikePropertyCaption\(cleanBody\)\) noteEmployeeBatchDescription\(data, cleanBody\);/);
  assert.match(source, /noteEmployeeBatchDuplicate\(data, caption, existingProperty\);\n\s+noteEmployeeBatchDescription\(data, caption, \{ repeat: true \}\);/);
  assert.match(source, /noteEmployeePropertyCreated\(data, propertyId, storedMedia, caption\);\n\s+noteEmployeeBatchDescription\(data, caption\);/);
});

test('the runtime tells the intake how many descriptions are waiting behind a message', () => {
  const source = read('routes/whatsapp.js');
  assert.match(source, /describes: looksLikePropertyCaption\(normalizeInput\(input\.body \|\| ''\)\)/);
  assert.match(source, /describedWaiting: sendOrder\.describedWaiting\(whatsappLineKey\(phone\)\)/);
  assert.strictEqual(route.whatsappLineKey('+256 700 000 111'), route.whatsappLineKey('256700000111'));
});

test('COMPLETE names held photos for what they are, and the way out', () => {
  const source = read('routes/whatsapp.js');
  const block = source.slice(source.indexOf('photos held in a batch of several adverts are not one'), source.indexOf("const blocker = !pendingCaption"));
  assert.match(block, /data\.pending_media_from_burst === true/);
  assert.match(block, /came with no description in the middle of several adverts, so I have not guessed/);
  assert.match(block, /Reply \*CANCEL\* to close the batch\. The listings stay in staff review/);
});

test('giving a photo to the property being built does not throw away the photos held for another', () => {
  const source = read('routes/whatsapp.js');
  const attach = source.indexOf('propertyId: data.current_property_id,\n        storedMedia,');
  assert.ok(attach > 0);
  const block = source.slice(attach, attach + 1600);
  assert.match(block, /const parked = normalizeInput\(data\.pending_property_caption \|\| ''\) \? \[\] : employeePendingStoredMedia\(data\);/);
  assert.ok(block.indexOf('clearEmployeePendingMedia(data);') < block.indexOf('if (parked.length) rememberEmployeePendingMedia(data, parked, parkedMessageId);'), 'cleared, then the held ones put back');
});

test('the same file at the same price is the same advert', async () => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'shimoni-16-nov', status: 'approved', price: '175000000' }] };
  };
  try {
    const video = { url: 'https://media.example.invalid/v7.mp4', sha256: 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789', kind: 'video' };
    const found = await route.findListingWithSameMedia([video, { url: 'x', sha256: 'not-a-hash' }], 175000000);
    assert.strictEqual(found.id, 'shimoni-16-nov');
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].sql, /extra_fields->'media_sha256' \?\| \$1::text\[\]/);
    assert.match(calls[0].sql, /status IN \('pending','approved'\)/);
    assert.match(calls[0].sql, /AND price = \$2/);
    assert.deepStrictEqual(calls[0].params, [['abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'], 175000000]);
    calls.length = 0;
    assert.strictEqual(await route.findListingWithSameMedia([video], 0), null, 'no price, no match');
    assert.strictEqual(await route.findListingWithSameMedia([{ url: 'x', sha256: '' }], 175000000), null, 'no file hash, no match');
    assert.strictEqual(calls.length, 0, 'and no query');
  } finally {
    db.query = original;
  }
  const source = read('routes/whatsapp.js');
  const check = source.slice(source.indexOf('The same file at the same price is the same advert.'), source.indexOf('const propertyId = await createEmployeeReviewProperty({ phone, inboundMessageId, caption, facts, storedMedia, sessionData: data });'));
  assert.match(check, /data\.whatsapp_agent_self_intake !== true/, 'staff batches');
  assert.match(check, /noteEmployeeBatchDuplicate\(data, caption, sameFiles\);/, 'listed as already on makaug');
  assert.match(check, /duplicate: true/);
});

test('the same advert again later in the batch, with a different file, is the listing its files matched', async () => {
  const original = db.query;
  db.query = async () => ({ rows: [] });
  try {
    const sessionData = {
      agent: { id: 'agent-1', whatsapp: '+256700000777' },
      employee_batch_file_repeats: [{
        id: 'shimoni-16-nov',
        status: 'approved',
        price: '175000000',
        area: 'Shimoni Estate',
        district: 'Wakiso',
        caption_hash: 'first-forward',
        source_caption: '12.4 decimals Kira Shimoni with 4 bedrooms shell house UGX 175 million negotiable',
        phone_digits: '256700000777'
      }]
    };
    const facts = { listingType: 'sale', price: 175000000, locationPatch: { area: 'Shimoni Estate', district: 'Wakiso' } };
    const again = await route.findEmployeeDuplicateProperty({ caption: '12.4 decimals plot Kira Shimoni with 4 bedrooms shell house UGX 175 million', facts, sessionData });
    assert.ok(again, 'a repeat');
    assert.strictEqual(again.id, 'shimoni-16-nov');
    const other = await route.findEmployeeDuplicateProperty({
      caption: '12 decimals plot Kira Nakwero UGX 65 million',
      facts: { listingType: 'sale', price: 65000000, locationPatch: { area: 'Nakwero', district: 'Wakiso' } },
      sessionData
    });
    assert.strictEqual(other, null, 'another advert is not');
  } finally {
    db.query = original;
  }
  const source = read('routes/whatsapp.js');
  assert.match(source, /\[\.\.\.result\.rows, \.\.\.batchRepeats\]/);
  assert.match(source, /data\.employee_batch_file_repeats = \[/);
});

test('fifty decimals is not fourteen: a different plot at the same price is not a repeat', () => {
  const house = 'Mbalwa Kyaliwajjala road 5 bedrooms,,staff quarters 14 decimals plot UGX 600 million slightly negotiable';
  const plot = '50 decimals Commercial plot Mbalwa namugongo road UGX 600 million negotiable';
  assert.strictEqual(captionLandDecimals(plot), 50);
  assert.strictEqual(captionLandDecimals(house), 14);
  assert.strictEqual(captionBedrooms(house), 5);
  assert.strictEqual(captionsStateDifferentFacts(plot, house), true);
  const row = { id: 'existing-house', status: 'approved', price: '600000000', area: 'Mbalwa', caption_hash: 'house', source_caption: house, phone_digits: '256700000777' };
  assert.strictEqual(decideIntakeRepeat({ caption: plot, captionHash: 'plot', phoneDigits: '700000777', area: 'Mbalwa', price: 600000000 }, [row]), null);
});

test('the same advert sent twice is still a repeat, and sizes in other units still match', () => {
  const first = '12.4 decimals Kira Shimoni with 4 bedrooms shell house UGX 175 million negotiable';
  const again = '12.4 decimals plot Kira Shimoni with 4 bedrooms shell house UGX 175 million';
  const row = { id: 'shimoni', status: 'pending', price: '175000000', area: 'Kira', caption_hash: 'first', source_caption: first, phone_digits: '256700000777' };
  const decision = decideIntakeRepeat({ caption: again, captionHash: 'again', phoneDigits: '700000777', area: 'Kira', price: 175000000 }, [row]);
  assert.ok(decision && decision.match_type === 'duplicate');
  assert.strictEqual(captionsStateDifferentFacts('1 acre in Mukono at 100m', '100 decimals in Mukono at 100m'), false);
  assert.strictEqual(captionsStateDifferentFacts('4 bed house in Kira', '4bedroom house in Kira'), false);
  assert.strictEqual(captionsStateDifferentFacts('3br house in Kira', '4 bedrooms house in Kira'), true);
  assert.strictEqual(captionsStateDifferentFacts('Namugongo 400m', 'Namugongo 2 houses in same compound'), false, 'nothing stated, nothing contradicted');
});
