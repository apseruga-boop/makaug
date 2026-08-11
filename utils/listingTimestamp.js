'use strict';

const EXPLICIT_LISTING_TIMESTAMP_FIELDS = new Set([
  'available_from',
  'availability_date',
  'price_fx_as_of'
]);
const LISTING_EXTRA_TIMESTAMP_FIELDS = new Set([
  'available_from',
  'availability_date',
  'availability_at',
  'posted_at',
  'first_posted_at',
  'first_posted_online_at',
  'source_published_at',
  'video_published_at',
  'video_posted_at',
  'platform_posted_at',
  'original_posted_at',
  'source_posted_at',
  'first_seen_online_at',
  'source_first_seen_at',
  'sourced_at'
]);

function isListingTimestampField(field = '') {
  const key = String(field || '').trim();
  return Boolean(key) && (key.endsWith('_at') || EXPLICIT_LISTING_TIMESTAMP_FIELDS.has(key));
}

function invalidListingTimestamp(field) {
  const error = new Error(`${field} is not a valid date`);
  error.name = 'InvalidListingTimestampError';
  error.code = 'INVALID_LISTING_TIMESTAMP';
  error.status = 400;
  error.field = field;
  error.details = [`${field} is not a valid date`];
  return error;
}

function normalizeListingTimestampValue(value, field = 'timestamp') {
  if (value == null || value === '') return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw invalidListingTimestamp(field);
  return parsed.toISOString();
}

function normalizeListingTimestampFields(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const normalized = { ...patch };
  Object.keys(normalized).forEach((field) => {
    if (!isListingTimestampField(field)) return;
    normalized[field] = normalizeListingTimestampValue(normalized[field], field);
  });
  return normalized;
}

module.exports = {
  EXPLICIT_LISTING_TIMESTAMP_FIELDS,
  LISTING_EXTRA_TIMESTAMP_FIELDS,
  isListingTimestampField,
  normalizeListingTimestampFields,
  normalizeListingTimestampValue
};
