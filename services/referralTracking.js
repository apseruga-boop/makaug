'use strict';

/**
 * First-touch referral tracking for ?ref=<code>.
 *
 * A visitor who lands on any page with ?ref=ronald (or sharon, arthur, or
 * any other code) keeps that code for about 30 days. The first touch wins:
 * a later ?ref= does not replace it. The code is saved when they submit a
 * listing or sign up as an agent or owner.
 *
 * Staff codes (ronald, sharon, arthur, and any added later) can appear as
 * supporting first-touch evidence on a staff-commission row. They never
 * change who is eligible: a ref alone does not earn commission, and the
 * #787 guards still decide.
 */

const COOKIE_NAME = 'makaug_ref';
const STORAGE_KEY = 'makaug.ref';
const MAX_AGE_DAYS = 30;
const MAX_AGE_SECONDS = MAX_AGE_DAYS * 24 * 60 * 60;
const SYSTEM_KINDS = new Set(['system']);
const SYSTEM_CODES = new Set(['owner-share']);

function getDb() {
  return require('../config/database');
}


function normaliseReferralCode(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]|[-_]$/g, '')
    .slice(0, 40);
}

function isSystemCode(code, row = null) {
  const norm = normaliseReferralCode(code);
  if (!norm) return false;
  if (SYSTEM_CODES.has(norm)) return true;
  return Boolean(row && SYSTEM_KINDS.has(row.kind));
}

function firstTouch(existing, incoming) {
  const current = normaliseReferralCode(existing);
  if (current) return current;
  return normaliseReferralCode(incoming) || null;
}

function cookieCode(req) {
  const header = String(req?.headers?.cookie || '');
  if (!header) return '';
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name !== COOKIE_NAME) continue;
    try {
      return normaliseReferralCode(decodeURIComponent(part.slice(idx + 1).trim()));
    } catch (_error) {
      return normaliseReferralCode(part.slice(idx + 1).trim());
    }
  }
  return '';
}

function readReferralFromRequest(req = {}, body = req.body || {}) {
  return firstTouch(
    '',
    body.referral_code
      || body.ref
      || req.query?.ref
      || cookieCode(req)
  );
}

function isStaffAttributionCode(code, codes = []) {
  const norm = normaliseReferralCode(code);
  if (!norm || SYSTEM_CODES.has(norm)) return false;
  const row = (codes || []).find((item) => item.code === norm);
  if (row && (row.kind === 'system' || row.active === false)) return false;
  if (row && row.person_key) return true;
  // Unknown codes are recorded, but they are not staff attribution.
  return false;
}

function personKeyForCode(code, codes = []) {
  const norm = normaliseReferralCode(code);
  if (!norm || !isStaffAttributionCode(norm, codes)) return null;
  const row = (codes || []).find((item) => item.code === norm);
  return row?.person_key || null;
}

function firstTouchEvidence(code, codes = []) {
  const norm = normaliseReferralCode(code);
  if (!norm) return null;
  const row = (codes || []).find((item) => item.code === norm) || null;
  const personKey = personKeyForCode(norm, codes);
  return {
    first_touch_ref: norm,
    first_touch_label: row?.label || norm,
    first_touch_person: personKey,
    first_touch_is_staff: Boolean(personKey),
    first_touch_note: personKey
      ? `First-touch landing was ?ref=${norm} (${row?.label || personKey}). Supporting evidence only — it does not decide commission.`
      : SYSTEM_CODES.has(norm) || row?.kind === 'system'
        ? `First-touch landing was ?ref=${norm} (system / share code). Not used for commission.`
        : `First-touch landing was ?ref=${norm} (unknown or campaign code). Recorded only — it does not decide commission.`
  };
}

function attachFirstTouchEvidence(row, agentOrListing, codes = []) {
  if (!row) return row;
  const evidence = firstTouchEvidence(agentOrListing?.referral_code, codes);
  if (!evidence) return row;
  row.first_touch_ref = evidence.first_touch_ref;
  row.first_touch_label = evidence.first_touch_label;
  row.first_touch_person = evidence.first_touch_person;
  // Evidence only — never goes on flags, which would hold the payout for review.
  const notes = Array.isArray(row.evidence) ? row.evidence : [];
  if (evidence.first_touch_note && !notes.includes(evidence.first_touch_note)) {
    notes.push(evidence.first_touch_note);
  }
  if (
    evidence.first_touch_person
    && row.person_key
    && evidence.first_touch_person !== row.person_key
  ) {
    const clash = `First-touch landing was ?ref=${evidence.first_touch_ref}, first pitch was ${row.person_name || row.person_key} — first pitch still wins`;
    if (!notes.includes(clash)) notes.push(clash);
  }
  row.evidence = notes;
  return row;
}

