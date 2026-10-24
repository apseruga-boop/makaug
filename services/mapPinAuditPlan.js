'use strict';

// Chooses a new map pin for every row in the 24 Oct 2026 pin audit.
// Labels are never changed. Rows touched by migrations 169 or 170 are left out.
// Every coordinate this returns is on Uganda's land.

const {
  canonicalLocationByKey,
  canonicalLocationOptions,
  canonicalizeUgandaLocation,
  normalizeLocationKey,
  resolveCanonicalUgandaLocationFromText
} = require('../utils/ugandaLocationRegistry');
const { isOnUgandaLand } = require('../utils/ugandaLand');

// Property ids in db/migrations/170_correct_remaining_mislabelled_listings.sql
// (open PR #538). Migration 169 is detected from the audit's m169 column.
const MIGRATION_170_IDS = new Set([
  '08f29aca-7e92-401f-ad90-f8636830e88c',
  '0e55db22-33bc-41fd-9374-ba8739a403c3',
  '15ca0488-2702-4a93-8dd8-c30225d65c8d',
  '18448dce-f5b9-4231-bbc2-117426aa327e',
  '1a49d9b1-ce66-484c-ae32-5060edf3ada0',
  '1f511792-551c-488d-bddf-461e86f13fd5',
  '25f945a9-b3f2-4f50-8240-23cde2391278',
  '28e43441-f002-49b3-a25b-e5ef8cfd2424',
  '2b251b80-bd25-471e-bbd0-f52673fcfac2',
  '31846e1b-167a-472b-b197-b16d48bed01b',
  '371eec61-47ca-4286-b7c3-2b0bf5768f42',
  '413be7b0-aa54-4bd2-9308-da70ee50e3ae',
  '42f256d4-24f7-4adb-82a0-7875caef88fc',
  '490d074e-5baa-4c32-9e75-435b9538fa05',
  '496006a9-d203-437c-a722-d99fe7d8df03',
  '50ce7080-6e74-454d-9deb-7686f08081af',
  '5649cd32-4d34-4fff-ba2a-d0c6d97c0e3b',
  '5c6d460a-4061-4c07-96e3-7dfc53839420',
  '5fb82c8f-2a2f-4187-8882-39525aea62ac',
  '6927c520-ca3f-4f45-8004-d562d119cac0',
  '6f7186ab-a57a-455f-83de-70ae756f24fb',
  '72ee6627-ba07-4f70-a596-c8c4edafdcec',
  '7316f714-29eb-46fe-8bb2-2752108eed61',
  '776cba37-0e45-49a4-b067-63819214ec7d',
  '7c066fe5-af0d-476c-8648-829e2291525d',
  '7ebdbf52-0ee2-4eb2-9491-0390dea64fc7',
  '7ed73e15-3da5-4211-94a9-a7b9d9b751e8',
  '8277cd47-12fe-4702-8d03-89539766fadb',
  '84967db4-d0e7-473b-a064-01e8c47b7f3a',
  '87543468-2976-49c0-9bbf-225432180011',
  '950e10f7-fc22-4ef6-9b88-d39dc825d2cb',
  'a37eb75e-0ce0-458a-b6a0-09dd5927fc22',
  'ac46726a-45c0-4afb-809b-5c37dc5c55cc',
  'ae6076d3-7a20-456f-9860-cd66c0118407',
  'bdaa51d9-1d39-41b1-81ba-6452616e626a',
  'bfbc521d-9f76-4caf-a30c-d8fedeb4cd78',
  'c25256a2-82e1-4668-8afc-48c4801d88d3',
  'c3499df6-955d-468d-93fd-1624500edf48',
  'c35a0d7e-6f89-4c56-bee3-a498ae7f0f22',
  'c67ee38a-dfb3-4e55-82d5-2b449ee39686',
  'c7c9e859-2c2a-429a-b565-3a27c4cc3d55',
  'c7cca0e9-d3df-4bdb-9399-236d489ccc18',
  'c892830b-90b8-4bb0-89ce-0200c5df8841',
  'c9ab858d-dcb5-4f05-bf62-86daa29b0721',
  'cd8525b6-c962-48a2-8505-6f7b09d71fd0',
  'd1cf79a4-f7b7-4c86-b538-0e25423a5da2',
  'df110660-9e03-4eeb-abc7-e40dafc14920',
  'df969b6a-ff97-4ba8-ab3c-c70c8b184465',
  'e8571cf2-c355-4d76-b377-a1941f0c7e55',
  'ed7f1715-91f2-43ce-8384-11c8e3865490',
  'f05f3a50-6786-43bd-a4d2-da6e8ba330b6',
  'f7266be0-21ff-424a-9d33-2a5522afc541'
]);

function num(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function samePoint(a, b) {
  if (!a || !b) return false;
  return Math.round(a.lat * 1e6) === Math.round(b.lat * 1e6)
    && Math.round(a.lng * 1e6) === Math.round(b.lng * 1e6);
}

function km(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function landPoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!isOnUgandaLand(lat, lng)) return null;
  return { lat, lng };
}

function coordOf(entry) {
  if (!entry) return null;
  return landPoint(Number(entry.lat ?? entry.latitude), Number(entry.lng ?? entry.longitude));
}

let aliasIndex = null;
function placesNamed(name) {
  if (!aliasIndex) {
    aliasIndex = new Map();
    for (const option of canonicalLocationOptions()) {
      const point = coordOf(option);
      for (const alias of [option.location, ...(option.aliases || [])]) {
        const key = normalizeLocationKey(alias);
        if (!key) continue;
        if (!aliasIndex.has(key)) aliasIndex.set(key, []);
        const list = aliasIndex.get(key);
        if (!list.some((item) => item.canonical_key === option.canonical_key)) {
          list.push({ ...option, point });
        }
      }
    }
  }
  return aliasIndex.get(normalizeLocationKey(name)) || [];
}

