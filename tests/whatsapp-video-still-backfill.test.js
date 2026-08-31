'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  BACKFILL_MARKER,
  SELECTION_SQL,
  extractVideoUrls,
  parseArgs
} = require('../scripts/backfill-whatsapp-video-stills');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts/whatsapp-web-copilot.js'), 'utf8');
const backfillSource = fs.readFileSync(path.join(root, 'scripts/backfill-whatsapp-video-stills.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.deepEqual(parseArgs([]), { apply: false, propertyIds: [] }, 'backfill must default to dry-run');
assert.deepEqual(parseArgs(['--apply', '--property-id=abc']), { apply: true, propertyIds: ['abc'] });
assert.deepEqual(
  extractVideoUrls({ video_urls: ['https://media.makaug.com/a.mp4', 'https://media.makaug.com/a.mp4', 'http://unsafe.test/a.mp4'] }),
  ['https://media.makaug.com/a.mp4'],
  'video repair should accept unique HTTPS media only'
);
assert.equal(BACKFILL_MARKER, 'whatsapp-video-still-backfill-20260831');
assert(SELECTION_SQL.includes("p.source = 'whatsapp_employee_intake'"), 'repair must stay scoped to employee intake');
assert(SELECTION_SQL.includes("p.status = 'pending'"), 'repair must leave approved and rejected listings untouched');
assert(SELECTION_SQL.includes('NOT EXISTS'), 'repair must skip listings that already have a review image');
assert(workerSource.includes('async function captureVideoPosterFrame'), 'new WhatsApp videos must get an extracted still');
assert(workerSource.includes('mediaPreviews.push({'), 'worker must submit the video and derived still together');
assert(workerSource.includes("mediaPreviewWarning: 'video_still_unavailable'"), 'missing stills must remain visible as a warning');
assert(backfillSource.includes("'whatsapp_video_still_backfilled'"), 'repairs must leave an audit event');
assert(backfillSource.includes("'pending', 'pending'"), 'backfill must preserve staff-review status');
assert(backfillSource.includes('auto_publish: false'), 'backfill must not publish repaired listings');
assert(backfillSource.includes("slot_key, room_label"), 'derived stills must be attached to the existing property image gallery');
assert(serverSource.includes('whatsapp-video-still-dual-media-20260831'), 'release marker must be externally visible');
assert(serverSource.includes('whatsapp-video-still-backfill-20260831'), 'repair marker must be externally visible');

console.log('whatsapp video still backfill tests passed');
