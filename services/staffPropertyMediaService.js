'use strict';

const db = require('../config/database');
const { realPhotoRejection } = require('../utils/realListingPhoto');
const EVIDENCE_SLOTS = new Set(['source_evidence_original', 'quarantined_source_evidence']);

// Remove stale thumbnail/gallery fallbacks as well as the property_images link.
function withoutImageUrls(value, removedUrls) {
  if (typeof value === 'string') return removedUrls.has(value) ? null : value;
  if (Array.isArray(value)) return value.map((item) => withoutImageUrls(item, removedUrls)).filter((item) => item !== null);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutImageUrls(item, removedUrls)]));
  }
  return value;
}

function mediaError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function changeStaffPropertyImage({ propertyId, imageId, actorId, restore = false }, database = db) {
  const client = await database.getClient();
  try {
    await client.query('BEGIN');
    const property = (await client.query('SELECT id, extra_fields FROM properties WHERE id = $1 FOR UPDATE', [propertyId])).rows[0];
    if (!property) throw mediaError(404, 'Property not found');
    const extra = property.extra_fields || {};
    let removed = Array.isArray(extra.staff_removed_images) ? extra.staff_removed_images : [];
    let affected;
    if (restore) {
      const entry = removed.find((item) => item.id === imageId);
      if (!entry) throw mediaError(404, 'Removed photo not found on this listing');
      affected = entry.images;
      for (const image of affected) {
        await client.query(
          `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key, room_label, created_at)
           VALUES ($1,$2,$3,false,$4,$5,$6,$7)`,
          [image.id, propertyId, image.url, image.sort_order, image.slot_key, image.room_label, image.created_at]
        );
      }
      removed = removed.filter((item) => item.id !== imageId);
    } else {
      const image = (await client.query('SELECT * FROM property_images WHERE property_id = $1 AND id = $2', [propertyId, imageId])).rows[0];
      if (!image) throw mediaError(404, 'Photo not found on this listing');
      affected = (await client.query('DELETE FROM property_images WHERE property_id = $1 AND url = $2 RETURNING *', [propertyId, image.url])).rows;
      removed = [...removed, { id: imageId, url: image.url, images: affected, removed_at: new Date().toISOString(), removed_by: actorId }];
    }
    const images = (await client.query(
      'SELECT * FROM property_images WHERE property_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at ASC, id ASC', [propertyId]
    )).rows;
    const publicImages = images.filter((image) => !EVIDENCE_SLOTS.has(image.slot_key));
    const primaryId = publicImages[0]?.id || null;
    await client.query('UPDATE property_images SET is_primary = (id = $2::uuid) IS TRUE WHERE property_id = $1', [propertyId, primaryId]);
    images.forEach((image) => { image.is_primary = image.id === primaryId; });
    const excluded = new Set(removed.map((item) => item.url));
    const { staff_removed_images: _removed, staff_removed_image_urls: _urls, ...currentExtra } = extra;
    const nextExtra = {
      ...withoutImageUrls(currentExtra, excluded),
      staff_removed_images: removed,
      staff_removed_image_urls: [...excluded],
      staff_media_edited_at: new Date().toISOString(),
      public_image_count: publicImages.length,
      image_count: publicImages.length,
      primary_image_url: publicImages[0]?.url || null
    };
    await client.query('UPDATE properties SET extra_fields = $2::jsonb, updated_at = NOW() WHERE id = $1', [propertyId, JSON.stringify(nextExtra)]);
    const action = restore ? 'staff_listing_photo_restored' : 'staff_listing_photo_removed';
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, delivery)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [propertyId, actorId, action, restore ? 'Staff restored listing photo' : 'Staff removed wrongly attributed or unwanted listing photo',
        JSON.stringify({ image_ids: affected.map((image) => image.id), public_image_count: publicImages.length })]
    );
    await client.query('COMMIT');
    return { id: propertyId, images, extra_fields: nextExtra, action };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const STAFF_PHOTO_MAX_COUNT = 12;
const STAFF_PHOTO_MAX_BYTES = 6 * 1024 * 1024;

function dataUrlBytes(value = '') {
  const match = String(value || '').match(/^data:[^,]+;base64,([a-z0-9+/=\s]+)$/i);
  return match ? Math.floor((match[1].replace(/\s+/g, '').length * 3) / 4) : 0;
}

