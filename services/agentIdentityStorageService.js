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

const ID_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'];

function isInlineImage(value) {
  return /^data:(?:image\/[a-z0-9.+-]+|application\/pdf);base64,/i.test(String(value || '').trim());
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
  if (!isInlineImage(raw) || !cloudMediaStorageConfigured()) return raw;
  const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const stored = await storeDataUrl(raw, {
    keyPrefix,
    filename: `national-id-${digest}`,
    label,
    isPrivate: true,
    allowedMimeTypes: ID_MIME_TYPES,
    maxBytes: 8 * 1024 * 1024
  });
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
  toPrivateIdentityRef,
  viewableIdentityUrl
};
