'use strict';

/**
 * One photo, one property.
 *
 * 30 Sep 2026, 11:10:03 → 11:13:39. Ronald forwarded seven adverts from
 * 256709402189. Six review records were created, correctly, one per caption:
 *
 *   fda41707  Un finished rentals … kajjansi … 270m
 *   92bebed5  RENTALS ON SALE … 250M … KAJJANSI
 *   eb194ab4  Clear lake view estate … 85m each … kawuku bwerenga
 *   a17a23fe  12 decimals estate … 45m each … sissa buswa nakawuka
 *   d797775a  A quick sale Plot … 55m … namulanda lutembe
 *   58827a5a  5 bedrooms self contained house … bwebajja akright city
 *
 * Then the Akright record ended up with 28 photos and 3 videos, and six of them
 * were already attached to three of the other records:
 *
 *   BE296558D6ED, E41D88275ECA, 54BD10A7D148   eb194ab4 + 58827a5a
 *   17FDA82AD9D8                               a17a23fe + 58827a5a
 *   408A106625D0, EC5829CD9960                 d797775a + 58827a5a
 *
 * The timestamps in the stored filenames say how: those photos were written a
 * second time at 11:13:50 → 11:15:19, after the last message arrived. That is
 * the browser worker's ordered replay, which re-ingests the batch's media with a
 * mutated message id — `…:ordered-replay:<run>`. The per-property sha256 set
 * stopped a photo being attached to the same record twice. Nothing stopped it
 * being attached to a different one, and by replay time the current property was
 * the last one created.
 *
 * A moderator opened the Akright house and saw a lake-view estate, two plots and
 * somebody else's video.
 */

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const { employeeMediaClaimedElsewhere, attachEmployeeReviewMedia, normalizeEmployeeSourceMessageId } = route;

const AKRIGHT = '58827a5a-c915-45c3-870e-3a0045f072d2';
const BWERENGA = 'eb194ab4-0000-4000-8000-000000000001';

// The three photos that were sent captionless at 11:10:48 and 11:10:49 and
// attached, correctly, to the lake-view estate in Bwerenga.
const BWERENGA_HASHES = ['be296558d6ed', 'e41d88275eca', '54bd10a7d148'];

const photo = (sha256) => ({
  url: `https://cdn.makaug.com/${sha256}.jpg`,
  sha256,
  mimeType: 'image/jpeg',
  kind: 'image',
  name: `${sha256}.jpg`,
  publicEligible: true
});

