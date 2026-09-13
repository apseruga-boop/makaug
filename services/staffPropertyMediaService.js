'use strict';

const db = require('../config/database');
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

module.exports = { changeStaffPropertyImage, withoutImageUrls };
