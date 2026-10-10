'use strict';

// Found-online listings never republish the source's media (TikTok covers,
// byteimg links, source_* slots, evidence cards): that rule stays. The one
// exception is photos staff uploaded from the review screen after ticking the
// owner/agent consent box (#377). Those are stored with slot_key 'staff_upload'
// on makaug's media host, and the upload also writes
// extra_fields.staff_image_upload / image_rights_confirmed. Only those photos are
// published for a found-online row, primary first.

const { realPhotoRejection } = require('./realListingPhoto');

const STAFF_UPLOAD_SLOT = 'staff_upload';
const SOURCE_MEDIA_URL_PATTERN = 'tiktokcdn|byteimg|tiktok\\.com';
const SOURCE_MEDIA_URL_RE = new RegExp(SOURCE_MEDIA_URL_PATTERN, 'i');

function asExtra(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return asExtra(JSON.parse(value)); } catch (_) { return {}; }
  }
  return {};
}

function truthy(value) {
  return value === true || ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

// The consent record the #377 upload writes on the listing.
function staffImageConsentGiven(extraFields) {
  const extra = asExtra(extraFields);
  return !!(extra.staff_image_upload && typeof extra.staff_image_upload === 'object') || truthy(extra.image_rights_confirmed);
}

function isConsentedStaffImage(image, extraFields) {
  if (!image || typeof image !== 'object') return false;
  if (String(image.slot_key || '').trim() !== STAFF_UPLOAD_SLOT) return false;
  const url = String(image.url || '').trim();
  if (!url || SOURCE_MEDIA_URL_RE.test(url)) return false;
  if (realPhotoRejection(image) !== null) return false;
  return staffImageConsentGiven(extraFields);
}

// Consented staff photos only, the stored primary first (else upload order),
// with is_primary set on exactly the first one.
function foundOnlinePublicImages(images = [], extraFields = {}) {
  const list = (Array.isArray(images) ? images : []).filter((image) => isConsentedStaffImage(image, extraFields));
  const primaryIndex = list.findIndex((image) => image.is_primary === true);
  const ordered = primaryIndex > 0 ? [list[primaryIndex], ...list.slice(0, primaryIndex), ...list.slice(primaryIndex + 1)] : list;
  return ordered.map((image, index) => ({ ...image, is_primary: index === 0 }));
}

// SQL twin for list queries: a LATERAL subquery that yields the first consented
// staff photo of the row `${alias}` as column url. The consent check reads the
// listing's own extra_fields through the image's property_id, so it works for
// any outer alias (properties p, or a CTE that only carries id).
function consentedStaffPrimaryImageLateralSql(alias = 'p') {
  return `LEFT JOIN LATERAL (
          SELECT si.url
          FROM property_images si
          JOIN properties sp ON sp.id = si.property_id
          WHERE si.property_id = ${alias}.id
            AND si.slot_key = '${STAFF_UPLOAD_SLOT}'
            AND si.url !~* '${SOURCE_MEDIA_URL_PATTERN}'
            AND (
              jsonb_typeof(sp.extra_fields->'staff_image_upload') = 'object'
              OR LOWER(COALESCE(sp.extra_fields->>'image_rights_confirmed', '')) IN ('true', '1', 'yes')
            )
          ORDER BY si.is_primary DESC, si.sort_order ASC, si.created_at ASC
          LIMIT 1
        ) staff_img ON true`;
}

// Public primary image for a list/card row that selected both
// primary_image_url and staff_primary_image_url.
function foundOnlinePrimaryImageUrl(row = {}) {
  const url = String(row?.staff_primary_image_url || '').trim();
  if (!url || SOURCE_MEDIA_URL_RE.test(url)) return null;
  return realPhotoRejection(url) === null ? url : null;
}

module.exports = {
  STAFF_UPLOAD_SLOT,
  staffImageConsentGiven,
  isConsentedStaffImage,
  foundOnlinePublicImages,
  consentedStaffPrimaryImageLateralSql,
  foundOnlinePrimaryImageUrl
};
