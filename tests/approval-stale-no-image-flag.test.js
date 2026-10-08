'use strict';

/**
 * A listing with photos on the screen that cannot be approved.
 *
 * 8 Oct 2026. Migadde Hakim's Kasanje-Nakawuka plot had four clear photos of
 * the plot attached and visible in the review panel, and approval was refused:
 * "A clear property image is required before approval."
 *
 * blocked_no_usable_property_image is a COUNT, not a verdict. WhatsApp intake
 * writes it when a property arrives with zero usable photos, and nothing ever
 * rewrote it — so a listing that got its photos afterwards, whether an admin
 * attached them or the agent sent them a minute later, stayed blocked for ever.
 * The only way through was "Approve anyway (human verified)", and a gate that
 * is wrong this often teaches moderators to click the override, which is worse
 * than having no gate at all.
 *
 * Every other blocked_ status says something about the media we DO hold and
 * must keep blocking. Only the count one is answered by counting.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../routes/properties'), 'utf8');

test('the no-image block is answered by the images that are actually attached', () => {
  assert.match(source, /staleNoImageBlock/,
    'the gate has to notice that the count it is asserting is now wrong');
  assert.match(
    source,
    /mediaValidationStatus === 'blocked_no_usable_property_image'\s*\n?\s*&& usableImageCount >= 1/,
    'stale only when the property really does have a usable image now'
  );
});

test('every other blocked status still stops an approval', () => {
  // The exemption is scoped to one exact string. A social-source block or a
  // video-recovery block is a judgement, not a count, and must survive.
  assert.match(source, /blockingValidationStatus = mediaValidationStatus\.startsWith\('blocked_'\) && !staleNoImageBlock/,
    'all other blocked_ statuses keep their force');
  assert.match(source, /if \(blockingValidationStatus \|\| videoRecoveryRequired \|\| usableImageCount < 1\)/,
    'zero images still blocks, and so does a video that needs recovering');
});

test('attaching photos clears the stale flag at the source', () => {
  const admin = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
  assert.match(admin, /passed_automated_image_gate/,
    'adding images must rewrite the verdict, not just work around it later');
  assert.match(
    admin,
    /AND extra_fields->>'media_validation_status' = 'blocked_no_usable_property_image'/,
    'and must only ever rewrite that one status, never a real judgement'
  );
});
