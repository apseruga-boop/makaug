'use strict';

const crypto = require('crypto');
const { normalizeUgandanSourcePhone, ugandanPhoneFromSourceText } = require('../utils/sourceIntakeIntegrity');
const { normalizeSourceUrl, stablePlatformPostIdentity } = require('../utils/sourceUrlNormalization');

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedCaptionTokens(value = '') {
  return compact(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function captionSimHash(value = '') {
  const tokens = normalizedCaptionTokens(value);
  if (!tokens.length) return '';
  const features = [
    ...tokens,
    ...tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`),
    ...tokens.slice(0, -2).map((token, index) => `${token} ${tokens[index + 1]} ${tokens[index + 2]}`),
  ];
  const weights = new Array(64).fill(0);
  for (const feature of features) {
    const hash = crypto.createHash('sha256').update(feature).digest();
    for (let bit = 0; bit < 64; bit += 1) {
      const on = (hash[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1;
      weights[bit] += on ? 1 : -1;
    }
  }
  let result = 0n;
  for (const weight of weights) result = (result << 1n) | (weight >= 0 ? 1n : 0n);
  return result.toString(16).padStart(16, '0');
}

function hammingDistanceHex(left = '', right = '') {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) || left.length !== right.length) return null;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (bits) {
    distance += Number(bits & 1n);
    bits >>= 1n;
  }
  return distance;
}

function dHashFromGrayscalePixels(pixels = [], width = 9, height = 8) {
  if (!pixels || pixels.length < width * height || width < 2) return '';
  let hash = 0n;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width - 1; col += 1) {
      const offset = row * width + col;
      hash = (hash << 1n) | (Number(pixels[offset]) > Number(pixels[offset + 1]) ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(Math.ceil((height * (width - 1)) / 4), '0');
}

function pHashFromGrayscalePixels(pixels = [], width = 32, height = 32, hashSize = 8) {
  if (!pixels || pixels.length < width * height || hashSize < 2) return '';
  const coefficients = [];
  for (let vertical = 0; vertical < hashSize; vertical += 1) {
    for (let horizontal = 0; horizontal < hashSize; horizontal += 1) {
      let coefficient = 0;
      for (let row = 0; row < height; row += 1) {
        const verticalCosine = Math.cos(((2 * row + 1) * vertical * Math.PI) / (2 * height));
        for (let column = 0; column < width; column += 1) {
          coefficient += Number(pixels[row * width + column])
            * Math.cos(((2 * column + 1) * horizontal * Math.PI) / (2 * width))
            * verticalCosine;
        }
      }
      coefficients.push(coefficient);
    }
  }
  const comparisonValues = coefficients.slice(1).sort((left, right) => left - right);
  const midpoint = Math.floor(comparisonValues.length / 2);
  const median = comparisonValues.length % 2
    ? comparisonValues[midpoint]
    : (comparisonValues[midpoint - 1] + comparisonValues[midpoint]) / 2;
  let hash = 0n;
  for (const coefficient of coefficients) hash = (hash << 1n) | (coefficient > median ? 1n : 0n);
  return hash.toString(16).padStart(Math.ceil((hashSize * hashSize) / 4), '0');
}

async function primaryImagePerceptualHashes(imageUrl = '', {
  fetchImpl = fetch,
  timeoutMs = 4500,
  maxBytes = 12 * 1024 * 1024,
} = {}) {
  if (!/^https?:\/\//i.test(String(imageUrl || ''))) return { hash: '', reason: 'missing_remote_image' };
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    return { hash: '', reason: 'sharp_not_installed' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || 4500));
  try {
    const response = await fetchImpl(imageUrl, { signal: controller.signal, headers: { Accept: 'image/*' } });
    if (!response.ok) return { hash: '', reason: `image_fetch_${response.status}` };
    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > maxBytes) return { hash: '', dhash: '', phash: '', reason: 'image_hash_too_large' };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) return { hash: '', dhash: '', phash: '', reason: 'image_hash_too_large' };
    const image = sharp(buffer).greyscale();
    const [{ data: dHashPixels }, { data: pHashPixels }] = await Promise.all([
      image.clone().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
      image.clone().resize(32, 32, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }),
    ]);
    const dHash = dHashFromGrayscalePixels(dHashPixels, 9, 8);
    const pHash = pHashFromGrayscalePixels(pHashPixels, 32, 32, 8);
    return { hash: dHash, dhash: dHash, phash: pHash, reason: '' };
  } catch (error) {
    return {
      hash: '',
      dhash: '',
      phash: '',
      reason: error.name === 'AbortError' ? 'image_hash_timeout' : (error.message || 'image_hash_failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function primaryImageDHash(imageUrl = '', options = {}) {
  const report = await primaryImagePerceptualHashes(imageUrl, options);
  return { hash: report.dhash || report.hash || '', reason: report.reason || '' };
}

function contactClusterKey(record = {}) {
  const text = compact([
    record.contact_phone, record.phone, record.whatsapp, record.lister_phone,
    record.caption, record.description, record.source_text,
  ].filter(Boolean).join(' '));
  const phone = normalizeUgandanSourcePhone(record.contact_phone || record.phone || record.whatsapp || '')
    || ugandanPhoneFromSourceText(text);
  if (phone) return `phone:${phone.replace(/\D/g, '')}`;
  const waPhone = text.match(/wa\.me\/(\d{9,15})/i)?.[1] || '';
  if (waPhone) return `phone:${waPhone}`;
  const handle = normalizeSourceUrl(record.source_contact_url || record.source_page_url || '')
    .match(/(?:tiktok\.com\/@|instagram\.com\/|x\.com\/)([^/?#]+)/i)?.[1] || '';
  return handle ? `handle:${handle.toLowerCase()}` : '';
}

function normalizedAreaToken(record = {}) {
  return compact(record.area || record.location || record.district || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function priceBucket(record = {}) {
  const amount = Math.max(0, Number(record.price || record.price_ugx || 0) || 0);
  if (!amount) return '';
  const bucketSize = amount < 10000000 ? 250000 : amount < 100000000 ? 1000000 : 5000000;
  return String(Math.round(amount / bucketSize) * bucketSize);
}

function compositeListingKey(record = {}, imageHash = '') {
  const components = [contactClusterKey(record), priceBucket(record), normalizedAreaToken(record), imageHash].filter(Boolean);
  if (components.length < 3) return '';
  return crypto.createHash('sha256').update(components.join('|')).digest('hex').slice(0, 32);
}

function buildHarvestFingerprints(record = {}, { imageHash = '', imagePHash = '' } = {}) {
  const sourceUrl = record.source_url || record.post_url || record.source_post_url || record.url || '';
  const identity = stablePlatformPostIdentity(sourceUrl);
  const caption = [record.caption, record.title, record.description, record.source_text].filter(Boolean).join(' ');
  const contactKey = contactClusterKey(record);
  const captionHash = captionSimHash(caption);
  return {
    canonical_source_url: identity.canonical_url || normalizeSourceUrl(sourceUrl),
    source_platform_id: identity.key,
    caption_simhash: captionHash,
    primary_image_dhash: imageHash,
    primary_image_phash: imagePHash,
    contact_cluster_key: contactKey,
    composite_listing_key: compositeListingKey(record, imagePHash || imageHash),
  };
}

module.exports = {
  buildHarvestFingerprints,
  captionSimHash,
  compositeListingKey,
  contactClusterKey,
  dHashFromGrayscalePixels,
  hammingDistanceHex,
  pHashFromGrayscalePixels,
  primaryImageDHash,
  primaryImagePerceptualHashes,
};
