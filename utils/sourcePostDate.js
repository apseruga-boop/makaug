'use strict';

// "Posted on <platform> on" date that staff confirm for a found-online listing
// (C12, 10 Oct 2026, Fisher). Stored in extra_fields.source_published_at with
// source_post_date_status 'staff_confirmed' and high confidence.

const EARLIEST_SOURCE_POST_DATE = '2015-01-01';

// Today's date in Kampala (UTC+3), as YYYY-MM-DD.
function kampalaToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Validate a staff-entered post date (YYYY-MM-DD or an ISO timestamp).
 * Returns { ok: true, date, iso } or { ok: false, error }.
 */
function normalizeStaffSourcePostDate(value, { now = new Date() } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter the date the source post was published.' };
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { ok: false, error: 'The source post date must be a date (YYYY-MM-DD).' };
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T12:00:00+03:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { ok: false, error: 'The source post date is not a real date.' };
  }
  if (date > kampalaToday(now)) return { ok: false, error: 'The source post date cannot be in the future.' };
  if (date < EARLIEST_SOURCE_POST_DATE) return { ok: false, error: 'The source post date cannot be before 2015.' };
  // Noon in Kampala, so the date shows the same everywhere in Uganda and the UK.
  return { ok: true, date, iso: parsed.toISOString() };
}

// The extra_fields to save for a staff-confirmed post date.
function staffSourcePostDateExtra(normalized, { actorId = null, now = new Date() } = {}) {
  return {
    source_published_at: normalized.iso,
    first_posted_online_at: normalized.iso,
    source_published_label: null,
    first_posted_online_label: null,
    source_post_date_status: 'staff_confirmed',
    source_post_date_confidence: 'high_staff_confirmed',
    source_post_date_confirmed_by: actorId || null,
    source_post_date_confirmed_at: now.toISOString()
  };
}

module.exports = { EARLIEST_SOURCE_POST_DATE, kampalaToday, normalizeStaffSourcePostDate, staffSourcePostDateExtra };
