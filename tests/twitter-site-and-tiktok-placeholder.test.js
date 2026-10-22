'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { renderProtectedLoginShell } = require('../services/publicHtmlSanitizer');

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  assert.ok(from >= 0 && to > from, `missing ${start}`);
  return source.slice(from, to);
}

function loadSeoPatcher() {
  const server = read('server.js');
  const source = [
    sliceBetween(server, 'function escapeMetaContent', 'function absolutePublicUrl'),
    sliceBetween(server, 'function patchMetaTag', 'function patchListingOpenGraphMeta')
  ].join('\n');
  return new Function(`${source}\nreturn patchPublicPageSeoMeta;`)();
}

function twitterSiteTags(html) {
  return html.match(/<meta\b[^>]*name=["']twitter:site["'][^>]*>/gi) || [];
}

test('server-rendered heads carry one twitter:site tag', () => {
  const indexHead = read('index.html').split('</head>')[0];
  const indexTags = twitterSiteTags(indexHead);
  assert.equal(indexTags.length, 1);
  assert.match(indexTags[0], /content="@makauganda"/);

  const patchPublicPageSeoMeta = loadSeoPatcher();
  const listing = patchPublicPageSeoMeta(read('index.html'), {
    title: 'Property for Sale in Wakiso — UGX 330M | makaug.com',
    description: 'A listing page.',
    canonical: 'https://makaug.com/property/example',
    image: 'https://makaug.com/assets/og-cover.jpg'
  });
  assert.equal(twitterSiteTags(listing.split('</head>')[0]).length, 1);

  const bare = patchPublicPageSeoMeta('<head><title>old</title></head>', {
    title: 'Page',
    description: 'Text',
    canonical: 'https://makaug.com/for-sale',
    image: 'https://makaug.com/assets/og-cover.jpg'
  });
  assert.deepEqual(twitterSiteTags(bare), ['<meta name="twitter:site" content="@makauganda">']);

  const notFound = sliceBetween(read('server.js'), 'function renderPublicNotFoundPage', 'function sendPublicNotFound');
  assert.equal(twitterSiteTags(notFound).length, 1);
  const login = renderProtectedLoginShell('/admin');
  assert.equal(twitterSiteTags(login).length, 1);
  const welcome = read('assets/marketing/makaug-agent-welcome.html').split('</head>')[0];
  assert.equal(twitterSiteTags(welcome).length, 1);
});

test('the public shell example TikTok video is the brand profile, not @agent', () => {
  const index = read('index.html');
  assert.equal(index.includes('tiktok.com/@agent/video'), false);
  assert.match(
    index,
    /id="harvest-submission-url"[^>]*placeholder="https:\/\/www\.tiktok\.com\/@makaug\.com"/
  );
  const sameAs = sliceBetween(read('packages/shared-country-core/config/tenants.js'), 'sameAs:', 'contactPoint:');
  assert.match(sameAs, /https:\/\/www\.tiktok\.com\/@makaug\.com/);
  assert.equal(sameAs.includes('@agent/video'), false);
});
