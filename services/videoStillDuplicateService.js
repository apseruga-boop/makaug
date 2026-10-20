'use strict';

const crypto = require('crypto');

const STILL_SLOT_RE = /^(?:video_key_frame_|video_still_|video_recovery_still_)/i;
const MAX_STILLS = 24;
const MAX_BYTES = 12 * 1024 * 1024;

function planVideoStillCleanup(images = [], hashByUrl = {}) {
  const stills = (Array.isArray(images) ? images : []).filter((image) => STILL_SLOT_RE.test(String(image?.slot_key || '')));
  const groups = new Map();
  for (const image of stills) {
    const url = String(image?.url || '').trim();
    if (!url) continue;
    const hash = String(hashByUrl[url] || '').trim();
    const key = hash ? `hash:${hash}` : `url:${url}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
  }
  const keep = [];
  const remove = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => {
      const primary = Number(right.is_primary === true) - Number(left.is_primary === true);
      if (primary) return primary;
      const leftAt = Date.parse(left.created_at || '') || 0;
      const rightAt = Date.parse(right.created_at || '') || 0;
      if (leftAt && rightAt && leftAt !== rightAt) return leftAt - rightAt;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    });
    keep.push(sorted[0]);
    remove.push(...sorted.slice(1));
  }
  return { keep, remove };
}

async function sha256OfUrl(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response?.ok) return '';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return '';
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function dedupeListingVideoStills(db, propertyId, { actorId = 'staff', fetchImpl = fetch } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id, status, extra_fields
         FROM properties
        WHERE id = $1
        FOR UPDATE`,
      [propertyId]
    );
    const property = locked.rows[0];
    const status = String(property?.status || '').toLowerCase();
    if (!property || !['pending', 'approved', 'live', 'published'].includes(status)) {
      await client.query('ROLLBACK');
      return { ok: false, status: property ? 409 : 404, error: property ? 'Duplicate stills can only be removed while the listing is in review or live.' : 'Listing not found.' };
    }
    const images = await client.query(
      `SELECT id, url, is_primary, slot_key, sort_order, created_at
         FROM property_images
        WHERE property_id = $1
        ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [propertyId]
    );
    const stills = images.rows.filter((image) => STILL_SLOT_RE.test(String(image.slot_key || ''))).slice(0, MAX_STILLS);
    const extra = property.extra_fields && typeof property.extra_fields === 'object' ? property.extra_fields : {};
    const hashByUrl = {};
    for (const source of (Array.isArray(extra.video_still_sources) ? extra.video_still_sources : [])) {
      const url = String(source?.still_url || '').trim();
      const hash = String(source?.sha256 || '').trim();
      if (url && hash) hashByUrl[url] = hash;
    }
    for (const image of stills) {
      if (hashByUrl[image.url]) continue;
      const hash = await sha256OfUrl(image.url, fetchImpl).catch(() => '');
      if (hash) hashByUrl[image.url] = hash;
    }
    const plan = planVideoStillCleanup(stills, hashByUrl);
    if (!plan.remove.length) {
      await client.query('ROLLBACK');
      return { ok: true, removed: 0, status };
    }
    const removedUrls = new Set(plan.remove.map((image) => image.url));
    const removedIds = plan.remove.map((image) => image.id);
    await client.query('DELETE FROM property_images WHERE property_id = $1 AND id = ANY($2::uuid[])', [propertyId, removedIds]);
    const keptSources = (Array.isArray(extra.video_still_sources) ? extra.video_still_sources : []).filter((item) => item && !removedUrls.has(String(item.still_url || ''))).map((item) => ({
      ...item,
      sha256: item.sha256 || hashByUrl[String(item.still_url || '')] || null
    }));
    for (const image of plan.keep) {
      if (keptSources.some((item) => item.still_url === image.url)) continue;
      keptSources.push({
        still_url: image.url,
        source_video_url: null,
        sha256: hashByUrl[image.url] || null
      });
    }
    const nextExtra = {
      video_still_urls: [...new Set((Array.isArray(extra.video_still_urls) ? extra.video_still_urls : []).filter((url) => url && !removedUrls.has(String(url))))],
      video_still_sources: keptSources,
      media_sha256: [...new Set([
        ...(Array.isArray(extra.media_sha256) ? extra.media_sha256 : []),
        ...Object.values(hashByUrl).filter(Boolean)
      ])]
    };
    await client.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [propertyId, JSON.stringify(nextExtra)]
    );
    const primaryLeft = await client.query(
      `SELECT id FROM property_images WHERE property_id = $1 AND is_primary = TRUE LIMIT 1`,
      [propertyId]
    );
    if (!primaryLeft.rows.length && plan.keep[0]?.id) {
      await client.query('UPDATE property_images SET is_primary = TRUE WHERE id = $1 AND property_id = $2', [plan.keep[0].id, propertyId]);
    }
    await client.query(
      `INSERT INTO property_moderation_events
        (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1, $2, 'staff_video_still_duplicates_removed', $3, $3, $4, $5, $6::jsonb)`,
      [
        propertyId,
        String(actorId || 'staff'),
        status,
        'Duplicate video stills removed.',
        `${plan.remove.length} duplicate video still(s) removed. Listing status stayed ${status}.`,
        JSON.stringify({ removed: plan.remove.length, kept: plan.keep.length, removed_urls: [...removedUrls] })
      ]
    );
    await client.query('COMMIT');
    return { ok: true, removed: plan.remove.length, status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  planVideoStillCleanup,
  dedupeListingVideoStills
};