function parseStated(stated) {
  const parts = String(stated || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { area: '', district: '' };
  if (parts.length === 1) return { area: parts[0], district: parts[0] };
  return { area: parts[0], district: parts[parts.length - 1] };
}

function nearest(points, anchor) {
  const usable = points.filter((point) => point);
  if (!usable.length) return null;
  if (!anchor) return usable[0];
  return usable.slice().sort((a, b) => km(a, anchor) - km(b, anchor))[0];
}

function areaPoint(area, district, anchor) {
  const areaKey = normalizeLocationKey(area);
  const districtKey = normalizeLocationKey(district);
  if (!areaKey) return null;
  const canonical = canonicalizeUgandaLocation(area, district);
  if (canonical && !['district', 'region'].includes(canonical.level)) {
    const named = normalizeLocationKey(canonical.name) === areaKey
      || (canonical.aliases || []).some((alias) => normalizeLocationKey(alias) === areaKey);
    const point = named ? coordOf(canonical) : null;
    if (point) return point;
  }
  const matches = placesNamed(area).filter((entry) => entry.point && !['district', 'region'].includes(entry.level));
  const inDistrict = matches.filter((entry) => normalizeLocationKey(entry.district) === districtKey);
  if (inDistrict.length) return nearest(inDistrict.map((entry) => entry.point), anchor);
  if (anchor && matches.length) return nearest(matches.map((entry) => entry.point), anchor);
  return null;
}

function districtPoint(district) {
  const entry = canonicalizeUgandaLocation('', district);
  if (!entry || entry.level !== 'district') return null;
  return coordOf(entry);
}

function titlePoint(row, anchor) {
  const { district } = parseStated(row.stated_area);
  const resolution = resolveCanonicalUgandaLocationFromText(row.title || '', district);
  const match = resolution?.status === 'matched' ? resolution.match : null;
  return coordOf(match) || areaPoint(match?.name, match?.district || district, anchor);
}

function agentAnchors(rows) {
  const groups = new Map();
  for (const row of rows) {
    const agent = String(row.agent || '').trim();
    const point = landPoint(num(row.current_lat), num(row.current_lng));
    if (!agent || !point) continue;
    if (!groups.has(agent)) groups.set(agent, []);
    groups.get(agent).push({ id: row.id, ...point });
  }
  return groups;
}

function anchorFor(row, groups) {
  const list = (groups.get(String(row.agent || '').trim()) || []).filter((point) => point.id !== row.id);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  const lats = list.map((point) => point.lat).sort((a, b) => a - b);
  const lngs = list.map((point) => point.lng).sort((a, b) => a - b);
  return { lat: lats[mid], lng: lngs[mid] };
}

function planMapPinFixes(rows = []) {
  const anchors = agentAnchors(rows);
  const moves = [];
  const skipped = [];
  for (const row of rows) {
    const id = String(row.id || '').trim();
    const confidence = String(row.confidence || '').trim().toLowerCase() || 'none';
    const current = {
      lat: num(row.current_lat),
      lng: num(row.current_lng)
    };
    const hasCurrent = current.lat != null && current.lng != null;
    const base = { id, confidence, title: row.title || '', stated_area: row.stated_area || '' };
    if (String(row.m169 || '').trim()) {
      skipped.push({ ...base, reason: 'migration_169' });
      continue;
    }
    if (MIGRATION_170_IDS.has(id)) {
      skipped.push({ ...base, reason: 'migration_170' });
      continue;
    }
    const { area, district } = parseStated(row.stated_area);
    const anchor = anchorFor(row, anchors);
    const proposed = landPoint(num(row.proposed_lat), num(row.proposed_lng));
    const keepPin = /^keep pin\b/i.test(String(row.proposed_action || ''));
    let target = null;
    let source = '';
    if (keepPin) {
      // The pin is the right place and the area label is wrong. Leave the
      // label alone. Move the pin only when it is not already on land, and
      // then only to the place named in the title.
      if (hasCurrent && landPoint(current.lat, current.lng)) {
        skipped.push({ ...base, reason: 'label_left_pin_already_on_land' });
        continue;
      }
      target = titlePoint(row, anchor);
      source = 'title';
    }
    if (!target && proposed) {
      target = proposed;
      source = 'proposed';
    }
    if (!target) {
      const canonical = row.canonical_location_id ? canonicalLocationByKey(row.canonical_location_id) : null;
      const canonicalArea = canonical && !['district', 'region'].includes(canonical.level) ? coordOf(canonical) : null;
      target = canonicalArea || areaPoint(area, district, anchor);
      source = 'registry_area';
    }
    if (!target) {
      target = districtPoint(district);
      source = 'district_centre';
    }
    if (!target) {
      skipped.push({ ...base, reason: 'no_on_land_coordinate' });
      continue;
    }
    if (!isOnUgandaLand(target.lat, target.lng)) {
      skipped.push({ ...base, reason: 'target_failed_land_check' });
      continue;
    }
    if (hasCurrent && samePoint(current, target)) {
      skipped.push({ ...base, reason: keepPin ? 'label_left_pin_already_matches_title' : 'already_at_target' });
      continue;
    }
    moves.push({
      ...base,
      source,
      old_lat: hasCurrent ? current.lat : null,
      old_lng: hasCurrent ? current.lng : null,
      new_lat: target.lat,
      new_lng: target.lng
    });
  }
  moves.sort((a, b) => a.id.localeCompare(b.id));
  return { moves, skipped };
}

module.exports = {
  MIGRATION_170_IDS,
  planMapPinFixes,
  isOnUgandaLand
};
