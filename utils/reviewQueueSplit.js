'use strict';

/**
 * Which review list a pending listing belongs to (Arthur, 23 Nov 2026).
 *
 * Every pending listing is either "Found online to review" (we imported it from
 * TikTok, YouTube, Facebook or a website) or "Agent properties to review" (an
 * agent or owner sent it to us: WhatsApp intake, the broker dashboard, the
 * website form). The staff desk, its sidebar badges and King's review queues all
 * use this one rule, so a listing shows in exactly one list and the badge counts
 * match the lists.
 *
 * Root cause this replaces: the staff rule called a listing "found online" when
 * it had any video_url. WhatsApp intake listings carry our own hosted video
 * (media.makaug.com/whatsapp-employee-intake/...), so agent listings sent by
 * WhatsApp with a video vanished from "Agent properties to review".
 */

const TRUE_RE = '^(true|1|yes)$';

function col(alias) { return alias ? `${alias}.` : ''; }

/** SQL: the listing came from an agent or owner (never "found online" by a URL alone). */
function ownSubmissionSql(alias = 'p') {
  const p = col(alias);
  return `(
    ${p}agent_id IS NOT NULL
    OR LOWER(COALESCE(${p}listed_via, '')) ~ '(whatsapp|broker|agent|owner)'
    OR LOWER(COALESCE(${p}source, '')) ~ '(whatsapp|broker|owner)'
    OR COALESCE(${p}extra_fields->>'whatsapp_employee_intake', '') ~* '${TRUE_RE}'
    OR COALESCE(${p}extra_fields->>'broker_submission', '') ~* '${TRUE_RE}'
  )`;
}

/** SQL: the listing is one we found online. */
function foundOnlineSql(alias = 'p') {
  const p = col(alias);
  const flag = (k) => `COALESCE(${p}extra_fields->>'${k}', '') ~* '${TRUE_RE}'`;
  const url = (k) => `NULLIF(BTRIM(COALESCE(${p}extra_fields->>'${k}', '')), '') IS NOT NULL`;
  return `(
    ${flag('found_online')}
    OR (COALESCE(${p}extra_fields->>'found_online', '') !~* '^(false|0|no)$' AND (${flag('found_online_candidate')} OR ${flag('social_search_candidate')}))
    OR LOWER(COALESCE(NULLIF(${p}source, ''), ${p}extra_fields->>'source', '')) = 'found_online_property_source_v1'
    OR LOWER(COALESCE(NULLIF(${p}listed_via, ''), ${p}extra_fields->>'listed_via', '')) = 'found_online'
    OR LOWER(COALESCE(${p}extra_fields->>'source_badge', ${p}extra_fields->>'source_discovery_label', '')) IN ('found_online', 'found online')
    OR ((${url('source_url')} OR ${url('source_post_url')} OR ${url('tiktok_url')} OR ${url('youtube_url')}) AND NOT ${ownSubmissionSql(alias)})
  )`;
}

function truthy(v) { return v === true || /^(true|1|yes)$/i.test(String(v == null ? '' : v).trim()); }
function text(v) { return String(v == null ? '' : v).trim(); }
function extraOf(row = {}) {
  const e = row.extra_fields;
  if (e && typeof e === 'object') return e;
  if (typeof e === 'string') { try { const o = JSON.parse(e); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
  return {};
}

/** JS twin of ownSubmissionSql. */
function rowIsOwnSubmission(row = {}) {
  const extra = extraOf(row);
  return Boolean(row.agent_id)
    || /(whatsapp|broker|agent|owner)/i.test(text(row.listed_via))
    || /(whatsapp|broker|owner)/i.test(text(row.source))
    || truthy(extra.whatsapp_employee_intake)
    || truthy(extra.broker_submission);
}

/** JS twin of foundOnlineSql. */
function rowIsFoundOnline(row = {}) {
  const extra = extraOf(row);
  if (truthy(extra.found_online)) return true;
  const saysNo = extra.found_online === false || /^(false|0|no)$/i.test(text(extra.found_online)); // an explicit "no" beats a candidate flag
  if (!saysNo && (truthy(extra.found_online_candidate) || truthy(extra.social_search_candidate))) return true;
  if ((text(row.source) || text(extra.source)).toLowerCase() === 'found_online_property_source_v1') return true;
  if ((text(row.listed_via) || text(extra.listed_via)).toLowerCase() === 'found_online') return true;
  if (['found_online', 'found online'].includes(text(extra.source_badge || extra.source_discovery_label).toLowerCase())) return true;
  const hasPostUrl = ['source_url', 'source_post_url', 'tiktok_url', 'youtube_url'].some((k) => text(extra[k]));
  return hasPostUrl && !rowIsOwnSubmission(row);
}

module.exports = { foundOnlineSql, ownSubmissionSql, rowIsFoundOnline, rowIsOwnSubmission };
