'use strict';

// Agent fee exemption with an end date (from #371 / PR G4; ported in C21, 10 Oct 2026).
//
// agents.fee_exempt says an agent was let off the monthly fee; the new
// agents.fee_exempt_until (migration 190) says until when. Exempt means
// fee_exempt AND (no end date OR today < end date), on the Kampala calendar.
// When the end date arrives the agent becomes billable with the first due date
// ON the end date (never back-dated to approval). Nothing rewrites rows when
// the date passes: everything here is computed.
//
// No message is ever sent about an exemption or its end from here. The
// automatic reminder, final-notice and take-down steps skip an agent whose
// exemption ended until billing_settings.exempt_end_notices_enabled is true
// (default false; Arthur turns it on after approving the wording).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function kampalaToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function isoDay(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

/** "1 Feb 2027" (Africa/Kampala calendar day, D Mon YYYY). */
function formatExemptionDate(value) {
  const day = isoDay(value);
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** { exempt, until, ended }: ended = the exemption had an end date that has arrived. */
function exemptionState(agent = {}, today = kampalaToday()) {
  const flagged = agent?.fee_exempt === true;
  const until = isoDay(agent?.fee_exempt_until) || null;
  const exempt = flagged && (!until || today < until);
  const ended = flagged && Boolean(until) && today >= until;
  return { exempt, until, ended };
}

function isExempt(agent, today) {
  return exemptionState(agent, today).exempt;
}

/** Staff wording: "fee-exempt until 1 Feb 2027" / "fee-exempt (no end date set)" / '' */
function exemptionLabel(agent = {}, today = kampalaToday()) {
  const { exempt, until } = exemptionState(agent, today);
  if (!exempt) return '';
  return until ? `fee-exempt until ${formatExemptionDate(until)}` : 'fee-exempt (no end date set)';
}

/**
 * The date billing is due from. For an agent whose exemption ended and who has
 * never paid, that's the end date itself; otherwise their paid-until date.
 */
function firstDueDate(agent = {}, today = kampalaToday()) {
  const paid = isoDay(agent?.paid_until);
  if (paid) return paid;
  const { ended, until } = exemptionState(agent, today);
  return ended ? until : '';
}

function noticesEnabled(settings = {}) {
  const value = settings?.exempt_end_notices_enabled;
  return value === true || value?.enabled === true;
}

/** True when automatic billing messages/take-downs must leave this agent alone. */
function noticesHeld(agent = {}, settings = {}, today = kampalaToday()) {
  return exemptionState(agent, today).ended && !noticesEnabled(settings);
}

/** "billing started 1 Feb 2027 · notices held" for staff views, or ''. */
function endedExemptionNote(agent = {}, settings = {}, today = kampalaToday()) {
  const { ended, until } = exemptionState(agent, today);
  if (!ended) return '';
  return `billing started ${formatExemptionDate(until)}${noticesEnabled(settings) ? '' : ' · notices held'}`;
}

/** SQL: the agent is currently exempt. today is a YYYY-MM-DD bind parameter like '$2'. */
function activeExemptionSql(alias = 'agents', todayParam = 'CURRENT_DATE') {
  const a = alias ? `${alias}.` : '';
  return `(${a}fee_exempt AND (${a}fee_exempt_until IS NULL OR ${todayParam}::date < ${a}fee_exempt_until))`;
}

/** SQL: the agent's exemption had an end date that has arrived. */
function endedExemptionSql(alias = 'agents', todayParam = 'CURRENT_DATE') {
  const a = alias ? `${alias}.` : '';
  return `(${a}fee_exempt AND ${a}fee_exempt_until IS NOT NULL AND ${todayParam}::date >= ${a}fee_exempt_until)`;
}

module.exports = {
  kampalaToday,
  formatExemptionDate,
  exemptionState,
  isExempt,
  exemptionLabel,
  firstDueDate,
  noticesEnabled,
  noticesHeld,
  endedExemptionNote,
  activeExemptionSql,
  endedExemptionSql
};
