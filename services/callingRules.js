'use strict';

/**
 * Ronald's calling rules (Arthur, 22 Nov 2026). One place for the rules that the
 * calling screen, My pipeline, the staff home and King's numbers share.
 *
 * - "Interested" counts only once a follow-up text was marked sent for that
 *   number after the call (call_sms_log), and an interested call needs a date.
 * - An outcome needs the Call tap first; only "wrong number" can be logged
 *   without dialling (flagged no_dial).
 * - Open follow-ups never drop out: an interested number that does not answer
 *   comes back the next day, then every 2 days, until Paid or a final no.
 * - An approved agent unpaid for 30 days is flagged "Remove?" for King. Flag only.
 * - Fewer than 100 fresh numbers left: Ronald and King are warned.
 */

/** Outcomes that mean "interested": need a follow-up date, and a text to count. */
const INTERESTED_OUTCOMES = Object.freeze(['interested', 'will_list']);
/** Outcomes that keep a number open for follow-up (until Paid or a final no). */
const FOLLOW_UP_OUTCOMES = Object.freeze(new Set(['interested', 'will_list', 'promised', 'signed_up', 'call_back', 'needs_help']));
/** Final answers: the number leaves the pipeline. */
const FINAL_NO = Object.freeze(new Set(['rejected', 'do_not_contact', 'wrong_number', 'not_renewing', 'seeker_texted']));
/** Looking for a place, not listing (Arthur, 22 Nov 2026): a home-seeker lead and a search-link text. Ends the call for agents. */
const SEEKER_OUTCOME = Object.freeze({ key: 'seeker_texted', label: 'Seeker, text sent', spoke: true, terminal: true, close: false, date: null });
/** The only outcomes that can be logged without tapping Call. */
const NO_DIAL_OK = Object.freeze(new Set(['wrong_number']));
const LOW_LIST_AT = 100;
const REMOVE_AFTER_DAYS = 30;

/** SQL: a follow-up text was marked sent for this call's number since the call. `a` = call_attempts alias or table name. */
function textSentSql(a = 'call_attempts') {
  return `EXISTS (SELECT 1 FROM call_sms_log s WHERE s.phone_key = ${a}.phone_key AND s.at >= ${a}.shown_at)`;
}

/** 09:00 in Kampala (UTC+3), `days` days after `now`. */
function kampalaNineAm(now = new Date(), days = 1) {
  const k = new Date(now.getTime() + 3 * 3600000);
  const day = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + days, 6, 0, 0));
  return day;
}

/**
 * The automatic retry for an open follow-up that was not answered.
 * history: earlier done attempts for the number, newest first.
 * Returns a Date, or null when the number is not an open follow-up.
 */
function autoRetryAt(history = [], now = new Date()) {
  let misses = 1; // this call
  for (const a of history) {
    if (a.outcome === 'no_answer') { misses += 1; continue; }
    if (FOLLOW_UP_OUTCOMES.has(a.outcome)) return kampalaNineAm(now, misses === 1 ? 1 : 2);
    return null;
  }
  return null;
}

/** Days an approved agent has gone unpaid, and whether King should be asked "Remove?". */
function removeFlag({ paid_until: paidUntil = null, since = null } = {}, now = new Date()) {
  const from = paidUntil || since;
  if (!from) return { unpaid_days: null, remove: false };
  const d = Math.floor((now.getTime() - new Date(String(from).length === 10 ? `${from}T00:00:00+03:00` : from).getTime()) / 86400000);
  return { unpaid_days: Math.max(0, d), remove: d >= REMOVE_AFTER_DAYS };
}

module.exports = { SEEKER_OUTCOME, INTERESTED_OUTCOMES, FOLLOW_UP_OUTCOMES, FINAL_NO, NO_DIAL_OK, LOW_LIST_AT, REMOVE_AFTER_DAYS, textSentSql, kampalaNineAm, autoRetryAt, removeFlag };
