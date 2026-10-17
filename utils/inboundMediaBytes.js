'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SPILL_DIR = path.join(os.tmpdir(), 'makaug-wa-media');

async function ensureSpillDir() {
  await fs.promises.mkdir(SPILL_DIR, { recursive: true });
}

function removeSpillFile(filePath = '') {
  const resolved = path.resolve(String(filePath || ''));
  const root = path.resolve(SPILL_DIR);
  if (!resolved.startsWith(`${root}${path.sep}`)) return Promise.resolve(false);
  return fs.promises.unlink(resolved).then(() => true).catch(() => false);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function writeResponseBodyToFile(response, { maxBytes = 25_000_000 } = {}) {
  await ensureSpillDir();
  const filePath = path.join(SPILL_DIR, `${crypto.randomUUID()}.bin`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const handle = await fs.promises.open(filePath, 'w');
  const fail = async (error) => {
    await handle.close().catch(() => {});
    await removeSpillFile(filePath);
    throw error;
  };
  try {
    const reader = response?.body?.getReader?.();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > maxBytes) {
          const error = new Error('Bounded response body is too large');
          error.code = 'BOUNDED_BODY_TOO_LARGE';
          return fail(error);
        }
        hash.update(chunk);
        await handle.write(chunk);
      }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) {
        const error = new Error('Bounded response body is too large');
        error.code = 'BOUNDED_BODY_TOO_LARGE';
        return fail(error);
      }
      hash.update(bytes);
      await handle.write(bytes);
      size = bytes.length;
    }
  } catch (error) {
    return fail(error);
  }
  await handle.close();
  return { filePath, sha256: hash.digest('hex'), bytes: size };
}

async function readFilePrefix(filePath, maxBytes = 512 * 1024) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function smallJpegDataUrl(filePath) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    return '';
  }
  const jpeg = await sharp(filePath, { limitInputPixels: 12_000_000 })
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 55 })
    .toBuffer();
  if (jpeg.length > 1.5 * 1024 * 1024) return '';
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function spillDataUrlItem(item = {}) {
  const raw = item.data_url || item.dataUrl || '';
  if (typeof raw !== 'string' || raw.length < 2048) return item;
  await ensureSpillDir();
  const filePath = path.join(SPILL_DIR, `${crypto.randomUUID()}.bin`);
  const encoded = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  await fs.promises.writeFile(filePath, Buffer.from(encoded, 'base64'));
  item.media_file = filePath;
  delete item.data_url;
  delete item.dataUrl;
  return item;
}

async function spillInboundMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  for (const key of ['image_previews', 'media_previews']) {
    const list = metadata[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === 'object') await spillDataUrlItem(item);
    }
  }
  return metadata;
}

module.exports = {
  SPILL_DIR,
  writeResponseBodyToFile,
  readFilePrefix,
  smallJpegDataUrl,
  spillDataUrlItem,
  spillInboundMetadata,
  removeSpillFile,
  hashFile
};
