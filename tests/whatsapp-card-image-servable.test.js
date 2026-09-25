'use strict';

/**
 * On 25 Sep 2026 Ronald asked for "a standard single house in lweza" and got
 * nothing back at all. The backend had built the answer — the log says the
 * reply was ready in 5.5 seconds — but the send failed:
 *
 *   send FAILED ... WAHA POST /api/sendImage -> 500: "Request failed with
 *   status code 403"
 *
 * The card's photo was https://p19-common-sign.tiktokcdn-us.com/tos-alisg-...,
 * a signed CDN thumbnail on a listing we had found online. WhatsApp is not
 * handed a link — the transport downloads the file and uploads the bytes — and
 * that download is refused. The photo and the words travel as one message, so
 * the refusal took the words with it.
 *
 * Two independent guards now stop that, either of which alone would have saved
 * the answer. This file covers the first: a picture is only offered for a card
 * if we host it ourselves. The second lives in the bridge, which sends the
 * words as text when a picture cannot be sent.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  publicMediaUrl,
  servablePropertyImageUrl,
  whatsappPropertyImageUrl
} = require('../services/whatsappPropertyCardService');

test('our own media is served', () => {
  for (const url of [
    'https://media.makaug.com/properties/12/hero.jpg',
    'https://makaug.com/uploads/a.jpg',
    'https://www.makaug.com/uploads/a.jpg'
  ]) {
    assert.strictEqual(servablePropertyImageUrl(url), url, `${url} is ours`);
  }
});

test('a thumbnail hotlinked from somewhere else is not', () => {
  const foreign = [
    // The exact shape of the URL that lost Ronald's answer.
    'https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/oUNIkE~tplv-noop.jpeg?x-expires=1',
    'https://scontent.cdninstagram.com/v/t51/123.jpg',
    'https://scontent-lhr8-1.xx.fbcdn.net/v/t39/456.jpg',
    'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    'https://makaug.com.evil.example/uploads/a.jpg'
  ];
  for (const url of foreign) {
    assert.strictEqual(servablePropertyImageUrl(url), '', `${url} must not be offered`);
    assert.ok(publicMediaUrl(url), 'it is still a perfectly valid URL — it just is not ours to send');
  }
});

test('a listing whose only picture is a foreign thumbnail sends no picture', () => {
  // This is the Lweza row: found online, no uploaded photo of its own, three
  // fields all holding the same signed TikTok URL.
  const tiktok = 'https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/oUNIkE~tplv.jpeg?x-expires=1';
  const row = {
    id: 4242,
    title: 'Standard single house in Lweza',
    primary_image_url: '',
    extra_fields: {
      source_thumbnail_url: tiktok,
      thumbnail_url: tiktok,
      video_thumbnail_url: tiktok,
      raw_source_post: { thumbnail_url: tiktok }
    }
  };
  assert.strictEqual(whatsappPropertyImageUrl(row), '',
    'no picture at all beats a picture that cannot be sent, because the words ride with it');
});

test('a listing with an uploaded photo still sends it', () => {
  const ours = 'https://media.makaug.com/properties/4242/1.jpg';
  assert.strictEqual(whatsappPropertyImageUrl({ id: 4242, primary_image_url: ours }), ours);
  assert.strictEqual(
    whatsappPropertyImageUrl({
      id: 4242,
      primary_image_url: '',
      // tiktok_thumbnail_url is tried before thumbnail_url, so the foreign one
      // is reached first and has to be stepped over rather than accepted.
      extra_fields: {
        tiktok_thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
        thumbnail_url: ours
      }
    }),
    ours,
    'a foreign candidate is skipped rather than ending the search'
  );
});

test('nothing at all is handled without throwing', () => {
  for (const value of ['', null, undefined, {}, 'not a url', 'data:image/png;base64,AAA', '/uploads/a.jpg']) {
    assert.strictEqual(servablePropertyImageUrl(value), '');
  }
  assert.strictEqual(whatsappPropertyImageUrl({}), '');
  assert.strictEqual(whatsappPropertyImageUrl(), '');
});
