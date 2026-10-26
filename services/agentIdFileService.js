'use strict';

// Agent ID documents uploaded by staff (front, back, other papers).
// The bytes go into Postgres (agent_identity_files.content) and are only ever
// sent back through the staff-only agent-manager route, never via a URL.
// Photos are re-encoded so EXIF and GPS tags are dropped; PDFs and HEIC files
// that cannot be decoded are kept as they came.

const crypto = require('crypto');

const ID_FILE_KINDS = Object.freeze({
  id_front: 'ID front',
  id_back: 'ID back',
  other: 'Other document'
});
const ID_FILE_MAX_BYTES = 10 * 1024 * 1024;
const ID_FILE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

function idFileError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// What the bytes really are; the browser's claimed type is not trusted.
function sniffIdFileMime(bytes) {
  if (!bytes || bytes.length < 12) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('latin1').toLowerCase();
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'].includes(brand)) return 'image/heic';
  }
  return '';
}

function decodeIdFileDataUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:([^;,]*)((?:;[^;,]+)*);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw idFileError('Choose a photo (JPG, PNG, WebP, HEIC) or a PDF to upload.');
  const bytes = Buffer.from(match[3].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) throw idFileError('That file is empty.');
  return bytes;
}

function cleanOriginalName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim().slice(0, 160);
}

async function stripImage(bytes) {
  const sharp = require('sharp');
  // sharp drops EXIF/GPS/XMP unless asked to keep them; rotate() bakes the
  // camera orientation in first so the photo stays upright.
  return sharp(bytes, { failOn: 'none', limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/**
 * Check and prepare one upload. Returns what goes into agent_identity_files.
 * Throws a 400 error with a plain-English message when the file is not usable.
 */
async function prepareIdFileUpload({ dataUrl, name, kind } = {}) {
  if (!Object.prototype.hasOwnProperty.call(ID_FILE_KINDS, kind)) throw idFileError('Say whether this is the ID front, ID back or another document.');
  const original = decodeIdFileDataUrl(dataUrl);
  if (original.length > ID_FILE_MAX_BYTES) throw idFileError('That file is over 10 MB. Send a smaller photo or PDF.');
  const sniffed = sniffIdFileMime(original);
  if (!ID_FILE_MIME_TYPES.includes(sniffed)) throw idFileError('Only JPG, PNG, WebP, HEIC photos or PDF files can be uploaded.');

  let bytes = original;
  let mimeType = sniffed;
  let metadataStripped = false;
  if (sniffed !== 'application/pdf') {
    try {
      const jpeg = await stripImage(original);
      if (jpeg?.length) {
        bytes = jpeg;
        mimeType = 'image/jpeg';
        metadataStripped = true;
      }
    } catch (error) {
      if (sniffed !== 'image/heic') throw idFileError('That photo could not be read. Try taking it again or send it as a PDF.');
      // An iPhone HEIC photo we cannot decode is kept as it came (download only).
    }
  }
  return {
    kind,
    label: ID_FILE_KINDS[kind],
    original_name: cleanOriginalName(name) || null,
    mime_type: mimeType,
    byte_size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    content: bytes,
    metadata_stripped: metadataStripped
  };
}

function idFileExtension(mimeType) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }[mimeType] || 'bin';
}

// The file name staff get on download: agent, side and date, never the upload name.
function idFileDownloadName({ agentName, kind, uploadedAt, mimeType } = {}) {
  const who = String(agentName || 'agent').normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent';
  const day = (uploadedAt ? new Date(uploadedAt) : new Date()).toISOString().slice(0, 10);
  return `${who}-${String(kind || 'document').replace(/_/g, '-')}-${day}.${idFileExtension(mimeType)}`;
}

// Headers for every ID file response: private, never cached, never indexed.
function privateFileHeaders({ mimeType, filename, download } = {}) {
  return {
    'Content-Type': mimeType || 'application/octet-stream',
    'Cache-Control': 'no-store, private, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${String(filename || 'id-document').replace(/["\\\r\n]/g, '')}"`
  };
}

module.exports = {
  ID_FILE_KINDS,
  ID_FILE_MAX_BYTES,
  ID_FILE_MIME_TYPES,
  decodeIdFileDataUrl,
  idFileDownloadName,
  prepareIdFileUpload,
  privateFileHeaders,
  sniffIdFileMime
};
