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

module.exports = { cleanProfileImage, MIN_SIDE_PX, MAX_SIDE_PX };
