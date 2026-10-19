'use strict';

/**
 * Tidy an agent's profile image before it goes on a public page.
 *
 * Agents send what they have: a selfie taken sideways, a screenshot-sized
 * logo, a wide group shot. The result is always a square JPEG that looks
 * deliberate on a profile page and in the round avatar.
 *
 *  - A photo of a person is orientation-fixed, cropped square around the most
 *    interesting part of the picture (faces first), gently brightened and
 *    sharpened.
 *  - A logo (transparent, or very wide or tall) is never cropped. It is placed
 *    whole on a clean white square, so no letter is cut off.
 *  - Nothing is enlarged past its real size beyond 800 px, and an image too
 *    small to look good is reported so the agent can send a better one.
 */

const MIN_SIDE_PX = 200;
const MAX_SIDE_PX = 800;
const MIN_OUTPUT_PX = 400;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

async function cleanProfileImage(input) {
  const sharp = require('sharp');
  const source = sharp(input, { failOn: 'none' }).rotate();
  const meta = await sharp(input, { failOn: 'none' }).rotate().metadata();
  // metadata() reports the stored size; a 90-degree EXIF turn swaps it.
  const swapped = Number(meta.orientation || 1) >= 5;
  const width = (swapped ? meta.height : meta.width) || 0;
  const height = (swapped ? meta.width : meta.height) || 0;
  if (!width || !height) throw new Error('Unreadable image');
  if (Math.min(width, height) < MIN_SIDE_PX) {
    return { tooSmall: true, width, height };
  }

  const ratio = width / height;
  const logoLike = meta.hasAlpha === true || ratio > 1.6 || ratio < 0.6;
  let pipeline;
  let mode;
  if (logoLike) {
    const side = clamp(Math.max(width, height), MIN_OUTPUT_PX, MAX_SIDE_PX);
    mode = 'logo';
    pipeline = source
      .flatten({ background: '#ffffff' })
      .resize(side, side, { fit: 'contain', background: '#ffffff' });
  } else {
    const side = clamp(Math.min(width, height), MIN_OUTPUT_PX, MAX_SIDE_PX);
    mode = 'photo';
    pipeline = source
      .resize(side, side, { fit: 'cover', position: sharp.strategy.attention })
      .normalise({ lower: 1, upper: 99 })
      .modulate({ brightness: 1.03, saturation: 1.05 })
      .sharpen({ sigma: 0.7 });
  }
  const bytes = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return { bytes, mimeType: 'image/jpeg', mode, width, height };
}

const photoKindCache = new Map();

function declaredPhotoKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return kind === 'logo' || kind === 'portrait' ? kind : '';
}

function photoUrlSaysLogo(url = '') {
  const path = String(url || '').split('?')[0];
  if (path.startsWith('data:')) return false;
  return /(?:^|[/_.-])logo(?:[/_.-]|$)/i.test(path);
}

function bufferFromPhotoUrl(url = '') {
  const match = String(url || '').match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (buffer.length < 32 || buffer.length > 2_500_000) return null;
  return buffer;
}

function luminance(r, g, b) {
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

// A company mark that was squared onto a light or solid plate (the Chief
// Properties logo is the case this is for). A face fills the frame, so its
// corners are not one flat colour with a different centre.
async function squarePlateLooksLikeLogo(buffer) {
  const sharp = require('sharp');
  const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return false;
  const ratio = width / height;
  if (ratio < 0.9 || ratio > 1.1) return false;
  const side = 16;
  const { data } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(side, side, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const index = ((y * side) + x) * 3;
    return luminance(data[index], data[index + 1], data[index + 2]);
  };
  const corners = [at(0, 0), at(side - 1, 0), at(0, side - 1), at(side - 1, side - 1), at(1, 1), at(side - 2, 0)];
  const average = corners.reduce((sum, value) => sum + value, 0) / corners.length;
  const variance = corners.reduce((sum, value) => sum + ((value - average) ** 2), 0) / corners.length;
  const flat = variance < 90;
  const lightOrSolid = average > 205 || average < 45;
  if (!flat || !lightOrSolid) return false;
  const center = at(8, 8);
  return Math.abs(center - average) >= 28;
}

function photoCacheKey(url, declared) {
  const value = String(url || '');
  return `${declared}|${value.length}|${value.slice(0, 64)}|${value.slice(-48)}`;
}

// Explicit profile_photo_kind wins. Otherwise a logo URL, or a square image
// whose corners are a light or solid plate, is a logo. Everything else stays
// a portrait, which is what the round and cover crops expect.
async function inferProfilePhotoKind(photoUrl = '', declared = '') {
  const explicit = declaredPhotoKind(declared);
  if (explicit) return explicit;
  if (photoUrlSaysLogo(photoUrl)) return 'logo';
  const key = photoCacheKey(photoUrl, '');
  const cached = photoKindCache.get(key);
  if (cached) return cached;
  let kind = 'portrait';
  const buffer = bufferFromPhotoUrl(photoUrl);
  if (buffer) {
    try {
      if (await squarePlateLooksLikeLogo(buffer)) kind = 'logo';
    } catch (_) {
      kind = 'portrait';
    }
  }
  photoKindCache.set(key, kind);
  if (photoKindCache.size > 400) photoKindCache.delete(photoKindCache.keys().next().value);
  return kind;
}

module.exports = {
  cleanProfileImage,
  inferProfilePhotoKind,
  squarePlateLooksLikeLogo,
  MIN_SIDE_PX,
  MAX_SIDE_PX
};
