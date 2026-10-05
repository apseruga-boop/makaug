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
  normalizeLocationKey,
  resolveCanonicalUgandaLocationFromText
} = require('../utils/ugandaLocationRegistry');

const AREA_LIMIT_KM = 8;
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
  return p && p.lat > -1.6 && p.lat < 4.4 && p.lng > 29.4 && p.lng < 35.2 && !(Math.abs(p.lat) < 0.01 && Math.abs(p.lng) < 0.01);
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
    ? { point: areaPoint, label: `${areaEntry.name}, ${areaEntry.district}`, limit: AREA_LIMIT_KM, level: 'area' }
    : (districtPoint ? { point: districtPoint, label: districtEntry.name, limit: districtLimitKm(districtEntry.name), level: 'district' } : null);

  const placeholder = !inUganda(pin) || PLACEHOLDER_POINTS.some((p) => km(p, pin) < 0.3);
  if (!ref) return placeholder ? { action: 'review', reason: 'placeholder_pin_no_reference' } : { action: 'ok', reason: 'no_reference' };

  const distance = km(pin, ref.point);
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
    if (!placeholder && !titleAgreesWithArea && !(titlePoint && km(pin, titlePoint) <= (['district', 'region'].includes(titlePlace.level) ? districtLimitKm(titlePlace.name) : AREA_LIMIT_KM))) {
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
  const rows = (await db.query(
    `SELECT id, title, area, district, latitude, longitude, extra_fields, status
       FROM properties
      WHERE status = ANY($1::text[])
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [statuses, limit]
  )).rows;

  const summary = { checked: rows.length, ok: 0, relabel: 0, repin: 0, review: 0, applied: 0, samples: { relabel: [], repin: [], review: [] } };
  for (const row of rows) {
    const decision = classifyListingLocation(row);
    summary[decision.action] = (summary[decision.action] || 0) + 1;
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
                    'location_confidence', '0.4'),
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, decision.to_point.lat, decision.to_point.lng, JSON.stringify({ ...stamp, to: decision.from })]
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

/**
 * For a listing being saved: if its pin is clearly not in its own area, put it
 * at the area centre (and say so in extra_fields) before it reaches search.
 */
function correctedPinForNewListing({ title = '', area = '', district = '', latitude = null, longitude = null, extra_fields = {} } = {}) {
  const decision = classifyListingLocation({ title, area, district, latitude, longitude, extra_fields });
  if (decision.action !== 'repin') return null;
  return {
    latitude: decision.to_point.lat,
    longitude: decision.to_point.lng,
    coords_fix: { action: 'repin', reason: decision.reason, at: new Date().toISOString(), by: 'submission_check', previous: { latitude: Number(latitude), longitude: Number(longitude) }, to: decision.from }
  };
}

module.exports = {
  classifyListingLocation,
  correctedPinForNewListing,
  repairListingCoordinates,
  _km: km
};
