'use strict';

// Listing map pins that don't match the listing's own area. A Matugga house
// pinned next to Mulago Hospital shows up in "near Mulago" searches and on the
// wrong part of the map. For each listing we compare the pin with the centre of
// its area (or district) and decide:
//   ok       – pin is where the listing says it is
//   relabel  – the pin is right but the area/district was recorded wrongly
//              (e.g. "Lugala, Buikwe" for a house pinned in Lugala, Kampala, or
//              a title that names the place the pin is in)
//   repin    – the area is right but the pin is not: move it to the area centre
//   review   – the title, the area and the pin disagree: left for staff
// Running it twice changes nothing the second time.

const {
  canonicalLocationByKey,
  canonicalLocationForRow,
  canonicalLocationOptions,
  canonicalizeUgandaLocation,
  canonicalLocationPinPoint,
  normalizeLocationKey,
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText
} = require('../utils/ugandaLocationRegistry');
const { isOnUgandaLand } = require('../utils/ugandaLand');

const AREA_LIMIT_KM = 8;
const GREATER_KAMPALA_AREA_LIMIT_KM = 5;
const DISTRICT_LIMIT_KM = 45;
const KAMPALA_DISTRICT_LIMIT_KM = 20;
const NEAR_PIN_KM = 3;
// Places a pin falls back to when nobody chose one (the middle of Uganda on the
// listing form's map).
const PLACEHOLDER_POINTS = [{ lat: 1.3733, lng: 32.2903 }];

