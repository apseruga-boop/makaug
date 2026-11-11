'use strict';

// Two-gate review for Short Term listings.
//
// This mirrors the properties pipeline in migration 018 and routes/admin.js:
// a listing is screened by a staff moderator, and only then goes to King
// review for the final call.
//
// The rule that matters, stated once and enforced in three places:
//
//   A STAFF MODERATOR CANNOT PUBLISH A LISTING.
//
// The furthest a moderator can move something is into king_review. Only the
// King stage sets king_facts_confirmed, and the public query in
// shortTermService.js requires that column to be TRUE. So publication needs
// two different people with two different roles, and no amount of clicking in
// the staff queue can shortcut it.

const logger = require('../config/logger');
const { usableShortStayPhotoCount } = require('../utils/staffSourceMedia');

const SHORT_TERM_MODERATION_MARKER = 'short-term-two-gate-review-v1';

// ---------------------------------------------------------------------------
// The checklist
// ---------------------------------------------------------------------------

// Overrideable checks can be waived by the King with a reason. The rest
// cannot be waived by anybody.
const REVIEW_CHECKS = Object.freeze([
  { key: 'required_listing_fields', label: 'Title, description, district and area complete' },
  { key: 'contact_details_verified', label: 'Host phone reachable and answered' },
  { key: 'right_to_let_confirmed', label: 'Host confirmed the right to let this place out' },
  { key: 'identity_checked', label: 'ID seen — name on the ID matches the host name', overrideable: true },
  { key: 'photos_present', label: 'Photos uploaded' },
  { key: 'photos_match_property', label: 'Photos are of this property, not stock or stolen' },
  { key: 'location_verified', label: 'Area and map pin are real and correct' },
  { key: 'pricing_checked', label: 'Nightly price is sane for the area' },
  { key: 'house_rules_and_terms', label: 'House rules and host terms readable' },
  { key: 'availability_published', label: 'Availability published or host asked to be contacted', overrideable: true },
  { key: 'duplicate_checked', label: 'Not already listed on makaug', overrideable: true }
]);

const REVIEW_CHECK_KEYS = REVIEW_CHECKS.map((item) => item.key);
const OVERRIDEABLE_CHECK_KEYS = REVIEW_CHECKS.filter((item) => item.overrideable).map((item) => item.key);

// The King stage has one extra requirement of its own, and it is not
// something the automated pass can ever tick.
const KING_CONFIRMATION_KEY = 'king_facts_confirmed';

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

const STAGES = Object.freeze({
  draft: 'Draft',
  submitted: 'Submitted',
  staff_review: 'With a moderator',
  king_review: 'With the King',
  changes_requested: 'Changes requested from the host',
  approved: 'Approved and live',
  rejected: 'Rejected',
  suspended: 'Suspended'
});

// What a staff moderator is allowed to do. Note what is absent: there is no
// path from any staff action to 'approved'.
// Arthur, 10 Nov 2026: a moderator's Approve puts a short stay live straight
// away, on the same rules as main listings. The King keeps Reject and Suspend.
const STAFF_ACTIONS = Object.freeze({
  approve: { to: 'approved', from: ['submitted', 'staff_review', 'changes_requested', 'king_review'] },
  claim: { to: 'staff_review', from: ['submitted', 'staff_review', 'changes_requested', 'rejected'] },
  pass_to_king: { to: 'king_review', from: ['submitted', 'staff_review', 'changes_requested'] },
  request_changes: { to: 'changes_requested', from: ['submitted', 'staff_review', 'king_review'] },
  reject: { to: 'rejected', from: ['submitted', 'staff_review', 'changes_requested'] }
});

// What the King is allowed to do. Only this table contains 'approved'.
const KING_ACTIONS = Object.freeze({
  approve: { to: 'approved', from: ['king_review'] },
  reject: { to: 'rejected', from: ['king_review', 'approved'] },
  send_back: { to: 'staff_review', from: ['king_review'] },
  suspend: { to: 'suspended', from: ['approved', 'king_review'] }
});

