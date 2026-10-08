'use strict';

// A listing can be approved only with at least one real photo stored on our own
// media host (S3_PUBLIC_BASE_URL, i.e. media.makaug.com). These don't count:
// generated data: images (the "image pending" evidence card, land diagrams),
// the Unsplash stock house, and TikTok CDN links (they expire and aren't ours).
// About 570 live listings showed no real photo when this was added (8 Oct 2026).

const DEFAULT_MEDIA_HOST = 'media.makaug.com';
const STOCK_PHOTO_ID = 'photo-1560518883-ce09059eeffa';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_REAL_PHOTO_CODE = 'no_real_hosted_photo';
const NO_REAL_PHOTO_MESSAGE = 'This listing needs at least 1 real photo uploaded to MakaUg before it can be approved. Stock photos, "image pending" cards, generated images and TikTok links don\'t count. This can\'t be overridden.';

function mediaHost() {
  const base = String(process.env.S3_PUBLIC_BASE_URL || '').trim();
  if (base) {
    try {
      return new URL(base).hostname.toLowerCase();
    } catch (_) {}
  }
  return DEFAULT_MEDIA_HOST;
}

function imageUrlOf(image) {
  if (image == null) return '';
  if (typeof image === 'string') return image.trim();
  return String(image.url || image.image_url || image.src || '').trim();
}

function imageLabelOf(image) {
  if (!image || typeof image !== 'object') return '';
  return `${image.room_label || ''} ${image.slot_key || ''} ${image.label || ''}`.toLowerCase();
}

// Returns null for a real hosted photo, otherwise the reason it doesn't count.
function realPhotoRejection(image) {
  const url = imageUrlOf(image);
  if (!url) return 'empty';
  const lower = url.toLowerCase();
  if (lower.startsWith('data:')) return 'generated_data_image';
  if (lower.includes(STOCK_PHOTO_ID) || /(^|\/\/)([a-z0-9-]+\.)*unsplash\.com/.test(lower)) return 'stock_photo';
  if (/image[\s_-]*pending/.test(lower) || /image[\s_-]*pending|source_evidence_card/.test(imageLabelOf(image))) return 'image_pending_card';
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return 'not_hosted_on_media';
  }
  const host = parsed.hostname.toLowerCase();
  if (/tiktokcdn|byteimg/.test(host)) return 'tiktok_cdn';
  if (!/^https?:$/.test(parsed.protocol)) return 'not_hosted_on_media';
  if (host !== mediaHost()) return 'not_hosted_on_media';
  if (!parsed.pathname || parsed.pathname === '/') return 'not_hosted_on_media';
  return null;
}

function isRealHostedPhoto(image) {
  return realPhotoRejection(image) === null;
}

function summariseListingPhotos(images = []) {
  const rejected = {};
  let real = 0;
  for (const image of Array.isArray(images) ? images : []) {
    const reason = realPhotoRejection(image);
    if (reason === null) real += 1;
    else rejected[reason] = (rejected[reason] || 0) + 1;
  }
  return { ok: real >= 1, real_photos: real, total: Array.isArray(images) ? images.length : 0, rejected };
}

// Loads only the url/label columns for the given listings (one query) and
// returns Map<propertyId, summary>.
async function loadRealPhotoSummaries(queryable, propertyIds = []) {
  const ids = [...new Set((propertyIds || []).map((id) => String(id || '').toLowerCase()).filter((id) => UUID_RE.test(id)))];
  const out = new Map(ids.map((id) => [id, summariseListingPhotos([])]));
  if (!ids.length) return out;
  const result = await queryable.query(
    `SELECT property_id::text AS property_id, url, slot_key, room_label
       FROM property_images
      WHERE property_id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map();
  for (const row of result.rows || []) {
    if (!byId.has(row.property_id)) byId.set(row.property_id, []);
    byId.get(row.property_id).push(row);
  }
  for (const id of ids) out.set(id, summariseListingPhotos(byId.get(id) || []));
  return out;
}

async function listingRealPhotoCheck(queryable, propertyId) {
  const map = await loadRealPhotoSummaries(queryable, [propertyId]);
  return map.get(String(propertyId || '').toLowerCase()) || summariseListingPhotos([]);
}

module.exports = {
  DEFAULT_MEDIA_HOST,
  STOCK_PHOTO_ID,
  NO_REAL_PHOTO_CODE,
  NO_REAL_PHOTO_MESSAGE,
  mediaHost,
  realPhotoRejection,
  isRealHostedPhoto,
  summariseListingPhotos,
  loadRealPhotoSummaries,
  listingRealPhotoCheck
};