function km(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointOf(entry) {
  if (!entry) return null;
  const lat = Number(entry.lat ?? entry.latitude);
  const lng = Number(entry.lng ?? entry.longitude);
  if (entry.lat === null && entry.latitude == null) return null;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function inUganda(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (Math.abs(p.lat) < 0.01 && Math.abs(p.lng) < 0.01) return false;
  return isOnUgandaLand(p.lat, p.lng);
}

function areaLimitKm(district) {
  return GREATER_KAMPALA.has(String(district || '').toLowerCase()) ? GREATER_KAMPALA_AREA_LIMIT_KM : AREA_LIMIT_KM;
}

let allNamedIndex = null;
// name → every registry place of that name, with or without coordinates
function allPlacesNamed(name) {
  if (!allNamedIndex) {
    allNamedIndex = new Map();
    for (const option of canonicalLocationOptions()) {
      for (const alias of [option.location, ...(option.aliases || [])]) {
        const key = normalizeLocationKey(alias);
        if (!key) continue;
        if (!allNamedIndex.has(key)) allNamedIndex.set(key, new Set());
        allNamedIndex.get(key).add(option.canonical_key);
      }
    }
  }
  return Array.from(allNamedIndex.get(normalizeLocationKey(name)) || []);
}

const GREATER_KAMPALA = new Set(['kampala', 'wakiso', 'mukono', 'mpigi']);

// "Plot on Hoima Road" names a road out of Kampala, not Hoima.
function titleForPlaceLookup(title = '') {
  return String(title || '').replace(/\b[A-Za-z]+(?:\s+[A-Za-z]+)?\s+(?:road|rd|highway|bypass|express(?:way)?)\b/gi, ' ');
}

let namedIndex = null;
// name → every registry place of that name that has coordinates
function placesNamed(name) {
  if (!namedIndex) {
    namedIndex = new Map();
    for (const option of canonicalLocationOptions()) {
      const point = pointOf(option);
      if (!point) continue;
      const entry = canonicalLocationByKey(option.canonical_key);
      if (!entry) continue;
      for (const alias of [option.location, ...(option.aliases || [])]) {
        const key = normalizeLocationKey(alias);
        if (!key) continue;
        if (!namedIndex.has(key)) namedIndex.set(key, []);
        const list = namedIndex.get(key);
        if (!list.some((item) => item.key === entry.key)) list.push(entry);
      }
    }
  }
  return namedIndex.get(normalizeLocationKey(name)) || [];
}

function districtLimitKm(district) {
  return String(district || '').toLowerCase() === 'kampala' ? KAMPALA_DISTRICT_LIMIT_KM : DISTRICT_LIMIT_KM;
}

/**
 * Decide what to do with one listing. `row` needs id, title, area, district,
 * latitude, longitude and extra_fields (canonical_location_id).
 */
function classifyListingLocation(row = {}) {
  const pin = { lat: Number(row.latitude), lng: Number(row.longitude) };
  if (row.latitude == null || row.longitude == null || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
    return { action: 'ok', reason: 'no_pin' };
  }
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  if (extra.coords_fix?.reviewed_ok === true) return { action: 'ok', reason: 'staff_confirmed' };

  const canonical = canonicalLocationForRow(row);
  const areaEntry = canonical && !['district', 'region'].includes(canonical.level) ? canonical : null;
  const areaPoint = pointOf(areaEntry);
  const districtName = canonical?.district || row.district;
  const districtEntry = districtName ? canonicalizeUgandaLocation('', districtName) : null;
  const districtPoint = pointOf(districtEntry);
  const ref = areaPoint
    ? { point: areaPoint, label: `${areaEntry.name}, ${areaEntry.district}`, limit: areaLimitKm(areaEntry.district), level: 'area' }
    : (districtPoint ? { point: districtPoint, label: districtEntry.name, limit: districtLimitKm(districtEntry.name), level: 'district' } : null);

  // A pin in the lake or outside the country is not a place. Try the same
  // point with the latitude sign flipped (a common typo that lands on the
  // opposite shore) and, if that is still off the land, the area centre.
  if (!inUganda(pin)) {
    const flipped = { lat: -pin.lat, lng: pin.lng };
    if (inUganda(flipped) && (!ref || km(flipped, ref.point) <= ref.limit)) {
      return {
        action: 'repin',
        reason: 'flipped_latitude',
        km: ref ? km(pin, ref.point) : null,
        from: ref ? ref.label : null,
        to_point: flipped,
        to_level: ref ? ref.level : 'pin'
      };
    }
    if (ref) {
      return {
        action: 'repin',
        reason: 'off_uganda_land',
        km: km(pin, ref.point),
        from: ref.label,
        to_point: ref.point,
        to_level: ref.level
      };
    }
    return { action: 'review', reason: 'off_uganda_land_no_reference' };
  }

  const placeholder = PLACEHOLDER_POINTS.some((p) => km(p, pin) < 0.3);
  if (!ref) return placeholder ? { action: 'review', reason: 'placeholder_pin_no_reference' } : { action: 'ok', reason: 'no_reference' };

  const distance = km(pin, ref.point);
  // Only the district is known and the pin is just its centre: right for
  // "in Kampala", but not a real spot for "near Mulago" searches.
  const districtOnly = ref.level === 'district';
  if (!placeholder && districtOnly && distance <= 1) return { action: 'ok', reason: 'district_centre_pin', km: distance, precision: 'district' };
  if (!placeholder && distance <= ref.limit) return { action: 'ok', reason: 'within_limit', km: distance };

  // The place the title names, if any.
  const titleResolution = row.title ? resolveCanonicalUgandaLocationFromText(titleForPlaceLookup(row.title)) : null;
  const titlePlace = titleResolution?.status === 'matched' ? titleResolution.match : null;

  if (!placeholder) {
    // 1. The pin is right and the area/district label is wrong: a place with the
    //    same name, or the place in the title, sits right where the pin is.
    const candidates = [
      ...(areaEntry ? placesNamed(areaEntry.name) : []),
      ...(row.area ? placesNamed(row.area) : []),
      ...(titlePlace && !['district', 'region'].includes(titlePlace.level) ? [titlePlace, ...placesNamed(titlePlace.name)] : [])
    ].filter((entry, index, list) => entry && list.findIndex((other) => other.key === entry.key) === index);
    const nearPin = candidates
      .map((entry) => ({ entry, d: pointOf(entry) ? km(pin, pointOf(entry)) : Infinity }))
      .filter((item) => item.d <= NEAR_PIN_KM && item.entry.key !== areaEntry?.key)
      .sort((a, b) => a.d - b.d)[0];
    if (nearPin) {
      return {
        action: 'relabel',
        reason: 'pin_matches_another_place_with_this_name_or_the_title',
        km: distance,
        from: ref.label,
        to: { key: nearPin.entry.key, name: nearPin.entry.name, district: nearPin.entry.district, level: nearPin.entry.level }
      };
    }
  }

  // 2. The title names a different place from the recorded area, and the pin
  //    is near neither: we can't tell which is right.
  if (titlePlace) {
    const titlePoint = pointOf(titlePlace);
    const recordedDistrict = String(areaEntry?.district || districtName || '').toLowerCase();
    const titleAgreesWithArea = (areaEntry
      ? (titlePlace.key === areaEntry.key || titlePlace.district === areaEntry.district || titlePlace.name === areaEntry.district)
      : (titlePlace.district === districtName || titlePlace.name === districtName))
      // "in Kampala" is used loosely for all of greater Kampala.
      || (String(titlePlace.name).toLowerCase() === 'kampala' && GREATER_KAMPALA.has(recordedDistrict));
    if (!placeholder && !titleAgreesWithArea && !(titlePoint && km(pin, titlePoint) <= (['district', 'region'].includes(titlePlace.level) ? districtLimitKm(titlePlace.name) : areaLimitKm(titlePlace.district)))) {
      return { action: 'review', reason: 'title_area_and_pin_disagree', km: distance, from: ref.label, title_place: `${titlePlace.name}${titlePlace.district && titlePlace.district !== titlePlace.name ? `, ${titlePlace.district}` : ''}` };
    }
  }

  // 3. A place name used in more than one district (Ndejje is in Wakiso and in
  //    Luwero): the pin may be right and only the district wrong. Leave it.
  //    Kampala's own neighbourhoods (Mengo, Muyenga…) are what people mean, so
  //    those are trusted.
  const placeName = areaEntry?.name || row.area || '';
  const trustedKampalaArea = ref.level === 'area' && String(areaEntry?.district || '').toLowerCase() === 'kampala';
  if (!placeholder && placeName && !trustedKampalaArea && allPlacesNamed(placeName).length > 1) {
    return { action: 'review', reason: 'place_name_used_in_several_districts', km: distance, from: ref.label };
  }

  // 4. The area is right, the pin is not: move the pin to the area centre.
  return {
    action: 'repin',
    reason: placeholder ? 'placeholder_pin' : `pin_${Math.round(distance)}km_from_${ref.level}`,
    km: distance,
    from: ref.label,
    to_point: ref.point,
    to_level: ref.level
  };
}

async function repairListingCoordinates(db, { apply = false, limit = 20000, statuses = ['approved', 'pending'], actor = 'system', logger = console } = {}) {
  // Only the few fields the check needs, a page at a time: extra_fields can be
  // large, and loading every listing's in one go is too much memory.
  const rows = [];
  let afterId = null;
  while (rows.length < limit) {
    const page = (await db.query(
      `SELECT id, title, area, district, latitude, longitude, status,
              jsonb_build_object(
                'canonical_location_id', extra_fields->>'canonical_location_id',
                'location_precision', extra_fields->>'location_precision',
                'coords_fix', jsonb_build_object('reviewed_ok', COALESCE((extra_fields->'coords_fix'->>'reviewed_ok')::boolean, false))
              ) AS extra_fields
         FROM properties
        WHERE status = ANY($1::text[])
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id
        LIMIT 500`,
      [statuses, afterId]
    )).rows;
    if (!page.length) break;
    rows.push(...page);
    afterId = page[page.length - 1].id;
    if (page.length < 500) break;
  }

  const summary = { checked: rows.length, ok: 0, relabel: 0, repin: 0, review: 0, applied: 0, district_only: 0, district_only_tagged: 0, samples: { relabel: [], repin: [], review: [] } };
  for (const row of rows) {
    const decision = classifyListingLocation(row);
    summary[decision.action] = (summary[decision.action] || 0) + 1;
    if (decision.precision === 'district') {
      summary.district_only += 1;
      if (apply && row.extra_fields?.location_precision !== 'district') {
        await db.query(
          `UPDATE properties
              SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('location_precision', 'district')
            WHERE id = $1`,
          [row.id]
        ).then(() => { summary.district_only_tagged += 1; }).catch(() => {});
      }
    }
    if (decision.action === 'ok') continue;
    const sample = { id: row.id, title: row.title, area: row.area, district: row.district, pin: [Number(row.latitude), Number(row.longitude)], ...decision };
    if (summary.samples[decision.action].length < 400) summary.samples[decision.action].push(sample);
    if (!apply) continue;
    const stamp = { action: decision.action, reason: decision.reason, at: new Date().toISOString(), by: actor, previous: { latitude: Number(row.latitude), longitude: Number(row.longitude), area: row.area, district: row.district, canonical_location_id: row.extra_fields?.canonical_location_id || null } };
    try {
      if (decision.action === 'repin') {
        await db.query(
          `UPDATE properties
              SET latitude = $2, longitude = $3,
                  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
                    'coords_fix', $4::jsonb,
                    'geocoding_provider', 'area_centre_fix',
                    'location_precision', CASE WHEN $5::text = 'district' THEN 'district' ELSE 'area' END,
                    'location_confidence', '0.4'),
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, decision.to_point.lat, decision.to_point.lng, JSON.stringify({ ...stamp, to: decision.from }), decision.to_level]
        );
        summary.applied += 1;
      } else if (decision.action === 'relabel') {
        const to = decision.to;
        await db.query(
          `UPDATE properties
              SET area = $2, district = $3,
                  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
                    'canonical_location_id', $4::text,
                    'canonical_location_level', $5::text,
                    'resolved_location_label', $6::text,
                    'coords_fix', $7::jsonb),
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, to.name, to.district, to.key, to.level, `${to.name}, ${to.district}`, JSON.stringify({ ...stamp, to: `${to.name}, ${to.district}` })]
        );
        summary.applied += 1;
      } else if (decision.action === 'review') {
        await db.query(
          `UPDATE properties
              SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('coords_fix', $2::jsonb),
                  updated_at = NOW()
            WHERE id = $1 AND COALESCE(extra_fields->'coords_fix'->>'action', '') <> 'review'`,
          [row.id, JSON.stringify({ ...stamp, needs_review: true, title_place: decision.title_place || null })]
        );
      }
    } catch (error) {
      logger?.warn?.('Listing coordinate repair failed:', row.id, error.message || String(error));
    }
  }
  return summary;
}

