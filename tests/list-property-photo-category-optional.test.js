'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

test('photo category is optional on the list-property form', () => {
  const v = app.slice(app.indexOf('function validateListStep2()'), app.indexOf('function getYouTubeEmbedUrl('));
  assert(!/Assign each photo to a category/.test(v), 'no category gate');
  assert(!/markLpPhotoSelectError/.test(v));
  assert(app.includes('Photo category (optional)'));
});

test('gallery thumbnails are drawn from the file bytes, not only blob: URLs', () => {
  assert(app.includes('function hydrateLpGalleryThumbnails('));
  assert(app.includes('async function makeLpThumbnailDataUrl('));
  const render = app.slice(app.indexOf('function renderLpPhotoFeedback()'), app.indexOf('const lpThumbnailCache'));
  assert(render.includes('data-lp-thumb-index'));
  assert(render.includes('hydrateLpGalleryThumbnails(galleryEl)'));
});
