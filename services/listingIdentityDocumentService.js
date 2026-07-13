const { createSignedS3GetUrl } = require('./cloudMediaStorageService');

function cleanText(value = '') {
  return String(value == null ? '' : value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function safeJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function isOwnerWebsiteSubmission(listing = {}) {
  const extra = safeJsonObject(listing.extra_fields, {});
  const listerType = cleanText(listing.lister_type || extra.lister_type || extra.verify?.lister_type).toLowerCase();
  const listedVia = cleanText(listing.listed_via || listing.source || extra.listed_via || extra.submission_channel || extra.intake_channel).toLowerCase();
  const sourceUrl = firstNonEmpty(extra.source_url, extra.source_post_url, extra.tiktok_url, extra.youtube_url, listing.source_url);
  const ownerish = !listerType
    || ['owner', 'private', 'private_owner', 'private-owner', 'direct_owner', 'direct-owner'].includes(listerType);
  const websiteish = !listedVia
    || ['website', 'web', 'online', 'list_property_online', 'list-property-online', 'owner_submission'].includes(listedVia);
  return ownerish && websiteish && !sourceUrl;
}

function listingRequiresIdentityVerification(listing = {}) {
  const extra = safeJsonObject(listing.extra_fields, {});
  if (extra.identity_verification?.required === true) return true;
  if (extra.identity_verification?.verified === true) return false;
  return isOwnerWebsiteSubmission(listing)
    || !!firstNonEmpty(listing.id_number, extra.verify?.nin, extra.id_number)
    || !!firstNonEmpty(listing.id_document_url, extra.verify?.id_document_url);
}

function listingIdentitySummary(listing = {}) {
  const extra = safeJsonObject(listing.extra_fields, {});
  const idNumber = firstNonEmpty(listing.id_number, extra.verify?.nin, extra.id_number);
  const idDocumentUrl = firstNonEmpty(listing.id_document_url, extra.verify?.id_document_url);
  const idDocumentName = firstNonEmpty(listing.id_document_name, extra.verify?.id_document_name, 'National ID photo');
  return {
    property_id: listing.id || '',
    inquiry_reference: listing.inquiry_reference || '',
    id_number: idNumber,
    id_document_name: idDocumentName,
    has_id_document: !!idDocumentUrl,
    requires_identity_verification: listingRequiresIdentityVerification(listing),
    identity_verified: extra.identity_verification?.verified === true,
    identity_verified_at: extra.identity_verification?.verified_at || extra.identity_verified_at || null,
    identity_verified_by: extra.identity_verification?.verified_by || extra.identity_verified_by || null,
    lister: {
      name: listing.lister_name || extra.public_display_name || '',
      email: listing.lister_email || '',
      phone: listing.lister_phone || '',
      type: listing.lister_type || extra.lister_type || '',
      listed_via: listing.listed_via || listing.source || extra.listed_via || ''
    },
    submitted_at: listing.created_at || null
  };
}

async function loadListingIdentityRecord(db, propertyId) {
  const lookup = cleanText(propertyId);
  const result = await db.query(
    `SELECT id, inquiry_reference, title, lister_name, lister_phone, lister_email, lister_type,
            listed_via, source, id_number, id_document_name, id_document_url, extra_fields, created_at
     FROM properties
     WHERE id::text = $1 OR inquiry_reference = $1
     LIMIT 1`,
    [lookup]
  );
  return result.rows[0] || null;
}

async function logIdentityDocumentAccess(db, { propertyId, actorId, actorRole, source, delivery = {} } = {}) {
  try {
    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, notes, delivery)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        propertyId,
        actorId || actorRole || 'staff',
        'identity_document_accessed',
        'Short-lived National ID document URL generated for staff/King verification.',
        JSON.stringify({
          actor_role: actorRole || null,
          source: source || null,
          ...delivery
        })
      ]
    );
  } catch (_error) {
    // ID access must be auditable when the table is healthy, but a transient
    // audit write failure should not block a signed URL for an already-authed moderator.
  }
}

async function buildListingIdentityDocumentPayload(db, propertyId, { actorId, actorRole = 'staff', source = 'staff' } = {}) {
  const listing = await loadListingIdentityRecord(db, propertyId);
  if (!listing) {
    const error = new Error('Property not found');
    error.status = 404;
    throw error;
  }

  const summary = listingIdentitySummary(listing);
  const rawDocumentUrl = firstNonEmpty(listing.id_document_url, safeJsonObject(listing.extra_fields).verify?.id_document_url);
  if (!rawDocumentUrl) {
    return {
      ...summary,
      document: {
        available: false,
        url: '',
        signed_url: '',
        expires_at: null,
        expires_in_seconds: null,
        storage: 'missing'
      }
    };
  }

  let document;
  if (/^s3:\/\//i.test(rawDocumentUrl)) {
    const signed = createSignedS3GetUrl(rawDocumentUrl, { expiresSeconds: 300 });
    document = {
      available: true,
      url: signed.url,
      signed_url: signed.url,
      expires_at: signed.expiresAt,
      expires_in_seconds: signed.expiresSeconds,
      storage: 'private_s3'
    };
  } else if (/^data:image\//i.test(rawDocumentUrl)) {
    document = {
      available: true,
      url: rawDocumentUrl,
      signed_url: rawDocumentUrl,
      expires_at: null,
      expires_in_seconds: null,
      storage: 'inline_data_url'
    };
  } else {
    document = {
      available: false,
      url: '',
      signed_url: '',
      expires_at: null,
      expires_in_seconds: null,
      storage: 'unsupported_private_reference'
    };
  }

  await logIdentityDocumentAccess(db, {
    propertyId: listing.id,
    actorId,
    actorRole,
    source,
    delivery: {
      storage: document.storage,
      expires_at: document.expires_at,
      document_name: summary.id_document_name
    }
  });

  return {
    ...summary,
    document
  };
}

function buildIdentityVerificationExtra({ actorId, actorRole, verifiedAt = new Date().toISOString() } = {}) {
  return {
    identity_verification: {
      required: true,
      verified: true,
      id_document_clear_and_matches: true,
      verified_by: actorId || actorRole || 'staff',
      verified_at: verifiedAt
    },
    identity_verified_by: actorId || actorRole || 'staff',
    identity_verified_at: verifiedAt
  };
}

module.exports = {
  buildIdentityVerificationExtra,
  buildListingIdentityDocumentPayload,
  isOwnerWebsiteSubmission,
  listingIdentitySummary,
  listingRequiresIdentityVerification,
  loadListingIdentityRecord
};