const NOT_AN_AREA = new Set(['district', 'region']);

/**
 * The centre of the listing's own area, for a listing that has no pin.
 * The area is the stored canonical place when that is an area, town or city;
 * otherwise the stored area name looked up inside the stored district
 * ("Kulambiro, Kampala" with no canonical id). A district-only or blank area
 * gives nothing: a district centre would claim a spot nobody chose.
 * Area centres include the borrowed OpenStreetMap points (PR #593).
 */
function areaCentreForUnpinnedListing({ area = '', district = '', extra_fields = {} } = {}) {
  const extra = extra_fields && typeof extra_fields === 'object' ? extra_fields : {};
  const districtKey = normalizeLocationKey(district);
  let entry = extra.canonical_location_id ? canonicalLocationByKey(extra.canonical_location_id) : null;
  if (entry && (NOT_AN_AREA.has(entry.level) || (districtKey && normalizeLocationKey(entry.district) !== districtKey))) entry = null;
  const areaText = String(area || '').trim();
  if (!entry && areaText) {
    const resolution = resolveCanonicalUgandaLocation(areaText, district);
    const match = resolution?.status === 'matched' && resolution.match ? canonicalLocationByKey(resolution.match.key) || resolution.match : null;
    if (match && !NOT_AN_AREA.has(match.level) && districtKey && normalizeLocationKey(match.district) === districtKey) entry = match;
  }
  if (!entry) return null;
  const centre = canonicalLocationPinPoint(entry);
  const point = centre ? { lat: Number(centre.lat), lng: Number(centre.lng) } : null;
  if (!point || !inUganda(point)) return null;
  return { entry, point };
}

