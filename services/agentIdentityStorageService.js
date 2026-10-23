'use strict';

// Agent / broker National ID photos belong in private file storage, not as
// base64 text inside users.profile_data or agents.identity_document_url.
// New uploads are stored privately as they arrive; older inline photos are
// moved by migrateInlineAgentIdentityDocuments (safe to run repeatedly).

const crypto = require('crypto');
const {
  cloudMediaStorageConfigured,
  createSignedS3GetUrl,
  storeDataUrl
} = require('./cloudMediaStorageService');

const ID_MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-webp': 'image/webp',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heif',
  'image/heic': 'image/heic',
  'image/heif': 'image/heif',
  'application/x-pdf': 'application/pdf',
  'application/acrobat': 'application/pdf',
  'application/vnd.pdf': 'application/pdf'
};

const ID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'];
const ID_MIME_SET = new Set(ID_MIME_TYPES);

function sniffIdentityMime(bytes) {
  if (!bytes || bytes.length < 12) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes.slice(0, 4).toString() === 'RIFF' && bytes.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes.slice(0, 6).toString() === 'GIF87a' || bytes.slice(0, 6).toString() === 'GIF89a') return 'image/gif';
  if (bytes.slice(4, 8).toString() === 'ftyp') {
    const brand = bytes.slice(8, 12).toString().toLowerCase();
    if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1' || brand === 'hevc') return 'image/heic';
  }
  return '';
}

function canonicalIdentityMime(declared, bytes) {
  const raw = String(declared || '').trim().toLowerCase();
  const aliased = ID_MIME_ALIASES[raw] || raw;
  if (ID_MIME_SET.has(aliased)) return aliased;
  const sniffed = sniffIdentityMime(bytes);
  return ID_MIME_SET.has(sniffed) ? sniffed : '';
}

function parseIdentityDataUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:([^;,]+)((?:;[^;,]+)*)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const bytes = Buffer.from(match[3].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) return null;
  const mimeType = canonicalIdentityMime(match[1], bytes);
  if (!mimeType) return null;
  return { bytes, mimeType };
}

function isInlineImage(value) {
  return Boolean(parseIdentityDataUrl(value));
}

async function normaliseIdentityBytes(bytes, mimeType) {
  if (mimeType === 'application/pdf') return { bytes, mimeType };
  try {
    const sharp = require('sharp');
    const jpeg = await sharp(bytes, { failOn: 'none', limitInputPixels: 40_000_000 })
      .rotate()
      .jpeg({ quality: 82 })
      .toBuffer();
    if (jpeg?.length) return { bytes: jpeg, mimeType: 'image/jpeg' };
  } catch (_error) {
    // A HEIC file without a decoder is stored as itself, still private.
  }
  return { bytes, mimeType };
}

function isPrivateRef(value) {
  return /^s3:\/\//i.test(String(value || '').trim());
}

/**
 * Store an inline ID photo privately and return its private reference.
 * Anything that is not an inline image (an https URL, an s3:// ref, empty)
 * comes back unchanged, as does the photo itself when storage is not set up.
 */
async function toPrivateIdentityRef(value, { keyPrefix = 'agents/identity', label = 'Agent National ID photo' } = {}) {
  const raw = String(value || '').trim();
  const parsed = parseIdentityDataUrl(raw);
  if (!parsed || !cloudMediaStorageConfigured()) return raw;
  const prepared = await normaliseIdentityBytes(parsed.bytes, parsed.mimeType);
  const dataUrl = `data:${prepared.mimeType};base64,${prepared.bytes.toString('base64')}`;
  const digest = crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 16);
  // If storage is down, keep the photo as it came (the start-up tidy-up moves it
  // later) rather than failing the person's sign-up. The stored object stays
  // private: a public https URL is never written back.
  const stored = await storeDataUrl(dataUrl, {
    keyPrefix,
    filename: `national-id-${digest}`,
    label,
    isPrivate: true,
    allowedMimeTypes: ID_MIME_TYPES,
    maxBytes: 8 * 1024 * 1024
  }).catch((error) => {
    console.warn('Private ID photo storage failed; keeping it inline for now:', error.message || String(error));
    return null;
  });
  if (stored && /^https?:\/\//i.test(stored)) return raw;
  return stored || raw;
}

/** A short-lived link staff can open. Inline photos are returned as they are. */
function viewableIdentityUrl(value, { expiresSeconds = 300 } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return { available: false, url: '', storage: 'missing' };
  if (isPrivateRef(raw)) {
    const signed = createSignedS3GetUrl(raw, { expiresSeconds });
    return { available: true, url: signed.url, expires_at: signed.expiresAt, storage: 'private_s3' };
  }
  if (isInlineImage(raw)) return { available: true, url: raw, storage: 'inline_data_url' };
  if (/^https:\/\//i.test(raw)) return { available: true, url: raw, storage: 'remote_url' };
  return { available: false, url: '', storage: 'unsupported_reference' };
}

/** For lists: say a photo exists without sending megabytes of base64. */
function identityListMarker(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return raw;
  return isPrivateRef(raw) ? 'private' : 'inline';
}

async function migrateInlineAgentIdentityDocuments(db, { limit = 200, logger = console } = {}) {
  const result = { agents_moved: 0, users_moved: 0, failed: 0, skipped_no_storage: false };
  if (!cloudMediaStorageConfigured()) {
    result.skipped_no_storage = true;
    return result;
  }

  const agents = await db.query(
    `SELECT id, identity_document_url
       FROM agents
      WHERE identity_document_url LIKE 'data:%'
      LIMIT $1`,
    [limit]
  );
  for (const row of agents.rows) {
    try {
      const ref = await toPrivateIdentityRef(row.identity_document_url, { keyPrefix: `agents/${row.id}/identity` });
      if (!isPrivateRef(ref)) { result.failed += 1; continue; }
      await db.query(
        `UPDATE agents SET identity_document_url = $2, updated_at = NOW()
          WHERE id = $1 AND identity_document_url = $3`,
        [row.id, ref, row.identity_document_url]
      );
      result.agents_moved += 1;
    } catch (error) {
      result.failed += 1;
      logger?.warn?.('Agent ID photo move failed:', row.id, error.message || String(error));
    }
  }

  const users = await db.query(
    `SELECT id, profile_data->>'broker_identity_document_url' AS doc
       FROM users
      WHERE profile_data->>'broker_identity_document_url' LIKE 'data:%'
      LIMIT $1`,
    [limit]
  );
  for (const row of users.rows) {
    try {
      const ref = await toPrivateIdentityRef(row.doc, { keyPrefix: `users/${row.id}/identity` });
      if (!isPrivateRef(ref)) { result.failed += 1; continue; }
      await db.query(
        `UPDATE users
            SET profile_data = jsonb_set(profile_data, '{broker_identity_document_url}', to_jsonb($2::text)),
                updated_at = NOW()
          WHERE id = $1 AND profile_data->>'broker_identity_document_url' = $3`,
        [row.id, ref, row.doc]
      );
      result.users_moved += 1;
    } catch (error) {
      result.failed += 1;
      logger?.warn?.('Broker ID photo move failed:', row.id, error.message || String(error));
    }
  }
  return result;
}

module.exports = {
  identityListMarker,
  isInlineImage,
  isPrivateRef,
  migrateInlineAgentIdentityDocuments,
  normaliseIdentityBytes,
  parseIdentityDataUrl,
  toPrivateIdentityRef,
  viewableIdentityUrl
};
