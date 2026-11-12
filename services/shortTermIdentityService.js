'use strict';

// Government ID for short-stay hosts who list on /list-property, via the same
// public POST /api/short-term/listings endpoint, or on WhatsApp
// (services/whatsappShortStayService.js), which calls the same functions.
//
// The ID is asked for and encouraged, but it is not required to submit or
// pay. Hosts can send it later with a private signed link. Public pages show
// "ID still pending" until staff tick ID seen (or the host is an approved
// agent with an ID already on file). Found-online stays never show the badge.
//
// Storage and staff viewing reuse the existing private helpers:
//   - prepareMediaUrlForStorage (same as owner listing National ID photos)
//   - viewableIdentityUrl (same as agent / broker ID photos)
// The file is never written to a public URL and never added to the public
// short-stay payload. Staff get a short-lived signed link.

const crypto = require('crypto');

const { prepareMediaUrlForStorage } = require('./cloudMediaStorageService');
const { viewableIdentityUrl } = require('./agentIdentityStorageService');

const HOST_ID_KINDS = Object.freeze({
  national_id: 'National ID',
  passport: 'Passport',
  driving_permit: 'Driving permit'
});

const HOST_ID_PHOTO_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const HOST_ID_MAX_BYTES = 5 * 1024 * 1024;