const AUTO_PIN_NOTE = 'Auto-pinned at the area centre: the lister gave no pin. Approximate, not the exact address.';

/** extra_fields keys an auto-pin writes, with the previous values for undo. */
function autoPinExtraFields({ entry, point, extra_fields = {}, by = 'system', batch = null, at = new Date().toISOString() } = {}) {
  const extra = extra_fields && typeof extra_fields === 'object' ? extra_fields : {};
  return {
    location_precision: 'area',
    location_confidence: '0.4',
    geocoding_provider: 'area_centre_auto_pin',
    auto_pinned: true,
    auto_pin_note: AUTO_PIN_NOTE,
    coords_fix: {
      action: 'auto_pin',
      reason: 'missing_pin',
      at,
      by,
      ...(batch ? { batch } : {}),
      to: `${entry.name}, ${entry.district}`,
      to_key: entry.key,
      to_point: point ? { lat: point.lat, lng: point.lng } : null,
      previous: {
        latitude: null,
        longitude: null,
        location_precision: extra.location_precision ?? null,
        location_confidence: extra.location_confidence ?? null,
        geocoding_provider: extra.geocoding_provider ?? null,
        coords_fix: extra.coords_fix ?? null
      }
    }
  };
}

/**
 * Pin for a listing being approved without one, or null. Never pins from a
 * district-only or blank area.
 */