async function listCodes({ client = getDb(), includeInactive = true } = {}) {
  try {
    const result = await client.query(
      `SELECT code, person_key, label, kind, active, created_by, created_at, updated_by, updated_at
         FROM referral_codes
        ${includeInactive ? '' : 'WHERE active IS TRUE'}
        ORDER BY kind, label, code`
    );
    return result.rows;
  } catch (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
}

async function addCode({
  client = getDb(),
  code,
  personKey,
  label,
  kind,
  actor
} = {}) {
  const norm = normaliseReferralCode(code);
  if (!norm) {
    const error = new Error('Add a short code, for example harriet');
    error.status = 400;
    throw error;
  }
  if (SYSTEM_CODES.has(norm) && kind !== 'system') {
    const error = new Error(`${norm} is reserved`);
    error.status = 400;
    throw error;
  }
  const resolvedKind = ['staff', 'campaign', 'system'].includes(String(kind || '').toLowerCase())
    ? String(kind).toLowerCase()
    : (personKey ? 'staff' : 'campaign');
  const resolvedLabel = String(label || personKey || norm).trim() || norm;
  const person = personKey ? String(personKey).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) : null;
  const result = await client.query(
    `INSERT INTO referral_codes (code, person_key, label, kind, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (code) DO UPDATE SET
       person_key = COALESCE(EXCLUDED.person_key, referral_codes.person_key),
       label = EXCLUDED.label,
       kind = EXCLUDED.kind,
       active = TRUE,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING code, person_key, label, kind, active, created_by, created_at, updated_by, updated_at`,
    [norm, person, resolvedLabel, resolvedKind, actor || 'admin']
  );
  return result.rows[0];
}

async function countByRef({ client = getDb() } = {}) {
  const sql = `
    WITH events AS (
      SELECT referral_code AS code, 'listing'::text AS kind FROM properties WHERE referral_code IS NOT NULL AND referral_code <> ''
      UNION ALL
      SELECT referral_code, 'agent_signup' FROM agents WHERE referral_code IS NOT NULL AND referral_code <> ''
      UNION ALL
      SELECT referral_code, 'account_signup' FROM users WHERE referral_code IS NOT NULL AND referral_code <> ''
      UNION ALL
      SELECT referral_code, 'short_stay'
        FROM st_listing
       WHERE to_regclass('public.st_listing') IS NOT NULL
         AND referral_code IS NOT NULL AND referral_code <> ''
    )
    SELECT
      e.code,
      c.person_key,
      COALESCE(c.label, e.code) AS label,
      COALESCE(c.kind, 'unknown') AS kind,
      c.active,
      COUNT(*) FILTER (WHERE e.kind = 'listing')::int AS listings,
      COUNT(*) FILTER (WHERE e.kind = 'agent_signup')::int AS agent_signups,
      COUNT(*) FILTER (WHERE e.kind = 'account_signup')::int AS account_signups,
      COUNT(*) FILTER (WHERE e.kind = 'short_stay')::int AS short_stays,
      COUNT(*)::int AS total
    FROM events e
    LEFT JOIN referral_codes c ON c.code = e.code
    GROUP BY e.code, c.person_key, c.label, c.kind, c.active
    ORDER BY total DESC, e.code
  `;
  try {
    const result = await client.query(sql);
    return result.rows;
  } catch (error) {
    // st_listing may be missing in a test database; retry without it.
    if (error.code === '42P01' || /st_listing/i.test(error.message || '')) {
      const fallback = await client.query(`
        WITH events AS (
          SELECT referral_code AS code, 'listing'::text AS kind FROM properties WHERE referral_code IS NOT NULL AND referral_code <> ''
          UNION ALL
          SELECT referral_code, 'agent_signup' FROM agents WHERE referral_code IS NOT NULL AND referral_code <> ''
          UNION ALL
          SELECT referral_code, 'account_signup' FROM users WHERE referral_code IS NOT NULL AND referral_code <> ''
        )
        SELECT
          e.code,
          c.person_key,
          COALESCE(c.label, e.code) AS label,
          COALESCE(c.kind, 'unknown') AS kind,
          c.active,
          COUNT(*) FILTER (WHERE e.kind = 'listing')::int AS listings,
          COUNT(*) FILTER (WHERE e.kind = 'agent_signup')::int AS agent_signups,
          COUNT(*) FILTER (WHERE e.kind = 'account_signup')::int AS account_signups,
          0::int AS short_stays,
          COUNT(*)::int AS total
        FROM events e
        LEFT JOIN referral_codes c ON c.code = e.code
        GROUP BY e.code, c.person_key, c.label, c.kind, c.active
        ORDER BY total DESC, e.code
      `);
      return fallback.rows;
    }
    if (error.code === '42703') return [];
    throw error;
  }
}

async function summary({ client = getDb() } = {}) {
  const [codes, counts] = await Promise.all([
    listCodes({ client }),
    countByRef({ client })
  ]);
  const mapped = new Set(codes.map((c) => c.code));
  return {
    codes,
    counts,
    unknown: counts.filter((row) => !mapped.has(row.code)).map((row) => row.code),
    totals: counts.reduce((acc, row) => ({
      listings: acc.listings + Number(row.listings || 0),
      agent_signups: acc.agent_signups + Number(row.agent_signups || 0),
      account_signups: acc.account_signups + Number(row.account_signups || 0),
      short_stays: acc.short_stays + Number(row.short_stays || 0),
      total: acc.total + Number(row.total || 0)
    }), { listings: 0, agent_signups: 0, account_signups: 0, short_stays: 0, total: 0 })
  };
}

module.exports = {
  COOKIE_NAME,
  STORAGE_KEY,
  MAX_AGE_DAYS,
  MAX_AGE_SECONDS,
  SYSTEM_CODES,
  normaliseReferralCode,
  isSystemCode,
  isStaffAttributionCode,
  personKeyForCode,
  firstTouch,
  firstTouchEvidence,
  attachFirstTouchEvidence,
  cookieCode,
  readReferralFromRequest,
  listCodes,
  addCode,
  countByRef,
  summary
};
