'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  BACKFILL_MARKER,
  MIN_VIDEO_KEY_FRAMES,
  SELECTION_SQL,
  extractVideoUrls,
  fallbackFrameOffsets,
  keyFramesNeeded,
  representativeFrameOffsets,
  parseArgs
} = require('../scripts/backfill-whatsapp-video-stills');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts/whatsapp-web-copilot.js'), 'utf8');
const backfillSource = fs.readFileSync(path.join(root, 'scripts/backfill-whatsapp-video-stills.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'routes/whatsapp.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const propertiesSource = fs.readFileSync(path.join(root, 'routes/properties.js'), 'utf8');

assert.deepEqual(parseArgs([]), { apply: false, propertyIds: [] }, 'backfill must default to dry-run');
assert.deepEqual(parseArgs(['--apply', '--property-id=abc']), { apply: true, propertyIds: ['abc'] });
assert.deepEqual(
  extractVideoUrls({ video_urls: ['https://media.makaug.com/a.mp4', 'https://media.makaug.com/a.mp4', 'http://unsafe.test/a.mp4'] }),
  ['https://media.makaug.com/a.mp4'],
  'video repair should accept unique HTTPS media only'
);
assert.equal(BACKFILL_MARKER, 'whatsapp-video-five-key-frames-20260831');
assert.equal(MIN_VIDEO_KEY_FRAMES, 5);
assert.equal(keyFramesNeeded({ video_still_count: 1 }), 4);
assert.equal(keyFramesNeeded({ video_still_count: 5 }), 0);
const offsets = representativeFrameOffsets(12, 5);
assert.equal(offsets.length, 5, 'five timestamps must be spread across each video');
assert(offsets.every((value, index) => value > 0 && value < 12 && (!index || value > offsets[index - 1])));
assert.deepEqual(
  fallbackFrameOffsets(8),
  [8, 6, 4, 2, 0.1, 0],
  'frame extraction must progressively seek earlier when container duration metadata is inaccurate'
);
assert(SELECTION_SQL.includes("p.source = 'whatsapp_employee_intake'"), 'repair must stay scoped to employee intake');
assert(SELECTION_SQL.includes("p.status = 'pending'"), 'repair must leave approved and rejected listings untouched');
assert(SELECTION_SQL.includes('video_still_count') && SELECTION_SQL.includes('COUNT(pi.id) FILTER'), 'repair must count existing video-derived images');
assert(SELECTION_SQL.includes('forwarded'), 'repair must also clean raw WhatsApp descriptions');
assert(workerSource.includes('async function captureVideoKeyFrames'), 'new WhatsApp videos must get five distributed key frames');
assert(workerSource.includes("WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER = 'whatsapp-video-five-key-frames-20260831'"), 'hosted worker heartbeat must identify the five-frame release');
assert(workerSource.includes('async function captureVideoPosterFrame'), 'new WhatsApp videos must get an extracted still');
assert(workerSource.includes('isPlayableVideoBuffer'), 'worker must reject encrypted WhatsApp network payloads masquerading as MP4 files');
assert(workerSource.includes("effectiveMime !== 'application/octet-stream'"), 'decrypted WhatsApp browser blobs must carry their playable video MIME in the data URL');
assert(workerSource.includes('mediaPreviews.push({'), 'worker must submit the video and derived still together');
assert(workerSource.includes('captureVideoKeyFrames(page, messageId, 5)'), 'worker must request five key frames from a playable video');
assert(workerSource.includes("mediaPreviewWarning: 'video_key_frames_incomplete'"), 'incomplete key-frame extraction must remain visible to the intake runtime');
assert(workerSource.includes('runPendingEmployeeVideoRecovery'), 'hosted worker must recover marked historic originals from WhatsApp history');
assert(workerSource.includes('employeeVideoRecoveryCaptionKey'), 'historic lookup must ignore WhatsApp Forwarded and duration labels');
assert(workerSource.includes("mediaType: 'media',\n      mediaPreviews: []"), 'marked historic video cards must be reopened even if WhatsApp labels the old thumbnail as an image');
assert(backfillSource.includes("'whatsapp_video_still_backfilled'"), 'repairs must leave an audit event');
assert(backfillSource.includes('extractStillWithFallback(videoPath, stillPath'), 'backfill must recover when the requested frame timestamp is beyond decodable footage');
assert(backfillSource.includes("'pending', 'pending'"), 'backfill must preserve staff-review status');
assert(backfillSource.includes('auto_publish: false'), 'backfill must not publish repaired listings');
assert(backfillSource.includes("slot_key, room_label"), 'derived stills must be attached to the existing property image gallery');
assert(backfillSource.includes('Video key image ${keyFrameNumber} of ${MIN_VIDEO_KEY_FRAMES}'), 'review frames must be clearly labelled');
assert(frontendSource.includes('function staffPreviewVideosHtml'), 'staff preview must render stored videos, not just poster images');
assert(frontendSource.includes('data-staff-review-video-gallery="true"'), 'staff video gallery needs a stable visible proof hook');
assert(frontendSource.includes('Photos, video and source evidence'), 'moderation copy must tell staff that both media types are present');
assert(frontendSource.includes('const detailVideoUrls = propertyVideoUrls(p)'), 'public property detail must carry approved videos into the gallery');
assert(frontendSource.includes('<video controls preload="metadata" playsinline'), 'direct Cloudflare MP4s must be playable online');
assert(propertiesSource.includes('video_urls: safeVideoUrls'), 'public property API must expose approved video URLs');
assert(routeSource.includes('employeeVideoBytesPlayable'), 'the API must reject encrypted or corrupt video uploads before Cloudflare storage');
assert(routeSource.includes("router.get('/web-bridge/employee-video-recovery-targets'"), 'worker must have an authenticated repair queue');
assert(routeSource.includes('FROM whatsapp_sessions ws'), 'repair queue must resolve the authorized originating employee chat without a new worker secret');
assert(routeSource.includes("router.post('/web-bridge/employee-video-recovery/:id'"), 'worker must have an authenticated original-media recovery route');
assert(routeSource.includes("'pending', 'pending'"), 'original-video recovery must preserve staff-review status');
assert(serverSource.includes('whatsapp-video-still-dual-media-20260831'), 'release marker must be externally visible');
assert(serverSource.includes('whatsapp-video-still-backfill-20260831'), 'repair marker must be externally visible');
assert(serverSource.includes('whatsapp-video-original-recovery-20260831'), 'historic original recovery marker must be externally visible');
assert(serverSource.includes('whatsapp-video-five-key-frames-20260831'), 'five-frame gallery marker must be externally visible');

console.log('whatsapp video still backfill tests passed');
