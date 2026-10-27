'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { publicOcrView } = require('../services/videoCaptionOcrService');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const start = source.indexOf('function adminVideoCaptionOcrRecord(');
const end = source.indexOf('let videoCaptionOcrGateBound =', start);
assert.ok(start >= 0 && end > start, 'the OCR record and panel functions exist');
const context = {
  adminReviewExtraFields: (review) => review.extra_fields || {},
  adminEscape: String,
  adminAttr: String,
  propertyIdArg: JSON.stringify
};
vm.runInNewContext(`${source.slice(start, end)}; this.render = adminVideoCaptionOcrPanelHtml;`, context);

function render(record) {
  return context.render({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    extra_fields: { video_caption_ocr: record, video_url: 'https://www.youtube.com/watch?v=example' }
  });
}

test('a page-link result gives final facts guidance without progress text or a retry button', () => {
  const html = render(publicOcrView({ status: 'not_checkable', error: 'external_video_page' }));
  assert.match(html, /data-ocr-status="not_checkable"/);
  assert.match(html, /Can't read text from a YouTube or TikTok link\. Watch the video to check it\./);
  const factsHtml = html.slice(html.indexOf('>Video facts</div>'));
  assert.match(factsHtml, /No text was read from the video\./);
  assert.doesNotMatch(html, /still being read/i);
  assert.doesNotMatch(html, /Run check now|data-staff-ocr-run/);
});

test('a pending check still tells staff that the video text is being read', () => {
  const html = render(publicOcrView({ status: 'pending' }));
  assert.match(html, /data-ocr-status="pending"/);
  assert.match(html, /Video text is still being read\./);
  assert.doesNotMatch(html, /No text was read from the video\./);
  assert.doesNotMatch(html, /Run check now|data-staff-ocr-run/);
});