function staffCanReachApproved() {
  return Object.values(STAFF_ACTIONS).some((action) => action.to === 'approved');
}

// Found-online short stays are stored with do_not_message. The desk may show
// and correct them. It must not offer a message, a pay link, or WhatsApp.
function listingDoNotMessage(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (row.source === 'imported' || row.found_online_label) return true;
  const raw = row.do_not_message;
  if (raw === true || raw === 't' || raw === 'true' || raw === '1' || raw === 'yes') return true;
  let extra = row.extra_fields;
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra); } catch (_) { extra = null; }
  }
  if (!extra || typeof extra !== 'object') return false;
  if (extra.found_online_label) return true;
  const nested = extra.do_not_message;
  return nested === true || nested === 't' || nested === 'true' || nested === '1' || nested === 'yes';
}

const FACT_TEXT = Object.freeze({
  title: { min: 3, max: 300, required: true },
  description: { min: 0, max: 8000 },
  district: { min: 1, max: 80, required: true },
  area: { min: 1, max: 80, required: true },
  address: { min: 0, max: 200 },
  property_type: { min: 0, max: 80 },
  host_name: { min: 1, max: 120, required: true },
  host_phone: { min: 0, max: 30 },
  house_rules: { min: 0, max: 4000 }
});

const FACT_INTS = Object.freeze({
  bedrooms: { min: 0, max: 30 },
  beds: { min: 0, max: 40 },
  bathrooms: { min: 0, max: 30 },
  max_guests: { min: 1, max: 50 },
  base_nightly_ugx: { min: 0, max: 500000000 },
  cleaning_fee_ugx: { min: 0, max: 500000000 },
  min_nights: { min: 1, max: 90 }
});

function cleanFactText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanFactMultiline(value, max) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

/**
 * Facts a moderator can correct on a short stay before approving or rejecting.
 * Publishing stays with the King. This does not touch contact actions.
 */
function parseListingFacts(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const errors = [];
  const value = {};

  for (const [key, rule] of Object.entries(FACT_TEXT)) {
    if (source[key] === undefined && !rule.required) continue;
    const text = key === 'description' || key === 'house_rules'
      ? cleanFactMultiline(source[key], rule.max)
      : cleanFactText(source[key], rule.max);
    if (rule.required && text.length < rule.min) errors.push(`${key} is required`);
    else if (text && text.length < rule.min) errors.push(`${key} is too short`);
    else value[key] = text || null;
    if (rule.required) value[key] = text;
  }

  if (source.place_type !== undefined || source.place_type === undefined) {
    const place = cleanFactText(source.place_type || 'entire_place', 40);
    if (!['entire_place', 'private_room', 'shared_room'].includes(place)) {
      errors.push('place_type must be entire_place, private_room or shared_room');
    } else {
      value.place_type = place;
    }
  }

  // Price: blank, 0 or "POA" shows POA (Arthur, 9 Nov 2026); a real number
  // shows that number. Not sent at all leaves the price as it is.
  value.price_mode = null;
  if (source.base_nightly_ugx !== undefined) {
    const raw = String(source.base_nightly_ugx == null ? '' : source.base_nightly_ugx).replace(/[,\s]/g, '');
    if (raw === '' || /^poa$/i.test(raw) || Number(raw) === 0) {
      value.price_mode = 'poa';
      source.base_nightly_ugx = '';
    } else if (Number(raw) > 0) {
      value.price_mode = 'price';
      source.base_nightly_ugx = raw;
    }
  }

  for (const [key, rule] of Object.entries(FACT_INTS)) {
    // Unknown is allowed (Arthur, 10 Nov 2026): a blank number keeps what the
    // listing already has instead of blocking the save.
    if (source[key] === undefined || source[key] === null || String(source[key]).trim() === '') {
      value[key] = null;
      continue;
    }
    const number = Number(source[key]);
    if (!Number.isFinite(number) || Math.round(number) !== number && String(source[key]).includes('.')) {
      errors.push(`${key} must be a whole number`);
      continue;
    }
    const whole = Math.round(number);
    if (whole < rule.min || whole > rule.max) errors.push(`${key} is out of range`);
    else value[key] = whole;
  }

  return { ok: errors.length === 0, errors, value };
}