function clean(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function parseExtraFields(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeHostIdKind(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['national_id', 'nationalid', 'nin', 'id', 'national'].includes(raw)) return 'national_id';
  if (raw === 'passport') return 'passport';
  if (['driving_permit', 'driving_licence', 'driving_license', 'permit', 'licence', 'license'].includes(raw)) {
    return 'driving_permit';
  }
  return '';
}

function normalizeHostIdNumber(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase().trim();
}

function isValidUgNinNumber(value) {
  return /^(CM|CF|PM|PF)[A-Z0-9]{12}$/.test(normalizeHostIdNumber(value));
}

function isAcceptedHostIdPhoto({ name = '', url = '', mimeType = '' } = {}) {
  const fileName = clean(name).toLowerCase();
  const mediaUrl = String(url || '').trim();
  const type = clean(mimeType).toLowerCase();
  if (!fileName && !mediaUrl && !type) return false;
  if (/\.pdf$/i.test(fileName) || type.includes('pdf') || /^data:application\/pdf/i.test(mediaUrl)) return false;
  if (/^data:image\//i.test(mediaUrl)) return true;
  if (type.startsWith('image/')) return true;
  if (/\.(jpe?g|png|webp|heic|heif)$/i.test(fileName)) return true;
  if (/\.(jpe?g|png|webp|heic|heif)(?:$|[?#])/i.test(mediaUrl)) return true;
  if (/^s3:\/\//i.test(mediaUrl)) return true;
  return false;
}

function readHostIdentity(payload = {}) {
  const nested = payload.identity && typeof payload.identity === 'object' ? payload.identity : {};
  const kind = normalizeHostIdKind(
    payload.id_kind || payload.id_document_kind || nested.id_document_kind || nested.id_kind
  );
  const number = normalizeHostIdNumber(payload.id_number || nested.id_number);
  const name = clean(payload.id_document_name || nested.id_document_name, 160);
  const url = String(payload.id_document_url || nested.id_document_url || '').trim();
  const mime = clean(
    payload.id_document_mime_type || payload.id_document_mime || nested.id_document_mime || '',
    80
  );
  return {
    kind: kind || 'national_id',
    number,
    name,
    url,
    mime,
    hasDocument: Boolean(url),
    hasAny: Boolean(url || name || number || kind)
  };
}

function validateHostIdentity(payload = {}, { required = false, identityOnFile = false } = {}) {
  const errors = [];
  const identity = readHostIdentity(payload);

  if (!required || identityOnFile) {
    if (identity.hasAny && identity.hasDocument && !isAcceptedHostIdPhoto(identity)) {
      errors.push('The ID must be a photo of the front of the document. PDFs are not accepted.');
    }
    if (identity.number && identity.kind === 'national_id' && !isValidUgNinNumber(identity.number)) {
      errors.push('That National ID number does not look right. Use the number printed on the ID.');
    }
    return { ok: errors.length === 0, errors, value: identityOnFile && !identity.hasDocument ? { source: 'agent_on_file' } : identity };
  }

  if (!HOST_ID_KINDS[identity.kind]) {
    errors.push('Choose whether this is a National ID, a passport or a driving permit.');
  }
  if (!identity.number) {
    errors.push('Enter the ID number printed on the document.');
  } else if (identity.kind === 'national_id' && !isValidUgNinNumber(identity.number)) {
    errors.push('That National ID number does not look right. Use the number printed on the ID.');
  } else if (identity.kind !== 'national_id' && identity.number.length < 4) {
    errors.push('Enter the ID number printed on the document.');
  }
  if (!identity.hasDocument) {
    errors.push('A photo of the front of your government ID is required.');
  } else if (!isAcceptedHostIdPhoto(identity)) {
    errors.push('The ID must be a photo of the front of the document. PDFs are not accepted.');
  }

  return { ok: errors.length === 0, errors, value: identity };
}

// The approved agent behind a signed-in account (website) or, on WhatsApp, the
// agent record matched to the sender's number. Either id finds the same agent.
async function findVerifiedAgentIdentityOnFile(db, { userId, agentId } = {}) {
  const lookup = clean(userId, 80);
  const agentLookup = clean(agentId, 80);
  if (!db || (!lookup && !agentLookup)) return null;
  const result = await db.query(
    `SELECT a.id, a.full_name, a.identity_document_url, a.identity_document_name, a.identity_document_type
       FROM agents a
      WHERE (
          ($1::text <> '' AND a.user_id::text = $1::text)
          OR ($2::text <> '' AND a.id::text = $2::text)
        )
        AND a.removed_at IS NULL
        AND LOWER(COALESCE(a.status, '')) = 'approved'
        AND (
          NULLIF(BTRIM(COALESCE(a.identity_document_url, '')), '') IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM agent_identity_files idf
             WHERE idf.agent_id = a.id AND idf.kind = 'id_front' AND idf.archived_at IS NULL
          )
        )
      ORDER BY a.updated_at DESC NULLS LAST
      LIMIT 1`,
    [lookup, agentLookup]
  );
  return result.rows[0] || null;
}

async function persistHostIdentity(identity = {}, { reference, hostName, agentOnFile } = {}) {
  if (agentOnFile && !identity.hasDocument) {
    return {
      required: false,
      source: 'agent_on_file',
      agent_id: String(agentOnFile.id),
      id_document_url: clean(agentOnFile.identity_document_url, 2000) || null,
      id_document_name: clean(agentOnFile.identity_document_name, 160) || 'Agent ID on file',
      id_document_kind: 'national_id',
      id_document_mime: clean(agentOnFile.identity_document_type, 80) || null,
      id_number: null,
      host_name_submitted: clean(hostName, 120) || null,
      reused_at: new Date().toISOString()
    };
  }
  if (!identity || !identity.hasDocument) {
    return {
      required: false,
      pending: true,
      source: 'pending',
      id_document_kind: identity && identity.kind ? identity.kind : null,
      id_number: identity && identity.number ? identity.number : null,
      host_name_submitted: clean(hostName, 120) || null,
      recorded_at: new Date().toISOString()
    };
  }

  const storedUrl = await prepareMediaUrlForStorage(identity.url, {
    keyPrefix: `short-stays/${clean(reference, 40) || 'pending'}/identity`,
    filename: identity.name || 'government-id-photo',
    isPrivate: true,
    allowedMimeTypes: HOST_ID_PHOTO_MIMES,
    maxBytes: HOST_ID_MAX_BYTES,
    label: 'Short-stay host ID photo'
  });

  return {
    required: false,
    pending: true,
    source: 'upload',
    id_document_url: storedUrl,
    id_document_name: identity.name || 'government-id-photo',
    id_document_kind: identity.kind || 'national_id',
    id_document_mime: identity.mime || null,
    id_number: identity.number || null,
    host_name_submitted: clean(hostName, 120) || null,
    uploaded_at: new Date().toISOString()
  };
}

function nameMatchInstruction(hostName) {
  const name = clean(hostName, 120);
  return name
    ? `Check the name on the ID matches "${name}".`
    : 'Check the name on the ID matches the name on the form.';
}

function listingIsFoundOnline(row = {}, extra = {}) {
  const source = String(row.source || '').toLowerCase();
  if (source === 'imported') return true;
  const flag = row.do_not_message ?? extra.do_not_message;
  if (flag === true || flag === 'true' || flag === 1 || flag === '1') return true;
  if (extra.found_online === true || extra.found_online === 'true') return true;
  if (clean(extra.found_online_label, 80)) return true;
  return false;
}

function staffIdentitySummary(row = {}, checklist = {}) {
  const extra = parseExtraFields(row.extra_fields);
  const identity = extra.identity && typeof extra.identity === 'object' ? extra.identity : {};
  const hostName = clean(row.host_name || identity.host_name_submitted, 120);
  const available = Boolean(identity.id_document_url || identity.source === 'agent_on_file');
  const foundOnline = listingIsFoundOnline(row, extra);
  const seen = checklist?.identity_checked === true;
  const agentOnFile = identity.source === 'agent_on_file';
  return {
    applicable: !foundOnline,
    required: false,
    pending: !foundOnline && !seen && !agentOnFile,
    available,
    no_id_yet: !foundOnline && !available && !agentOnFile,
    source: identity.source || (identity.id_document_url ? 'upload' : (identity.pending ? 'pending' : '')),
    id_document_name: identity.id_document_name || '',
    id_document_kind: identity.id_document_kind || '',
    id_document_kind_label: HOST_ID_KINDS[identity.id_document_kind] || '',
    id_number: identity.id_number || '',
    host_name: hostName,
    name_match_instruction: nameMatchInstruction(hostName),
    identity_seen: seen
  };
}

async function logIdentityDocumentAccess(db, { listingId, actorId, actorRole, storage } = {}) {
  if (!db || !listingId) return;
  try {
    await db.query(
      `INSERT INTO st_listing_moderation_event
         (listing_id, actor_id, actor_role, action, notes)
       VALUES ($1::uuid, $2, $3, 'identity_document_accessed', $4)`,
      [
        listingId,
        actorId || actorRole || 'staff',
        actorRole || 'staff',
        storage ? `Short-lived host ID URL generated for staff review (${storage}).` : 'Short-lived host ID URL generated for staff review.'
      ]
    );
  } catch (_error) {
    // Viewing the ID should not fail because the audit row could not be written.
  }
}

async function buildStaffIdentityDocumentPayload(db, listingId, { actorId, actorRole = 'staff' } = {}) {
  const lookup = String(listingId || '').trim();
  if (!lookup) {
    const error = new Error('Unknown listing');
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `SELECT id, reference, host_name, extra_fields, moderation_checklist
       FROM st_listing
      WHERE id::text = $1
      LIMIT 1`,
    [lookup]
  );
  const row = result.rows[0];
  if (!row) {
    const error = new Error('Listing not found');
    error.status = 404;
    throw error;
  }

  const extra = parseExtraFields(row.extra_fields);
  const identity = extra.identity && typeof extra.identity === 'object' ? extra.identity : {};
  const summary = staffIdentitySummary(row, parseExtraFields(row.moderation_checklist));
  const rawUrl = clean(identity.id_document_url, 8000);
  if (!rawUrl) {
    return {
      ...summary,
      document: {
        available: false,
        url: '',
        signed_url: '',
        expires_at: null,
        expires_in_seconds: null,
        storage: identity.source === 'agent_on_file' ? 'agent_on_file_no_inline_photo' : 'missing'
      },
      note: identity.source === 'agent_on_file'
        ? 'This agent has an ID on file. Open their agent profile if the photo is not attached here.'
        : 'No ID document was uploaded with this short stay.'
    };
  }

  const viewed = viewableIdentityUrl(rawUrl, { expiresSeconds: 300 });
  const document = {
    available: viewed.available === true,
    url: viewed.url || '',
    signed_url: viewed.url || '',
    expires_at: viewed.expires_at || null,
    expires_in_seconds: viewed.available ? 300 : null,
    storage: viewed.storage || 'unsupported_reference'
  };

  await logIdentityDocumentAccess(db, {
    listingId: row.id,
    actorId,
    actorRole,
    storage: document.storage
  });

  return { ...summary, document };
}

const IDENTITY_TOKEN_MARKER = 'short-term-host-id-v1';
const IDENTITY_UPLOAD_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function identityError(message, status = 400, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = Array.isArray(details) ? details : [details];
  return error;
}

function identityTokenSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw identityError('ID uploads are unavailable because the server signing key is not configured.', 503);
  }
  return secret;
}

function signIdentityPayload(listingId, expiresAt) {
  return crypto
    .createHmac('sha256', identityTokenSecret())
    .update(`${IDENTITY_TOKEN_MARKER}:${listingId}:${expiresAt}`)
    .digest('base64url');
}

function createIdentityUploadToken(listingId, { ttlMs = IDENTITY_UPLOAD_TOKEN_TTL_MS } = {}) {
  const expiresAt = Date.now() + Math.max(60000, Number(ttlMs) || IDENTITY_UPLOAD_TOKEN_TTL_MS);
  return `${expiresAt}.${signIdentityPayload(listingId, expiresAt)}`;
}

function verifyIdentityUploadToken(listingId, token) {
  const raw = String(token || '').trim();
  const [expiresRaw, signature] = raw.split('.');
  const expiresAt = Number(expiresRaw);
  if (!listingId || !raw || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw identityError('This ID upload link has expired. Ask the Short stays desk for a new one.', 401);
  }
  const expected = signIdentityPayload(listingId, expiresAt);
  const left = Buffer.from(String(signature || ''));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw identityError('This ID upload link is not valid.', 401);
  }
  return { expiresAt };
}

function identityUploadPath(listingId, token) {
  if (!listingId || !token) return null;
  return `/list-property?type=short_stay&stid=${encodeURIComponent(listingId)}&t=${encodeURIComponent(token)}`;
}

async function identityUploadContext(db, listingId, token) {
  verifyIdentityUploadToken(listingId, token);
  const result = await db.query(
    `SELECT id, reference, title, area, district, host_name, extra_fields
       FROM st_listing
      WHERE id = $1::uuid
      LIMIT 1`,
    [listingId]
  );
  const row = result.rows[0];
  if (!row) throw identityError('Listing not found', 404);
  const extra = parseExtraFields(row.extra_fields);
  const identity = extra.identity && typeof extra.identity === 'object' ? extra.identity : {};
  return {
    ok: true,
    id: row.id,
    reference: row.reference || null,
    title: row.title || null,
    area: row.area || null,
    district: row.district || null,
    host_name: row.host_name || null,
    has_id_document: Boolean(identity.id_document_url || identity.source === 'agent_on_file')
  };
}

async function attachHostIdentity(db, listingId, payload = {}, { token } = {}) {
  verifyIdentityUploadToken(listingId, token);
  const validation = validateHostIdentity(payload, { required: true });
  if (!validation.ok) {
    throw identityError('That ID could not be saved', 400, validation.errors);
  }
  const result = await db.query(
    `SELECT id, reference, host_name, extra_fields
       FROM st_listing
      WHERE id = $1::uuid
      LIMIT 1`,
    [listingId]
  );
  const row = result.rows[0];
  if (!row) throw identityError('Listing not found', 404);
  const stored = await persistHostIdentity(validation.value, {
    reference: row.reference,
    hostName: row.host_name
  });
  await db.query(
    `UPDATE st_listing
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [listingId, JSON.stringify({ identity: stored })]
  );
  return {
    ok: true,
    reference: row.reference || null,
    has_id_document: Boolean(stored && stored.id_document_url)
  };
}

module.exports = {
  HOST_ID_KINDS,
  HOST_ID_MAX_BYTES,
  HOST_ID_PHOTO_MIMES,
  IDENTITY_TOKEN_MARKER,
  IDENTITY_UPLOAD_TOKEN_TTL_MS,
  attachHostIdentity,
  buildStaffIdentityDocumentPayload,
  createIdentityUploadToken,
  findVerifiedAgentIdentityOnFile,
  identityUploadContext,
  identityUploadPath,
  isAcceptedHostIdPhoto,
  isValidUgNinNumber,
  listingIsFoundOnline,
  nameMatchInstruction,
  persistHostIdentity,
  readHostIdentity,
  staffIdentitySummary,
  validateHostIdentity,
  verifyIdentityUploadToken
};
