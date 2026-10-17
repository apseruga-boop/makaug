'use strict';

const db = require('../config/database');
const { realPhotoRejection, sameVideoUrl, VIDEO_STILL_SLOT_RE } = require('../utils/realListingPhoto');
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
  if (!confirmRights) throw mediaError(400, 'Confirm these are photos of this property, or frames captured from this listing\'s own source video, and we are allowed to use them.');
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

// Every http(s) video the staff preview lists, in the same order as the screen.
function collectListingVideoUrls(extra = {}, property = {}) {
  const fields = extra && typeof extra === 'object' ? extra : {};
  const tours = Array.isArray(fields.video_tours) ? fields.video_tours : [];
  const raw = [
    ...(Array.isArray(fields.video_urls) ? fields.video_urls : []),
    ...tours.map((item) => (item && typeof item === 'object' ? (item.url || item.video_url) : item)),
    property?.video_url,
    property?.youtube_url,
    property?.tiktok_url,
    fields.video_url,
    fields.youtube_url,
    fields.tiktok_url
  ];
  const seen = new Set();
  const urls = [];
  for (const value of raw) {
    const url = String(value || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.replace(/#.*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

// Drop one video from the listing fields. The file in storage is not touched.
function detachVideoFromExtra(extra = {}, videoUrl) {
  const fields = extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : {};
  const videoUrls = (Array.isArray(fields.video_urls) ? fields.video_urls : []).filter((url) => !sameVideoUrl(url, videoUrl));
  const tours = (Array.isArray(fields.video_tours) ? fields.video_tours : []).filter((item) => {
    const url = item && typeof item === 'object' ? (item.url || item.video_url) : item;
    return !sameVideoUrl(url, videoUrl);
  });
  const next = {
    ...fields,
    video_urls: videoUrls,
    video_tours: tours,
    video_url: sameVideoUrl(fields.video_url, videoUrl) ? null : (fields.video_url ?? null),
    youtube_url: sameVideoUrl(fields.youtube_url, videoUrl) ? null : (fields.youtube_url ?? null),
    tiktok_url: sameVideoUrl(fields.tiktok_url, videoUrl) ? null : (fields.tiktok_url ?? null)
  };
  const remaining = collectListingVideoUrls(next);
  if (!next.video_url && remaining[0]) next.video_url = remaining[0];
  next.video_count = remaining.length;
  return { extra: next, remaining };
}

function attributedStillUrls(extra = {}, videoUrl) {
  const urls = new Set();
  const stillList = Array.isArray(extra.video_still_urls) ? extra.video_still_urls : [];
  for (const item of (Array.isArray(extra.video_frame_quality) ? extra.video_frame_quality : [])) {
    if (!item || typeof item !== 'object' || !sameVideoUrl(item.source_video_url, videoUrl)) continue;
    const still = item.still_url || item.url;
    if (still) urls.add(String(still));
    else if (stillList[Number(item.frame) - 1]) urls.add(String(stillList[Number(item.frame) - 1]));
  }
  for (const item of (Array.isArray(extra.video_still_sources) ? extra.video_still_sources : [])) {
    if (item && sameVideoUrl(item.source_video_url, videoUrl) && item.still_url) urls.add(String(item.still_url));
  }
  return urls;
}

// Untagged stills are cleared only when they can only have come from this video:
// every recorded cover names this video, or it was the listing's only video.
function untaggedStillsBelongToVideo(extra = {}, events = [], videoUrl, remainingVideoCount = 0) {
  const quality = Array.isArray(extra.video_frame_quality) ? extra.video_frame_quality : [];
  const sources = Array.isArray(extra.video_still_sources) ? extra.video_still_sources : [];
  const tagged = quality.some((item) => item && item.source_video_url) || sources.some((item) => item && item.source_video_url);
  if (tagged) return false;
  const recorded = [];
  for (const event of events || []) {
    const delivery = event?.delivery && typeof event.delivery === 'object' ? event.delivery : event;
    const list = delivery?.source_videos;
    if (Array.isArray(list)) recorded.push(...list.filter(Boolean));
  }
  if (recorded.length) return recorded.every((url) => sameVideoUrl(url, videoUrl));
  return remainingVideoCount === 0;
}

function stripStillsForVideo(extra, videoUrl, removedStillUrls, { clearUntagged = false } = {}) {
  const dropStill = (url) => url && removedStillUrls.has(String(url));
  const quality = (Array.isArray(extra.video_frame_quality) ? extra.video_frame_quality : []).filter((item) => {
    if (clearUntagged) return false;
    if (!item || typeof item !== 'object') return false;
    if (sameVideoUrl(item.source_video_url, videoUrl)) return false;
    if (dropStill(item.still_url || item.url)) return false;
    return true;
  });
  const sources = (Array.isArray(extra.video_still_sources) ? extra.video_still_sources : []).filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (sameVideoUrl(item.source_video_url, videoUrl)) return false;
    if (dropStill(item.still_url)) return false;
    return true;
  });
  const stillUrls = (Array.isArray(extra.video_still_urls) ? extra.video_still_urls : []).filter((url) => url && !dropStill(url));
  return { ...extra, video_frame_quality: quality, video_still_sources: sources, video_still_urls: stillUrls };
}

// Detach one video from the listing. Stills made from it are removed from the
// listing. The video object in storage is left where it is.
async function removeStaffPropertyVideo({ propertyId, videoUrl, actorId, confirm = false }, database = db) {
  if (confirm !== true) throw mediaError(400, 'Confirm before removing a video from this listing.');
  const target = String(videoUrl || '').trim();
  if (!/^https?:\/\//i.test(target)) throw mediaError(400, 'Choose a video to remove.');
  const client = await database.getClient();
  try {
    await client.query('BEGIN');
    const property = (await client.query('SELECT id, extra_fields FROM properties WHERE id = $1 FOR UPDATE', [propertyId])).rows[0];
    if (!property) throw mediaError(404, 'Property not found');
    const extra = property.extra_fields || {};
    const attached = collectListingVideoUrls(extra, property);
    const match = attached.find((url) => sameVideoUrl(url, target));
    if (!match) throw mediaError(404, 'That video is not attached to this listing.');
    const events = (await client.query(
      `SELECT delivery FROM property_moderation_events
        WHERE property_id = $1
          AND action = ANY($2::text[])
        ORDER BY created_at ASC`,
      [propertyId, ['staff_video_cover_made', 'whatsapp_video_still_backfilled']]
    )).rows;
    const detached = detachVideoFromExtra(extra, match);
    const images = (await client.query(
      'SELECT * FROM property_images WHERE property_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at ASC, id ASC',
      [propertyId]
    )).rows;
    const attributed = attributedStillUrls(extra, match);
    const clearUntagged = untaggedStillsBelongToVideo(extra, events, match, detached.remaining.length);
    const doomed = images.filter((image) => {
      if (!VIDEO_STILL_SLOT_RE.test(String(image.slot_key || ''))) return false;
      if (attributed.has(image.url)) return true;
      return clearUntagged;
    });
    if (doomed.length) {
      await client.query(
        'DELETE FROM property_images WHERE property_id = $1 AND id = ANY($2::uuid[])',
        [propertyId, doomed.map((image) => image.id)]
      );
    }
    const kept = (await client.query(
      'SELECT * FROM property_images WHERE property_id = $1 ORDER BY is_primary DESC, sort_order ASC, created_at ASC, id ASC',
      [propertyId]
    )).rows;
    const publicImages = kept.filter((image) => !EVIDENCE_SLOTS.has(image.slot_key));
    const primaryId = publicImages[0]?.id || null;
    await client.query('UPDATE property_images SET is_primary = (id = $2::uuid) IS TRUE WHERE property_id = $1', [propertyId, primaryId]);
    kept.forEach((image) => { image.is_primary = image.id === primaryId; });
    const removedStillUrls = new Set(doomed.map((image) => image.url).filter(Boolean));
    const removedLog = Array.isArray(extra.staff_removed_videos) ? extra.staff_removed_videos : [];
    const stripped = stripStillsForVideo(
      withoutImageUrls(detached.extra, removedStillUrls),
      match,
      removedStillUrls,
      { clearUntagged }
    );
    const stillCount = kept.filter((image) => VIDEO_STILL_SLOT_RE.test(String(image.slot_key || ''))).length;
    const nextExtra = {
      ...stripped,
      staff_removed_videos: [...removedLog, {
        url: match,
        removed_at: new Date().toISOString(),
        removed_by: actorId || null,
        stills_cleared: doomed.length,
        storage_deleted: false
      }],
      staff_media_edited_at: new Date().toISOString(),
      public_image_count: publicImages.length,
      image_count: publicImages.length,
      primary_image_url: publicImages[0]?.url || null,
      video_key_frame_count: stillCount,
      video_count: detached.remaining.length
    };
    await client.query('UPDATE properties SET extra_fields = $2::jsonb, updated_at = NOW() WHERE id = $1', [propertyId, JSON.stringify(nextExtra)]);
    const delivery = {
      url: match,
      stills_cleared: doomed.length,
      still_urls: [...removedStillUrls],
      storage_deleted: false,
      videos_remaining: detached.remaining.length
    };
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, delivery)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [propertyId, actorId || null, 'staff_listing_video_removed',
        'Staff detached a video from this listing. The video file was left in storage.',
        JSON.stringify(delivery)]
    );
    await client.query('COMMIT');
    return {
      id: propertyId,
      images: kept,
      extra_fields: nextExtra,
      action: 'staff_listing_video_removed',
      removed_url: match,
      stills_cleared: doomed.length,
      storage_deleted: false
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  changeStaffPropertyImage,
  addStaffPropertyImages,
  removeStaffPropertyVideo,
  collectListingVideoUrls,
  detachVideoFromExtra,
  attributedStillUrls,
  untaggedStillsBelongToVideo,
  stripStillsForVideo,
  withoutImageUrls,
  STAFF_PHOTO_MAX_COUNT
};