async function updateListingFacts(db, listingId, body, actor = {}) {
  const parsed = parseListingFacts(body);
  if (!parsed.ok) throw moderationError('These facts are not valid.', 400, parsed.errors);
  const value = parsed.value;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id, moderation_stage, moderation_checklist
       FROM st_listing WHERE id = $1::uuid FOR UPDATE`,
      [listingId]
    );
    if (!current.rows.length) throw moderationError('That listing no longer exists.', 404);
    const updated = await client.query(
      `UPDATE st_listing
       SET title = $2,
           description = $3,
           district = $4,
           area = $5,
           address = $6,
           property_type = $7,
           place_type = $8,
           bedrooms = COALESCE($9::int, bedrooms),
           beds = COALESCE($10::int, beds),
           bathrooms = COALESCE($11::int, bathrooms),
           max_guests = COALESCE($12::int, max_guests),
           base_nightly_ugx = COALESCE($13::bigint, base_nightly_ugx),
           cleaning_fee_ugx = COALESCE($14::bigint, cleaning_fee_ugx),
           min_nights = COALESCE($15::int, min_nights),
           host_name = $16,
           host_phone = $17,
           house_rules = $18,
           extra_fields = CASE
             WHEN $19::text = 'poa' THEN COALESCE(extra_fields, '{}'::jsonb) || '{"price_on_application": true}'::jsonb
             WHEN $19::text = 'price' THEN COALESCE(extra_fields, '{}'::jsonb) || '{"price_on_application": false}'::jsonb
             ELSE extra_fields
           END
       WHERE id = $1::uuid
       RETURNING id, reference, title, description, district, area, address, property_type, place_type,
                 bedrooms, beds, bathrooms, max_guests, base_nightly_ugx, cleaning_fee_ugx, min_nights,
                 host_name, host_phone, house_rules, moderation_stage, do_not_message, extra_fields`,
      [
        listingId,
        value.title,
        value.description || '',
        value.district,
        value.area,
        value.address,
        value.property_type,
        value.place_type,
        value.bedrooms,
        value.beds,
        value.bathrooms,
        value.max_guests,
        value.base_nightly_ugx,
        value.cleaning_fee_ugx,
        value.min_nights,
        value.host_name,
        value.host_phone || '',
        value.house_rules,
        value.price_mode
      ]
    );
    await recordEvent(client, listingId, {
      actorId: actor.userId || 'staff',
      actorRole: actor.role || 'moderator',
      action: 'staff:edit_facts',
      stageFrom: current.rows[0].moderation_stage,
      stageTo: current.rows[0].moderation_stage,
      checklist: normalizeChecklist(current.rows[0].moderation_checklist),
      notes: 'Facts corrected on the short stays desk'
    });
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function moderationError(message, status = 400, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = Array.isArray(details) ? details : [details];
  return error;
}

// ---------------------------------------------------------------------------
// Checklist handling
// ---------------------------------------------------------------------------

function normalizeChecklist(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of REVIEW_CHECK_KEYS) {
    const value = source[key];
    out[key] = value === true || value === 'true' || value === 'pass';
  }
  out[KING_CONFIRMATION_KEY] = source[KING_CONFIRMATION_KEY] === true
    || source[KING_CONFIRMATION_KEY] === 'true';
  if (source.overrides && typeof source.overrides === 'object') {
    out.overrides = {};
    for (const key of OVERRIDEABLE_CHECK_KEYS) {
      const reason = String(source.overrides[key] || '').trim().slice(0, 300);
      if (reason) out.overrides[key] = reason;
    }
  }
  return out;
}

/**
 * Ticks the boxes a machine can honestly tick, and leaves every judgement
 * call to a person. "Photos are of this property" is not something code can
 * know, so code does not pretend to.
 */
function buildAutomatedChecklist(listing = {}, { photoCount = 0 } = {}) {
  const hasFields = Boolean(
    String(listing.title || '').trim().length >= 8
    && String(listing.description || '').trim().length >= 40
    && String(listing.district || '').trim()
    && String(listing.area || '').trim()
  );
  return normalizeChecklist({
    required_listing_fields: hasFields,
    right_to_let_confirmed: listing.right_to_let_declared === true,
    photos_present: Number(photoCount) > 0,
    pricing_checked: Number(listing.base_nightly_ugx || 0) > 0,
    house_rules_and_terms: Boolean(String(listing.house_rules || '').trim() || String(listing.terms_text || '').trim())
  });
}

/**
 * Which checks are still outstanding. An overrideable check counts as settled
 * when the King has written a reason for waiving it.
 */
function missingChecks(checklist = {}) {
  const normalized = normalizeChecklist(checklist);
  const overrides = normalized.overrides || {};
  return REVIEW_CHECKS
    .filter((check) => {
      if (normalized[check.key] === true) return false;
      if (check.overrideable && overrides[check.key]) return false;
      return true;
    })
    .map((check) => ({ key: check.key, label: check.label, overrideable: Boolean(check.overrideable) }));
}

function approvalBlockingChecks(checklist = {}) {
  // Arthur, 10 Nov 2026: hosts may submit and pay without an ID. The listing
  // can go live with "ID still pending". Staff still tick ID seen when they
  // have checked a document, but that tick must not block approval.
  return missingChecks(checklist).filter((check) => check.key !== 'identity_checked');
}

function canApprove(checklist = {}) {
  const normalized = normalizeChecklist(checklist);
  if (normalized[KING_CONFIRMATION_KEY] !== true) {
    return { ok: false, reason: 'king_confirmation_missing', missing: approvalBlockingChecks(normalized) };
  }
  const missing = approvalBlockingChecks(normalized);
  if (missing.length) return { ok: false, reason: 'checks_outstanding', missing };
  return { ok: true, missing: [] };
}

// ---------------------------------------------------------------------------
// Applying a decision
// ---------------------------------------------------------------------------

async function loadListingForReview(client, listingId) {
  const result = await client.query(
    `SELECT l.*, COALESCE(m.photo_count, 0)::int AS photo_count
     FROM st_listing l
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS photo_count FROM st_listing_media WHERE listing_id = l.id
     ) m ON TRUE
     WHERE l.id = $1::uuid
     FOR UPDATE OF l`,
    [listingId]
  );
  if (!result.rows.length) throw moderationError('That listing no longer exists.', 404);
  return result.rows[0];
}

async function recordEvent(client, listingId, event) {
  await client.query(
    `INSERT INTO st_listing_moderation_event
       (listing_id, actor_id, actor_role, action, stage_from, stage_to, checklist, reason, notes)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      listingId,
      event.actorId || null,
      event.actorRole || null,
      event.action,
      event.stageFrom || null,
      event.stageTo || null,
      JSON.stringify(event.checklist || {}),
      event.reason || null,
      event.notes || null
    ]
  );
}

