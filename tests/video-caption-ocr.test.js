'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  OCR_PENDING,
  MIN_OVERRIDE_REASON,
  parseListingFacts,
  conflictFacts,
  dedupeConflicts,
  factsFromListing,
  decideVideoCaptionApproval,
  sampleTimestamps,
  dedupeFrameHashes,
  combineOcrText
} = require('../services/videoCaptionOcrService');
const backfill = require('../scripts/backfill-video-caption-ocr');

const root = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/video-caption-ocr-buwaate-katabi.json'), 'utf8'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const captionFacts = parseListingFacts(fixture.caption);
const videoFacts = parseListingFacts(fixture.video_text);
const listingFacts = factsFromListing(fixture.listing);
const conflicts = dedupeConflicts([
  ...conflictFacts(videoFacts, captionFacts, 'caption'),
  ...conflictFacts(videoFacts, listingFacts, 'listing')
]);
const dimensions = new Set(conflicts.map((item) => item.dimension));

assert.strictEqual(captionFacts.type, 'house', 'caption is a house');
assert.strictEqual(captionFacts.beds, 4, 'caption is 4-bed');
assert.strictEqual(captionFacts.price, 440000000, 'caption price is UGX 440M');
assert.strictEqual(captionFacts.location && captionFacts.location.name, 'Buwaate', 'caption location is Buwaate');
assert.strictEqual(videoFacts.type, 'land', 'video is land');
assert.strictEqual(videoFacts.acres, 1.4, 'video is 1.4 acres');
assert.strictEqual(videoFacts.price, 820000000, 'video price is UGX 820 million');
assert.strictEqual(videoFacts.location && videoFacts.location.name, 'Katabi', 'video location is Katabi');
for (const dimension of ['location', 'price', 'size', 'type']) {
  assert(dimensions.has(dimension), `Buwaate/Katabi fixture conflicts on ${dimension}`);
}

const phoneFacts = parseListingFacts(`${fixture.caption} ${fixture.phone}`);
assert.strictEqual(phoneFacts.price, 440000000, 'a phone number is not a price');
assert.strictEqual(parseListingFacts('1.4 acres').price, null, 'an acre figure is not money');
assert.strictEqual(parseListingFacts(fixture.phone).price, null, 'the Francis number alone is not a price');

const pendingRecord = {
  status: 'done',
  parsed_facts: videoFacts,
  conflicts,
  text: fixture.video_text
};
const blocked = decideVideoCaptionApproval({
  record: pendingRecord,
  property: fixture.listing,
  overrideRequested: true,
  overrideReason: 'short'
});
assert.strictEqual(blocked.blocked, true, 'a short override reason still blocks approval');
assert(blocked.conflicts.length >= 4, 'the pending listing still conflicts with the video');

const overridden = decideVideoCaptionApproval({
  record: pendingRecord,
  property: fixture.listing,
  overrideRequested: true,
  overrideReason: 'Video is the Katabi land; caption was another house.'
});
assert.strictEqual(overridden.blocked, false, 'a written override allows approval');
assert.strictEqual(overridden.persist.kind, 'override');
assert(overridden.override.reason.length >= MIN_OVERRIDE_REASON);

const matchedListing = {
  ...fixture.listing,
  listing_type: 'land',
  property_type: 'Land',
  area: 'Katabi',
  district: 'Wakiso',
  price: 820000000,
  bedrooms: 4,
  description: '1.4 acres Katabi Entebbe road lake view UGX 820 million'
};
const matched = decideVideoCaptionApproval({ record: pendingRecord, property: matchedListing });
assert.strictEqual(matched.blocked, false, 'editing the listing to the video facts clears the block');
assert.strictEqual(matched.cleared_by_edit, true, 'the caption disagreement stays recorded');
assert.strictEqual(matched.persist.kind, 'listing_edit');