// Reviewers add the property's own photos from the review screen. Each one is
// stored on makaug's media host first and only saved to the listing if the
// stored copy passes the same real-photo rule approval uses, so a failed
// upload can never leave a photo that approval then refuses.
async function addStaffPropertyImages({ propertyId, actorId, images = [], confirmRights = false }, database = db, deps = {}) {
  if (!confirmRights) throw mediaError(400, 'Confirm the listing owner or agent gave these photos for this listing before uploading.');
  const list = (Array.isArray(images) ? images : []).filter(Boolean);
  if (!list.length) throw mediaError(400, 'Choose at least one photo to upload.');
  if (list.length > STAFF_PHOTO_MAX_COUNT) throw mediaError(400, `Upload no more than ${STAFF_PHOTO_MAX_COUNT} photos at once.`);
  const uploads = list.map((item, index) => {
    const dataUrl = String(item?.data_url || item?.dataUrl || '').trim();
    if (!/^data:image\/(?:jpe?g|png|webp);base64,/i.test(dataUrl)) throw mediaError(400, 'Photos must be JPG, PNG or WebP images.');
    if (dataUrlBytes(dataUrl) > STAFF_PHOTO_MAX_BYTES) throw mediaError(400, 'A photo is too large; it must be 6MB or smaller after compression.');
    const label = String(item?.room_label || '').trim().slice(0, 120) || (index === 0 ? 'Property photo' : `Property photo ${index + 1}`);
    return { dataUrl, label };
  });
  const store = deps.store || require('./cloudMediaStorageService').prepareMediaUrlForStorage;
  const stored = [];
  for (const [index, upload] of uploads.entries()) {
    const url = await store(upload.dataUrl, {
      keyPrefix: `properties/${propertyId}/staff-images`,
      filename: `staff-photo-${index + 1}`,
      isPrivate: false,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: STAFF_PHOTO_MAX_BYTES,
      label: 'Staff listing photo'
    });
    const rejection = realPhotoRejection(url);
    if (rejection) {
      throw mediaError(502, 'The photo could not be saved to makaug media storage, so nothing was added. Try again in a minute; if it keeps failing, media storage needs checking.');
    }
    stored.push({ url, label: upload.label });
  }

  const client = await database.getClient();
  try {
    await client.query('BEGIN');
    const property = (await client.query('SELECT id, status, extra_fields FROM properties WHERE id = $1 FOR UPDATE', [propertyId])).rows[0];
    if (!property) throw mediaError(404, 'Property not found');
    const existing = (await client.query(
      `SELECT COUNT(*) FILTER (WHERE COALESCE(slot_key, '') NOT IN ('source_evidence_original', 'quarantined_source_evidence'))::int AS public_count,
              COALESCE(MAX(sort_order), -1)::int AS max_sort
         FROM property_images WHERE property_id = $1`, [propertyId]
    )).rows[0];
    let sort = Number(existing.max_sort) + 1;
    for (const image of stored) {
      await client.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1,$2,false,$3,'staff_upload',$4)`,
        [propertyId, image.url, sort, image.label]
      );
      sort += 1;
    }
    const images = (await client.query(
      'SELECT * FROM property_images WHERE property_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at ASC, id ASC', [propertyId]
    )).rows;
    const publicImages = images.filter((image) => !EVIDENCE_SLOTS.has(image.slot_key));
    // Keep an existing cover; a listing that had none gets the first upload.
    const primaryId = publicImages.find((image) => image.is_primary)?.id || publicImages[0]?.id || null;
    await client.query('UPDATE property_images SET is_primary = (id = $2::uuid) IS TRUE WHERE property_id = $1', [propertyId, primaryId]);
    images.forEach((image) => { image.is_primary = image.id === primaryId; });
    const extra = property.extra_fields || {};
    const nextExtra = {
      ...extra,
      image_rights_confirmed: true,
      staff_image_upload: { at: new Date().toISOString(), actor_id: actorId || null, image_count: stored.length },
      staff_media_edited_at: new Date().toISOString(),
      public_image_count: publicImages.length,
      image_count: publicImages.length,
      primary_image_url: (publicImages.find((image) => image.id === primaryId) || publicImages[0])?.url || null
    };
    // A "no usable property image" verdict from intake is out of date once
    // real photos are attached (same rule as the admin upload).
    if (nextExtra.media_validation_status === 'blocked_no_usable_property_image') {
      nextExtra.media_validation_status = 'passed_automated_image_gate';
    }
    await client.query('UPDATE properties SET extra_fields = $2::jsonb, updated_at = NOW() WHERE id = $1', [propertyId, JSON.stringify(nextExtra)]);
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, delivery)
       VALUES ($1,$2,'staff_listing_photos_uploaded',$3,$3,$4,$5::jsonb)`,
      [propertyId, actorId || null, property.status,
        'Reviewer confirmed photo rights and uploaded the property\'s photos.',
        JSON.stringify({ image_count: stored.length, public_image_count: publicImages.length, had_photos_before: Number(existing.public_count) > 0 })]
    );
    await client.query('COMMIT');
    return { id: propertyId, images, extra_fields: nextExtra, action: 'staff_listing_photos_uploaded', added: stored.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { changeStaffPropertyImage, addStaffPropertyImages, withoutImageUrls, STAFF_PHOTO_MAX_COUNT };