// A database that knows only what the real one knew at 11:13:50: the Bwerenga
// record exists and holds those three hashes, and the Akright record is pending
// with one photo of its own.
function withFakeDatabase(run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const inserted = [];
  const akrightHashes = ['2dace30a496e'];

  db.query = async (sql, params = []) => {
    if (/jsonb_array_elements_text\(extra_fields -> 'media_sha256'\)/.test(sql)) {
      const [excludedId, hashes] = params;
      if (String(excludedId) === BWERENGA) return { rows: [] };
      return {
        rows: BWERENGA_HASHES
          .filter((sha) => (hashes || []).includes(sha))
          .map((sha) => ({ sha256: sha }))
      };
    }
    if (/SELECT id, extra_fields\s+FROM properties/.test(sql)) {
      return { rows: [{ id: params[0], extra_fields: { media_sha256: akrightHashes, media_count: akrightHashes.length } }] };
    }
    if (/FROM property_images/.test(sql)) {
      return { rows: [{ count: akrightHashes.length, primary_image_url: 'https://cdn.makaug.com/2dace30a496e.jpg' }] };
    }
    if (/INSERT INTO property_images/.test(sql)) {
      inserted.push(params[1]);
      return { rows: [] };
    }
    return { rows: [{ id: params[0] }] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });

  return Promise.resolve(run({ inserted }))
    .finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

test('a photo already attached to another property in the batch is left there', async () => {
  await withFakeDatabase(async () => {
    const claimed = await employeeMediaClaimedElsewhere({
      propertyId: AKRIGHT,
      storedMedia: BWERENGA_HASHES.map(photo)
    });
    assert.deepStrictEqual([...claimed].sort(), [...BWERENGA_HASHES].sort(),
      'all three Bwerenga photos belong to Bwerenga, not to the Akright house');
  });
});

test("a property's own photos are never treated as somebody else's", async () => {
  await withFakeDatabase(async () => {
    const claimed = await employeeMediaClaimedElsewhere({
      propertyId: BWERENGA,
      storedMedia: BWERENGA_HASHES.map(photo)
    });
    assert.strictEqual(claimed.size, 0,
      'the record that holds a photo must still be able to re-attach it during recovery');
  });
});

test('the replayed photos are not attached to the Akright house a second time', async () => {
  await withFakeDatabase(async ({ inserted }) => {
    const attachment = await attachEmployeeReviewMedia({
      propertyId: AKRIGHT,
      // Exactly what the ordered replay re-sent: three photos that were already
      // on Bwerenga, plus one genuinely new photo of the Akright house.
      storedMedia: [...BWERENGA_HASHES.map(photo), photo('5d6b4488754d')],
      phone: '+256709402189',
      inboundMessageId: 'false_58248765960252@lid_A5BE296558D6ED:ordered-replay:7f1c'
    });

    assert.strictEqual(attachment.attached, 1,
      'only the Akright photo may be attached; three belonged to Bwerenga');
    assert.deepStrictEqual(inserted, ['https://cdn.makaug.com/5d6b4488754d.jpg']);
    for (const sha of BWERENGA_HASHES) {
      assert.ok(!inserted.some((url) => url.includes(sha)),
        `${sha.toUpperCase()} is Bwerenga's photo and must not appear on the Akright house`);
    }
  });
});

test('an ordered replay of a message is the same message, not a new one', () => {
  const live = 'false_58248765960252@lid_A5BE296558D6ED';
  for (const suffix of ['ordered-replay', 'ordered-caption', 'ordered-complete']) {
    assert.strictEqual(
      normalizeEmployeeSourceMessageId(`${live}:${suffix}:7f1c`),
      live,
      `a ${suffix} pass must resolve to the message it is replaying`
    );
  }
  assert.strictEqual(normalizeEmployeeSourceMessageId(live), live, 'a live message is left alone');
});

test('nothing is looked up when there is no media to claim', async () => {
  const originalQuery = db.query;
  let queried = false;
  db.query = async () => { queried = true; return { rows: [] }; };
  try {
    const claimed = await employeeMediaClaimedElsewhere({ propertyId: AKRIGHT, storedMedia: [] });
    assert.strictEqual(claimed.size, 0);
    assert.strictEqual(queried, false, 'an empty batch must not hit the database');
  } finally {
    db.query = originalQuery;
  }
});

// ---------------------------------------------------------------------------
// The advert that was never created at all
// ---------------------------------------------------------------------------

/**
 * The seventh advert, 11:13:39:
 *
 *   "50 by 100 at 35m located at nsagu along natete nakawuka road"
 *
 * A plot, a price and a road. Intake asked Ronald for the "sale/rent/land/
 * commercial/student type" and created nothing, so the video that carried this
 * caption and the ten photos he sent at 11:38 were attached to the property
 * created before it instead.
 */
test('a plot measured in feet or decimals, with a price, is a land listing', () => {
  const nsagu = route.employeePropertyFacts('50 by 100 at 35m located at nsagu along natete nakawuka road', {});
  assert.strictEqual(nsagu.listingType, 'land');
  assert.strictEqual(Number(nsagu.price), 35000000);
  assert.deepStrictEqual(route.employeePropertyMissing(nsagu), [],
    'nothing is outstanding, so the advert must be created rather than queried');
});

test('the inference does not reach past plots', () => {
  const unchanged = [
    ['5 bedrooms self contained house on sale located at bwebajja akright city at a price of 450m', 'sale'],
    ['3 bedroom house for rent in Kira, Wakiso at 1.2m per month', 'rent'],
    ['Shop for rent in Ntinda 50 by 100 at 2m per month', 'commercial'],
    ['8 spacious bedroom, 8 sparkling bathroom house in Munyonyo at 1.2bn on 30 by 60', 'sale']
  ];
  for (const [caption, expected] of unchanged) {
    assert.strictEqual(route.employeePropertyFacts(caption, {}).listingType, expected,
      `"${caption.slice(0, 40)}…" is not land`);
  }
  // Dimensions with no price are still a question, not a listing.
  assert.strictEqual(route.employeePropertyFacts('50 by 100 at nsagu', {}).listingType, '');
});
