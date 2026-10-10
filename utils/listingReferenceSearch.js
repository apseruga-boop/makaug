'use strict';

// MK-20261009-60823D searched with a leading-wildcard ILIKE across title,
// description and extra_fields, and the statement timed out (503). An exact
// reference uses the inquiry_reference index.

const LISTING_REFERENCE_RE = /^MK-[0-9A-Z-]{4,}$/i;

function listingReferenceQuery(term = '') {
  const clean = String(term || '').trim();
  return LISTING_REFERENCE_RE.test(clean) ? clean.toUpperCase() : '';
}

function propertyListingSearchClause(alias = 'p', term = '', values = []) {
  const reference = listingReferenceQuery(term);
  if (reference) {
    values.push(reference);
    return `${alias}.inquiry_reference = $${values.length}`;
  }
  values.push(`%${String(term || '').trim()}%`);
  const idx = values.length;
  return `(
    ${alias}.title ILIKE $${idx}
    OR ${alias}.area ILIKE $${idx}
    OR ${alias}.district ILIKE $${idx}
    OR COALESCE(${alias}.inquiry_reference, '') ILIKE $${idx}
    OR COALESCE(${alias}.lister_phone, '') ILIKE $${idx}
    OR COALESCE(${alias}.extra_fields->>'source_name', '') ILIKE $${idx}
    OR COALESCE(${alias}.extra_fields->>'source_platform', '') ILIKE $${idx}
  )`;
}

module.exports = {
  LISTING_REFERENCE_RE,
  listingReferenceQuery,
  propertyListingSearchClause
};