assert.strictEqual(decideVideoCaptionApproval({
  record: { status: OCR_PENDING, parsed_facts: {}, conflicts: [] },
  property: fixture.listing
}).blocked, false, 'ocr pending does not block approval');
assert.strictEqual(decideVideoCaptionApproval({
  record: { status: 'pending', parsed_facts: videoFacts, conflicts },
  property: fixture.listing
}).blocked, false, 'a reading that is not done does not block approval');
assert.strictEqual(decideVideoCaptionApproval({
  record: { status: 'done', parsed_facts: {}, text: '' },
  property: fixture.listing
}).blocked, false, 'an empty reading does not block approval');

const times = sampleTimestamps(40);
assert(times.length <= 20, 'frame sampling stays within 20 frames');
assert(times.length >= 18, 'a long video still samples about one frame every two seconds');
assert(times[0] <= 0.4, 'sampling starts near the opening frame');
assert.deepStrictEqual(sampleTimestamps(0), [0]);
const frames = dedupeFrameHashes([
  { hash: '0000000000000000', text: 'a' },
  { hash: '0000000000000000', text: 'a again' },
  { hash: '1111111111111111', text: 'b' }
]);
assert.strictEqual(frames.length, 2, 'near-duplicate frames are dropped');
assert.strictEqual(combineOcrText(['Katabi', 'Katabi', '1.4 acres']), 'Katabi\n1.4 acres');

const args = backfill.parseArgs([]);
assert.strictEqual(args.publishReviewList, false, 'backfill is dry-run unless asked to publish a review list');
const report = backfill.reportFromRows([
  { mismatch: true, ocr_status: 'done', property_id: '1' },
  { mismatch: false, ocr_status: 'ocr pending', property_id: '2' }
]);
assert.strictEqual(report.dry_run, true);
assert.strictEqual(report.changes_listings, false);
assert.strictEqual(report.mismatches, 1);
assert.strictEqual(report.unread, 1);
assert.strictEqual(report.items.length, 1, 'only mismatches go in the review report');
const csv = backfill.reportToCsv({ items: [{ property_id: '1', caption_text: 'say "hi"', conflicts: [{ dimension: 'location' }] }] });
assert(csv.startsWith('property_id,inquiry_reference,listing_status,lister_phone,title,video_url,caption_text,ocr_text,conflicts\n'));
assert(csv.includes('"say ""hi"""'), 'csv quotes embedded quotes');
assert(!/UPDATE\s+properties/i.test(read('scripts/backfill-video-caption-ocr.js')), 'backfill must not update listings');
assert(backfill.SELECTION_SQL.includes("'pending'") && backfill.SELECTION_SQL.includes("'approved'"));

const whatsapp = read('routes/whatsapp.js');
assert(!/await\s+scheduleVideoCaptionOcr/.test(whatsapp), 'OCR is not awaited on the import path');
assert((whatsapp.match(/scheduleVideoCaptionOcr\(/g) || []).length >= 3, 'OCR is scheduled after media is stored');
const properties = read('routes/properties.js');
assert(properties.includes("code: 'video_caption_conflict'"));
assert(properties.includes('human_approval_override_available: false'));
assert(properties.includes('video_caption_ocr_override'));
const app = read('assets/makaug-app.js');
for (const text of [
  'Extracted from video',
  'Caption facts',
  'Video facts',
  'OCR pending',
  'Why approval is blocked',
  'I checked the video text. Approve with this reason.',
  'data-video-caption-approve',
  'adminLoadVideoCaptionConflicts'
]) {
  assert(app.includes(text), `moderator editor is missing ${text}`);
}
const html = read('index.html');
assert(html.includes('id="staff-video-caption-conflicts"'));
assert(html.includes('id="admin-video-caption-conflicts"'));
assert(read('db/migrations/161_property_video_caption_ocr.sql').includes('CREATE TABLE IF NOT EXISTS property_video_ocr'));
const langs = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
for (const lang of langs) {
  const pack = JSON.parse(read(`assets/i18n/site-${lang}.json`));
  for (const key of ['Extracted from video', 'Video facts', 'OCR pending', 'Video caption conflicts', 'Open review']) {
    assert(pack.phrases[key] && pack.phrases[key] !== key, `${lang} translates ${key}`);
  }
}

console.log('video caption OCR tests passed');