function autoPinForApproval({ area = '', district = '', latitude = null, longitude = null, extra_fields = {}, by = 'approval' } = {}) {
  const hasPin = latitude != null && longitude != null && latitude !== '' && longitude !== ''
    && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  if (hasPin) return null;
  const found = areaCentreForUnpinnedListing({ area, district, extra_fields });
  if (!found) return null;
  return {
    latitude: found.point.lat,
    longitude: found.point.lng,
    extra_fields_patch: autoPinExtraFields({ entry: found.entry, point: found.point, extra_fields, by })
  };
}

/**
 * One-off: give live listings that have no pin their area centre.
 * apply=false is a dry run. Each change keeps the previous (empty) pin in
 * extra_fields.coords_fix.previous and a batch id, so
 * rollbackAutoPinnedListings can undo exactly that batch.
 */
async function pinUnpinnedListings(db, { apply = false, limit = 20000, statuses = ['approved'], actor = 'system', batch = null, logger = console } = {}) {
  const runBatch = batch || `auto_pin_${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
  const rows = [];
  let afterId = null;
  while (rows.length < limit) {
    const page = (await db.query(
      `SELECT id, source, area, district, status,
              jsonb_build_object(
                'canonical_location_id', extra_fields->>'canonical_location_id',
                'location_precision', extra_fields->>'location_precision',
                'location_confidence', extra_fields->>'location_confidence',
                'geocoding_provider', extra_fields->>'geocoding_provider',
                'coords_fix', extra_fields->'coords_fix'
              ) AS extra_fields
         FROM properties
        WHERE status = ANY($1::text[])
          AND (latitude IS NULL OR longitude IS NULL)
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id
        LIMIT 500`,
      [statuses, afterId]
    )).rows;
    if (!page.length) break;
    rows.push(...page);
    afterId = page[page.length - 1].id;
    if (page.length < 500) break;
  }
  const summary = { apply, batch: runBatch, checked: rows.length, pinnable: 0, applied: 0, skipped: { district_only_or_blank: 0 }, by_source: {}, samples: [] };
  for (const row of rows.slice(0, limit)) {
    const found = areaCentreForUnpinnedListing(row);
    const source = row.source || 'unknown';
    summary.by_source[source] = summary.by_source[source] || { unpinned: 0, pinnable: 0 };
    summary.by_source[source].unpinned += 1;
    if (!found) { summary.skipped.district_only_or_blank += 1; continue; }
    summary.pinnable += 1;
    summary.by_source[source].pinnable += 1;
    const item = { id: row.id, source, area: row.area, district: row.district, to: `${found.entry.name}, ${found.entry.district}`, to_key: found.entry.key, latitude: found.point.lat, longitude: found.point.lng };
    if (summary.samples.length < 2000) summary.samples.push(item);
    if (!apply) continue;
    const patch = autoPinExtraFields({ entry: found.entry, point: found.point, extra_fields: row.extra_fields, by: actor, batch: runBatch });
    try {
      const result = await db.query(
        `UPDATE properties
            SET latitude = $2, longitude = $3,
                extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $4::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND latitude IS NULL AND longitude IS NULL`,
        [row.id, found.point.lat, found.point.lng, JSON.stringify(patch)]
      );
      summary.applied += result.rowCount || 0;
    } catch (error) {
      logger?.warn?.('Auto-pin failed:', row.id, error.message || String(error));
    }
  }
  return summary;
}

/**
 * Undo one auto-pin batch. Only rows still carrying that batch and still at
 * the pin it wrote are reset to no pin; a pin staff moved since is kept.
 */
async function rollbackAutoPinnedListings(db, { batch, apply = false } = {}) {
  if (!batch) throw new Error('batch is required');
  const where = `COALESCE(extra_fields->'coords_fix'->>'action', '') = 'auto_pin'
      AND extra_fields->'coords_fix'->>'batch' = $1
      AND round(latitude::numeric, 6) = round((extra_fields->'coords_fix'->'to_point'->>'lat')::numeric, 6)
      AND round(longitude::numeric, 6) = round((extra_fields->'coords_fix'->'to_point'->>'lng')::numeric, 6)`;
  if (!apply) {
    const count = (await db.query(`SELECT count(*)::int AS n FROM properties WHERE ${where}`, [batch])).rows[0]?.n || 0;
    return { apply, batch, matching: count, reverted: 0 };
  }
  const result = await db.query(
    `UPDATE properties
        SET latitude = NULL, longitude = NULL,
            extra_fields = (COALESCE(extra_fields, '{}'::jsonb)
                - 'auto_pinned' - 'auto_pin_note' - 'location_precision' - 'location_confidence' - 'geocoding_provider' - 'coords_fix')
              || jsonb_strip_nulls(jsonb_build_object(
                'location_precision', extra_fields->'coords_fix'->'previous'->'location_precision',
                'location_confidence', extra_fields->'coords_fix'->'previous'->'location_confidence',
                'geocoding_provider', extra_fields->'coords_fix'->'previous'->'geocoding_provider',
                'coords_fix', extra_fields->'coords_fix'->'previous'->'coords_fix')),
            updated_at = NOW()
      WHERE ${where}`,
    [batch]
  );
  return { apply, batch, reverted: result.rowCount || 0 };
}

/**
 * For a listing being saved: if its pin is clearly not in its own area, put it
 * at the area centre (and say so in extra_fields) before it reaches search.
 */
function correctedPinForNewListing({ title = '', area = '', district = '', latitude = null, longitude = null, extra_fields = {} } = {}) {
  const latNum = latitude == null || latitude === '' ? null : Number(latitude);
  const lngNum = longitude == null || longitude === '' ? null : Number(longitude);
  const hasPin = latNum != null && lngNum != null && Number.isFinite(latNum) && Number.isFinite(lngNum);
  if (!hasPin) {
    const found = areaCentreForUnpinnedListing({ area, district, extra_fields });
    if (!found) return null;
    return {
      latitude: found.point.lat,
      longitude: found.point.lng,
      coords_fix: {
        action: 'repin',
        reason: 'missing_pin',
        at: new Date().toISOString(),
        by: 'submission_check',
        previous: { latitude: null, longitude: null },
        to: `${found.entry.name}, ${found.entry.district}`
      }
    };
  }
  const decision = classifyListingLocation({ title, area, district, latitude, longitude, extra_fields });
  if (decision.action !== 'repin') return null;
  return {
    latitude: decision.to_point.lat,
    longitude: decision.to_point.lng,
    coords_fix: { action: 'repin', reason: decision.reason, at: new Date().toISOString(), by: 'submission_check', previous: { latitude: Number(latitude), longitude: Number(longitude) }, to: decision.from }
  };
}

module.exports = {
  AUTO_PIN_NOTE,
  areaCentreForUnpinnedListing,
  autoPinForApproval,
  classifyListingLocation,
  correctedPinForNewListing,
  pinUnpinnedListings,
  rollbackAutoPinnedListings,
  repairListingCoordinates,
  _km: km
};
