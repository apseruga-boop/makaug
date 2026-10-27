'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

test('photo preparation decodes from file bytes before blob URLs and never trusts the declared type alone', () => {
  assert(app.includes('async function decodeLpImageFile('));
  assert(app.includes('async function sniffLpImageKind('));
  const compress = app.slice(app.indexOf('async function compressPhotoForSubmission('), app.indexOf('async function prepareListingPhotoUploadUrls('));
  assert(compress.includes('decodeLpImageFile(file)'));
  assert(!compress.includes('loadImageElement(objectUrl)'), 'no blob-url-only decode');
  assert(compress.includes('lpFileLooksLikeImage(file)'), 'empty MIME with image extension is accepted');
  assert(compress.includes('readBlobAsDataUrl(file)'), 'raw bytes are the last resort');
});

test('one unreadable photo no longer blocks the listing when enough photos remain', () => {
  const prep = app.slice(app.indexOf('async function prepareListingPhotoUploadUrls('), app.indexOf('async function evaluateLpPhotoQuality('));
  assert(prep.includes('skipped.push'));
  assert(prep.includes('urls.length >= minPhotos'));
  assert(!prep.includes('could not be prepared. If this is an iPhone HEIC photo'), 'old blanket HEIC message gone');
  assert(prep.includes('LP_HEIC'), 'HEIC is named only when the bytes say so');
});
