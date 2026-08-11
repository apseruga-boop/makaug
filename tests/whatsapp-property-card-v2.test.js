'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildWhatsappPropertyCard,
  cleanWhatsappPropertyTitle,
  formatWhatsappPropertyPrice,
  propertyIdFromWhatsappReply,
  whatsappPropertyImageUrl
} = require('../services/whatsappPropertyCardService');

const propertyId = 'cd9b6d2d-2a2a-49bc-b5b9-035893bc155a';
const rawSourceTitle = '🏡 House for sale Seguku Katare with land title asking price 210m for more information call 📞 0774129320/0752129320 #ugandatiktokers🇺🇬 #rentalsforsale #fyp';
const tiktokThumbnail = 'https://media.makaug.com/source-previews/tiktok/seguku.jpeg';
const sale = {
  id: propertyId,
  title: rawSourceTitle,
  listing_type: 'sale',
  transaction_type: 'sale',
  area: 'Seguku',
  district: 'Wakiso',
  price: 210_000_000,
  price_period: 'once',
  primary_image_url: null,
  extra_fields: {
    oembed_thumbnail_url: tiktokThumbnail,
    source_caption: rawSourceTitle
  }
};

const card = buildWhatsappPropertyCard(sale);
assert.strictEqual(card.caption, [
  '🏡 Property for sale in Seguku',
  '📍 Seguku, Wakiso',
  '🏷️ For Sale',
  '💰 USh 210M',
  `🔗 View photos, map & enquire: https://makaug.com/property/${propertyId}`,
  '🔎 View all properties: https://makaug.com'
].join('\n'));
assert.strictEqual(card.caption.split('\n').length, 6, 'property caption must stay at six lines');
assert.strictEqual(card.imageUrl, tiktokThumbnail, 'TikTok oEmbed thumbnail should backstop a missing stored image');
assert(!/Sourced online|posted online|first picked up|added to makaug|audience|contact:/i.test(card.caption));
assert(!/#|0774129320|0752129320|fyp|\/once/i.test(card.caption));
assert.strictEqual(cleanWhatsappPropertyTitle(sale), 'Property for sale in Seguku');
assert.strictEqual(formatWhatsappPropertyPrice(sale), 'USh 210M');

assert.strictEqual(formatWhatsappPropertyPrice({
  listing_type: 'rent',
  price: 2_500_000,
  price_period: 'once'
}), 'USh 2.5M/month');
assert.strictEqual(formatWhatsappPropertyPrice({
  listing_type: 'student',
  price: 850_000,
  price_period: 'month'
}), 'USh 850K/semester');
assert.strictEqual(formatWhatsappPropertyPrice({
  listing_type: 'commercial',
  transaction_type: 'rent',
  price: 5_000_000,
  price_period: 'year'
}), 'USh 5M/year');
assert.strictEqual(formatWhatsappPropertyPrice({
  listing_type: 'land',
  transaction_type: 'sale',
  price: 80_000_000,
  price_period: 'month'
}), 'USh 80M');

assert.strictEqual(whatsappPropertyImageUrl({
  primary_image_url: 'https://media.makaug.com/primary.jpg',
  images: ['https://media.makaug.com/second.jpg'],
  extra_fields: { oembed_thumbnail_url: tiktokThumbnail }
}), 'https://media.makaug.com/primary.jpg');
assert.strictEqual(whatsappPropertyImageUrl({
  images: [{ url: 'https://media.makaug.com/first-array.jpg' }],
  extra_fields: { oembed_thumbnail_url: tiktokThumbnail }
}), 'https://media.makaug.com/first-array.jpg');
assert.strictEqual(whatsappPropertyImageUrl({ extra_fields: {} }), '', 'missing media must produce a text-only card');

assert.strictEqual(
  propertyIdFromWhatsappReply(card.caption),
  propertyId,
  'queued replies should recover the approved property ID for server-side image resolution'
);

const repoRoot = path.join(__dirname, '..');
const whatsappRoute = fs.readFileSync(path.join(repoRoot, 'routes', 'whatsapp.js'), 'utf8');
const bridgeService = fs.readFileSync(path.join(repoRoot, 'services', 'whatsappWebBridgeService.js'), 'utf8');
const bridgeWorker = fs.readFileSync(path.join(repoRoot, 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(repoRoot, 'routes', 'admin.js'), 'utf8');
const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

const formatterStart = whatsappRoute.indexOf('function formatPropertySearchMessage(lang');
const formatterEnd = whatsappRoute.indexOf('function formatPropertySearchMessageLegacy', formatterStart);
const activeFormatter = whatsappRoute.slice(formatterStart, formatterEnd);
assert(activeFormatter.includes('buildWhatsappPropertyCard(row'), 'active search formatter must use the short card service');
assert(!activeFormatter.includes('formatFoundOnlineSourceLine'), 'active search formatter must not append provenance');
assert(whatsappRoute.includes('mediaUrl = card.imageUrl'), 'auto replies must resolve the card image before queueing');
assert(bridgeService.includes('media_url: normalizedMediaUrl'), 'bridge queue must carry the image URL');
assert(whatsappRoute.includes("media_type: row.payload?.media_type || 'text'"), 'outbox API must expose media metadata');
assert(bridgeWorker.includes('typeAndSendImageReply'), 'hosted bridge must send an actual WhatsApp image message');
assert(bridgeWorker.includes('sending the clean text card instead'), 'image failure must fall back to text-only');
assert(bridgeWorker.includes('dismissPendingMediaSelection'), 'image failure must close WhatsApp media selection before text fallback');
assert(bridgeWorker.includes('waitForMediaSendConfirmation'), 'media delivery must confirm the closed image composer without retrying a sent card');
assert(bridgeWorker.indexOf('clickFirstVisible(page, ATTACH_BUTTON_SELECTORS)') < bridgeWorker.indexOf('findAttachedFileInput(page);'), 'worker must open the live attachment menu before selecting its image input');
assert(adminRoute.includes('req.body.property_id || req.body.propertyId'), 'admin confirmation send must support a reviewed property card');
assert(server.includes("'whatsapp-property-card-v2'"), 'production version marker must identify this release');

console.log('WhatsApp property card v2 checks passed');
