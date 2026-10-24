'use strict';

// MK-20261009-60823D searched with a leading-wildcard ILIKE across title,
// description and extra_fields, and the statement timed out (503). An exact
// reference uses the inquiry_reference index.
//
// Staff also paste the 6-character suffix (EFB4A3 from MK-20261016-EFB4A3)
// or the property id. Those are one listing, looked up directly. A 6-letter
// place such as Ntinda is not a suffix: the suffix is hex, the same alphabet
// buildListingReference uses.

const LISTING_REFERENCE_RE = /^MK-[0-9A-Z-]{4,}$/i;
const LISTING_REFERENCE_SUFFIX_RE = /^[0-9A-F]{6}$/i;
const PROPERTY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The first 8 hex digits are a UUID's time_low. A prefix uses the primary-key
// range, not id::text LIKE, which cannot use the uuid index. Six hex digits
// stay the MK suffix (EFB4A3), so a place name is still not an id.
const PROPERTY_ID_PREFIX_RE = /^[0-9a-f]{8}$/i;

function uuidPrefixBounds(prefix = '') {
  const hex = String(prefix || '').trim().toLowerCase();
  const start = `${hex}-0000-0000-0000-000000000000`;
  const next = parseInt(hex, 16) + 1;
  if (!Number.isFinite(next) || next > 0xffffffff) return { start, end: null };
  return { start, end: `${next.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000` };
}

function listingReferenceQuery(term = '') {
  const clean = String(term || '').trim();
  return LISTING_REFERENCE_RE.test(clean) ? clean.toUpperCase() : '';
}

function listingDirectLookup(term = '') {
  const clean = String(term || '').trim();
  if (!clean) return null;
  if (PROPERTY_ID_RE.test(clean)) return { kind: 'id', value: clean.toLowerCase() };
  const reference = listingReferenceQuery(clean);
  if (reference) return { kind: 'reference', value: reference };
  if (LISTING_REFERENCE_SUFFIX_RE.test(clean)) return { kind: 'suffix', value: clean.toUpperCase() };
  if (PROPERTY_ID_PREFIX_RE.test(clean)) return { kind: 'id_prefix', value: clean.toLowerCase() };
  return null;
}

function listingDirectLookupClause(alias = 'p', lookup = null, values = []) {
  if (!lookup || !Array.isArray(values)) return 'FALSE';
  if (lookup.kind === 'id') {
    values.push(lookup.value);
    return `${alias}.id = $${values.length}::uuid`;
  }
  if (lookup.kind === 'reference') {
    values.push(lookup.value);
    return `${alias}.inquiry_reference = $${values.length}`;
  }
  if (lookup.kind === 'suffix') {
    // MK-YYYYMMDD-SUFFIX. The date is eight characters, so the inquiry_reference
    // index can still range-scan the MK- prefix.
    values.push(`MK-________-${lookup.value}`);
    return `${alias}.inquiry_reference LIKE $${values.length}`;
  }
  if (lookup.kind === 'id_prefix') {
    const bounds = uuidPrefixBounds(lookup.value);
    values.push(bounds.start);
    if (!bounds.end) return `${alias}.id >= $${values.length}::uuid`;
    values.push(bounds.end);
    return `${alias}.id >= $${values.length - 1}::uuid AND ${alias}.id < $${values.length}::uuid`;
  }
  return 'FALSE';
}

function propertyListingSearchClause(alias = 'p', term = '', values = []) {
  const direct = listingDirectLookup(term);
  if (direct) return listingDirectLookupClause(alias, direct, values);
  const reference = listingReferenceQuery(term);
  if (reference) {
    values.push(reference);
    return `${alias}.inquiry_reference = $${values.length}`;
  }
  values.push(`%${String(term || '').trim()}%`);
  const idx = values.length;
  // These expressions are the ones indexed by 152_staff_review_search_trgm.sql.
  // COALESCE(...) would not match those gin_trgm indexes, and a leading-wildcard
  // ILIKE would fall back to a sequential scan of every pending and live row.
  // A NULL column does not match, the same as an empty string.
  return `(
    ${alias}.title ILIKE $${idx}
    OR ${alias}.area ILIKE $${idx}
    OR ${alias}.district ILIKE $${idx}
    OR ${alias}.inquiry_reference ILIKE $${idx}
    OR ${alias}.lister_phone ILIKE $${idx}
    OR (${alias}.extra_fields->>'source_name') ILIKE $${idx}
    OR (${alias}.extra_fields->>'source_platform') ILIKE $${idx}
  )`;
}

module.exports = {
  LISTING_REFERENCE_RE,
  LISTING_REFERENCE_SUFFIX_RE,
  PROPERTY_ID_PREFIX_RE,
  PROPERTY_ID_RE,
  listingDirectLookup,
  listingDirectLookupClause,
  listingReferenceQuery,
  propertyListingSearchClause,
  uuidPrefixBounds
};
