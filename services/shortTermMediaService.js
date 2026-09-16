'use strict';

// Photo upload for Short Term listings.
//
// Three things this file is careful about:
//
//   1. PRIVACY. A photo taken on a phone carries EXIF, and EXIF usually
//      carries GPS. Publishing a host's untouched camera roll photo publishes
//      the exact coordinates of their home. Every image is re-encoded through
//      sharp, which drops metadata, and if sharp is unavailable the upload is
//      REFUSED rather than stored raw. Failing closed is the only safe
//      behaviour when the failure mode is leaking someone's address.
//
//   2. AUTHORISATION WITHOUT AN ACCOUNT. Hosts list without signing up, which
//      is deliberate: an account requirement is the thing that stops a Ugandan
//      landlord with a WhatsApp-shaped idea of the internet from ever
//      listing. So the listing submission hands back a short-lived signed
//      token, and that token is what lets photos be attached. A leaked listing
//      id on its own buys nothing once the token expires.
//
//   3. BANDWIDTH. A 5MB photo over Kampala mobile data is a real cost to a
//      real person. Images are capped, downscaled to 1600px and re-encoded, so
//      what gets stored and served back is a few hundred kilobytes.

const crypto = require('crypto');

const logger = require('../config/logger');
const { storeDataUrl, cloudMediaStorageConfigured } = require('./cloudMediaStorageService');

const SHORT_TERM_MEDIA_MARKER = 'short-term-media-v1';

// New prefix inside the existing bucket. Nothing already stored is read,
// moved or rewritten.
const MEDIA_KEY_PREFIX = 'short-term';

const MAX_IMAGES_PER_LISTING = 12;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 82;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const UPLOAD_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // six hours to finish a listing

const DATA_URL_RE = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+);base64,([\s\S]+)$/i;

function mediaError(message, status = 400, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = Array.isArray(details) ? details : [details];
  return error;
}

// ---------------------------------------------------------------------------
// Upload tokens
// ---------------------------------------------------------------------------

function tokenSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw mediaError('Photo uploads are unavailable because the server signing key is not configured.', 503);
  }
  return secret;
}

function signPayload(listingId, expiresAt) {
  return crypto
    .createHmac('sha256', tokenSecret())
    .update(`${SHORT_TERM_MEDIA_MARKER}:${listingId}:${expiresAt}`)
    .digest('base64url');
}

function createUploadToken(listingId, { ttlMs = UPLOAD_TOKEN_TTL_MS } = {}) {
  const expiresAt = Date.now() + Math.max(60000, Number(ttlMs) || UPLOAD_TOKEN_TTL_MS);
  return `${expiresAt}.${signPayload(listingId, expiresAt)}`;
}