function assertTransition(table, action, currentStage, gateName) {
  const rule = table[action];
  if (!rule) {
    throw moderationError(
      `${gateName} cannot do "${action}". Allowed: ${Object.keys(table).join(', ')}.`,
      400
    );
  }
  if (!rule.from.includes(currentStage)) {
    throw moderationError(
      `This listing is at "${STAGES[currentStage] || currentStage}", so "${action}" does not apply to it.`,
      409
    );
  }
  return rule;
}

/**
 * A staff moderator's decision. Cannot publish. The most it can do is hand the
 * listing to the King.
 */
async function applyStaffDecision(db, listingId, { action, checklist, reason, notes, actor } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const listing = await loadListingForReview(client, listingId);
    const rule = assertTransition(STAFF_ACTIONS, action, listing.moderation_stage, 'A moderator');

    if (rule.to === 'king_approved') {
      throw moderationError('Unknown stage.', 400);
    }
    if (action === 'approve') {
      if (!String(listing.district || '').trim() || !String(listing.area || '').trim()) {
        throw moderationError(
          'A specific location is required before this short stay can go live.',
          400,
          ['Save a district and an area. A missing price can stay as POA.']
        );
      }
      if (usableShortStayPhotoCount(listing) === 0) {
        throw moderationError(
          'This listing has no photos, so it cannot go live.',
          400,
          ['Reject it or ask the host for photos.']
        );
      }
    }

    const merged = normalizeChecklist({
      ...normalizeChecklist(listing.moderation_checklist),
      ...(checklist || {}),
      // Only the King stage may set this, whatever a moderator submits.
      [KING_CONFIRMATION_KEY]: normalizeChecklist(listing.moderation_checklist)[KING_CONFIRMATION_KEY] === true
    });

    if (action === 'pass_to_king') {
      const outstanding = missingChecks(merged).filter((check) => !check.overrideable);
      if (outstanding.length) {
        throw moderationError(
          'Finish the review checks before sending this to the King.',
          400,
          outstanding.map((check) => check.label)
        );
      }
    }

    const updated = await client.query(
      `UPDATE st_listing
       SET moderation_stage = $2,
           moderation_checklist = $3::jsonb,
           moderation_notes = COALESCE($4, moderation_notes),
           rejection_reason = CASE WHEN $2 IN ('rejected','changes_requested') THEN $5 WHEN $2 = 'staff_review' AND moderation_stage = 'rejected' THEN NULL ELSE rejection_reason END,
           status = CASE WHEN $2 = 'rejected' THEN 'rejected' WHEN $2 = 'approved' THEN 'approved' ELSE 'pending' END,
           king_facts_confirmed = ($2 = 'approved'),
           listed_at = CASE WHEN $2 = 'approved' THEN COALESCE(listed_at, NOW()) ELSE listed_at END,
           expires_at = CASE
             WHEN $2 = 'approved' AND listing_fee_status = 'waived' THEN NULL
             WHEN $2 = 'approved'
               THEN COALESCE(listed_at, NOW()) + (listing_term_months || ' months')::interval
             ELSE expires_at
           END,
           staff_reviewed_by = $6,
           staff_reviewed_at = NOW(),
           reviewed_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, reference, slug, status, moderation_stage, king_facts_confirmed, listed_at, expires_at`,
      [listingId, rule.to, JSON.stringify(merged), notes || null, reason || null, actor?.userId || 'staff']
    );

    await recordEvent(client, listingId, {
      actorId: actor?.userId || 'staff',
      actorRole: actor?.role || 'moderator',
      action: `staff:${action}`,
      stageFrom: listing.moderation_stage,
      stageTo: rule.to,
      checklist: merged,
      reason,
      notes
    });

    await client.query('COMMIT');
    logger.info('Short term staff review decision', {
      marker: SHORT_TERM_MODERATION_MARKER,
      listingId,
      action,
      from: listing.moderation_stage,
      to: rule.to,
      by: actor?.userId
    });
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The King's decision. This is the only path to a published listing.
 */
async function applyKingDecision(db, listingId, { action, checklist, overrides, reason, notes, factsConfirmed, actor } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const listing = await loadListingForReview(client, listingId);
    const rule = assertTransition(KING_ACTIONS, action, listing.moderation_stage, 'The King');

    const merged = normalizeChecklist({
      ...normalizeChecklist(listing.moderation_checklist),
      ...(checklist || {}),
      overrides: { ...(normalizeChecklist(listing.moderation_checklist).overrides || {}), ...(overrides || {}) },
      [KING_CONFIRMATION_KEY]: action === 'approve' ? factsConfirmed === true : false
    });

    if (action === 'approve') {
      if (factsConfirmed !== true) {
        throw moderationError(
          'Confirm you have checked the listing facts before approving it.',
          400,
          ['The facts-confirmed box has to be ticked.']
        );
      }
      const verdict = canApprove(merged);
      if (!verdict.ok) {
        throw moderationError(
          'This listing cannot go live yet.',
          400,
          verdict.missing.map((check) => check.label)
        );
      }
      if (!String(listing.district || '').trim() || !String(listing.area || '').trim()) {
        throw moderationError(
          'A specific location is required before this short stay can go live.',
          400,
          ['Save a district and an area. A missing price can stay as POA.']
        );
      }
      if (usableShortStayPhotoCount(listing) === 0) {
        throw moderationError(
          'This listing has no photos. Send it back rather than publishing it.',
          400,
          ['A short stay with no photo does not get contacted.']
        );
      }
    }

    const updated = await client.query(
      `UPDATE st_listing
       SET moderation_stage = $2,
           moderation_checklist = $3::jsonb,
           moderation_notes = COALESCE($4, moderation_notes),
           rejection_reason = CASE WHEN $2 IN ('rejected','suspended') THEN $5 ELSE NULL END,
           status = CASE
             WHEN $2 = 'approved' THEN 'approved'
             WHEN $2 = 'rejected' THEN 'rejected'
             WHEN $2 = 'suspended' THEN 'suspended'
             ELSE 'pending'
           END,
           king_facts_confirmed = ($2 = 'approved'),
           king_reviewed_by = $6,
           king_reviewed_at = NOW(),
           reviewed_at = NOW(),
           listed_at = CASE WHEN $2 = 'approved' THEN COALESCE(listed_at, NOW()) ELSE listed_at END,
           expires_at = CASE
             WHEN $2 = 'approved' AND listing_fee_status = 'waived' THEN NULL
             WHEN $2 = 'approved'
               THEN COALESCE(listed_at, NOW()) + (listing_term_months || ' months')::interval
             ELSE expires_at
           END
       WHERE id = $1::uuid
       RETURNING id, reference, slug, status, moderation_stage, king_facts_confirmed, listed_at, expires_at`,
      [listingId, rule.to, JSON.stringify(merged), notes || null, reason || null, actor?.userId || 'king']
    );

    await recordEvent(client, listingId, {
      actorId: actor?.userId || 'king',
      actorRole: actor?.role || 'king',
      action: `king:${action}`,
      stageFrom: listing.moderation_stage,
      stageTo: rule.to,
      checklist: merged,
      reason,
      notes
    });

    await client.query('COMMIT');
    logger.info('Short term King review decision', {
      marker: SHORT_TERM_MODERATION_MARKER,
      listingId,
      action,
      from: listing.moderation_stage,
      to: rule.to,
      by: actor?.userId
    });
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function loadModerationHistory(db, listingId, limit = 60) {
  const result = await db.query(
    `SELECT id, actor_id, actor_role, action, stage_from, stage_to, reason, notes, created_at
     FROM st_listing_moderation_event
     WHERE listing_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [listingId, Math.min(200, Math.max(1, Number(limit) || 60))]
  );
  return result.rows;
}

module.exports = {
  KING_ACTIONS,
  KING_CONFIRMATION_KEY,
  OVERRIDEABLE_CHECK_KEYS,
  REVIEW_CHECKS,
  REVIEW_CHECK_KEYS,
  SHORT_TERM_MODERATION_MARKER,
  STAFF_ACTIONS,
  STAGES,
  applyKingDecision,
  applyStaffDecision,
  buildAutomatedChecklist,
  canApprove,
  listingDoNotMessage,
  parseListingFacts,
  updateListingFacts,
  loadModerationHistory,
  missingChecks,
  normalizeChecklist,
  staffCanReachApproved
};