function verifyUploadToken(listingId, token) {
  const raw = String(token || '').trim();
  const [expiresRaw, signature] = raw.split('.');
  const expiresAt = Number(expiresRaw);

  if (!expiresRaw || !signature || !Number.isFinite(expiresAt)) {
    throw mediaError('That upload link is not valid. Submit the listing again to get a new one.', 401);
  }
  if (expiresAt < Date.now()) {
    throw mediaError('That upload link has expired. Submit the listing again to get a new one.', 401);
  }

  const expected = Buffer.from(signPayload(listingId, expiresAt));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw mediaError('That upload link is not valid for this listing.', 401);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

let sharpModule;
let sharpChecked = false;

function loadSharp() {
  if (sharpChecked) return sharpModule;
  sharpChecked = true;
  try {
    sharpModule = require('sharp');
  } catch (error) {
    sharpModule = null;
    logger.error('sharp is unavailable, so short term photo uploads are refused', {
      marker: SHORT_TERM_MEDIA_MARKER,
      message: error?.message
    });
  }
  return sharpModule;
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').trim().match(DATA_URL_RE);
  if (!match) {
    throw mediaError('That photo could not be read. Upload a JPEG, PNG or WebP image.', 400);
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw mediaError('Photos must be JPEG, PNG or WebP.', 400);
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) {
    throw mediaError('That photo came through empty. Try again.', 400);
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw mediaError(`That photo is too big. Keep each one under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`, 400);
  }
  return { bytes, mimeType };
}

/**
 * Re-encodes an image and, as a side effect of re-encoding, drops every piece
 * of metadata it arrived with - including the GPS coordinates a phone writes
 * into a photo of someone's own house.
 */
async function normaliseImage(bytes) {
  const sharp = loadSharp();
  if (!sharp) {
    throw mediaError(
      'Photo uploads are temporarily unavailable on this server. Your listing is saved; add photos once this is fixed.',
      503
    );
  }

  let processed;
  try {
    processed = await sharp(bytes)
      // rotate() with no argument applies the EXIF orientation, so the photo
      // is the right way up once the EXIF that described it is gone.
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw mediaError('That file is not an image we can read. Upload a JPEG, PNG or WebP photo.', 400);
  }

  const { data, info } = processed;
  if (!data?.length) {
    throw mediaError('That photo could not be processed. Try a different one.', 400);
  }
  return {
    bytes: data,
    mimeType: 'image/jpeg',
    width: info.width,
    height: info.height,
    size: data.length
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function storeListingImage(listingId, dataUrl, { caption } = {}) {
  const parsed = parseImageDataUrl(dataUrl);
  const image = await normaliseImage(parsed.bytes);

  if (!cloudMediaStorageConfigured()) {
    throw mediaError(
      'Photo storage is not configured on this server. Set MEDIA_STORAGE_PROVIDER=s3 and the S3_* variables.',
      503
    );
  }

  const url = await storeDataUrl(
    `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
    {
      keyPrefix: `${MEDIA_KEY_PREFIX}/${listingId}`,
      filename: 'photo',
      label: 'Listing photo',
      allowedMimeTypes: ['image/jpeg'],
      maxBytes: MAX_UPLOAD_BYTES
    }
  );

  if (!url) {
    throw mediaError('Photo storage did not accept the upload. Try again in a moment.', 502);
  }

  return {
    url,
    caption: String(caption || '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
    width: image.width,
    height: image.height,
    bytes: image.size
  };
}

/**
 * Attaches one photo to a listing. Called once per photo so a host on a slow
 * connection sees each one land instead of waiting on one large request that
 * either all works or all fails.
 */
async function attachListingPhoto(db, listingId, { dataUrl, caption, token } = {}) {
  verifyUploadToken(listingId, token);

  const listing = await db.query(
    "SELECT id, status FROM st_listing WHERE id = $1::uuid LIMIT 1",
    [listingId]
  );
  if (!listing.rows.length) {
    throw mediaError('That listing no longer exists.', 404);
  }
  if (!['draft', 'pending', 'approved'].includes(String(listing.rows[0].status))) {
    throw mediaError('Photos cannot be added to this listing.', 409);
  }

  const existing = await db.query(
    'SELECT COUNT(*)::int AS total FROM st_listing_media WHERE listing_id = $1::uuid',
    [listingId]
  );
  const total = Number(existing.rows[0]?.total || 0);
  if (total >= MAX_IMAGES_PER_LISTING) {
    throw mediaError(`A listing can have up to ${MAX_IMAGES_PER_LISTING} photos.`, 409);
  }

  const stored = await storeListingImage(listingId, dataUrl, { caption });

  const inserted = await db.query(
    `INSERT INTO st_listing_media (listing_id, url, storage_key, caption, is_primary, sort_order)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     RETURNING id, url, caption, is_primary, sort_order`,
    [
      listingId,
      stored.url,
      `${MEDIA_KEY_PREFIX}/${listingId}`,
      stored.caption,
      total === 0,
      total
    ]
  );

  logger.info('Short term listing photo attached', {
    marker: SHORT_TERM_MEDIA_MARKER,
    listingId,
    position: total,
    bytes: stored.bytes,
    width: stored.width,
    height: stored.height
  });

  return {
    id: String(inserted.rows[0].id),
    url: inserted.rows[0].url,
    caption: inserted.rows[0].caption,
    is_primary: inserted.rows[0].is_primary,
    sort_order: inserted.rows[0].sort_order,
    photo_count: total + 1,
    remaining: MAX_IMAGES_PER_LISTING - (total + 1)
  };
}

async function listListingPhotos(db, listingId) {
  const result = await db.query(
    `SELECT id, url, caption, is_primary, sort_order
     FROM st_listing_media WHERE listing_id = $1::uuid
     ORDER BY is_primary DESC, sort_order ASC`,
    [listingId]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    url: row.url,
    caption: row.caption,
    is_primary: row.is_primary,
    sort_order: row.sort_order
  }));
}

function photoUploadReady() {
  return Boolean(loadSharp()) && cloudMediaStorageConfigured();
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_EDGE_PX,
  MAX_IMAGES_PER_LISTING,
  MAX_UPLOAD_BYTES,
  MEDIA_KEY_PREFIX,
  SHORT_TERM_MEDIA_MARKER,
  UPLOAD_TOKEN_TTL_MS,
  attachListingPhoto,
  createUploadToken,
  listListingPhotos,
  normaliseImage,
  parseImageDataUrl,
  photoUploadReady,
  storeListingImage,
  verifyUploadToken
};
