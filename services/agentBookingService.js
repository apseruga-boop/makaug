'use strict';

/**
 * Public agent-profile booking (Option 2).
 *
 * A visitor picks a viewing, callback, question or offer on the agent's
 * profile. The request is stored, a viewing also goes into viewing_bookings,
 * and the agent is told on the existing WhatsApp hand-off (plain text, with
 * reply 1/2/3 and signed links). Nothing here changes the WhatsApp session,
 * provider or environment. Callers pass deliverWhatsapp / handOffListingLead
 * so tests never touch a real sender.
 *
 * The clock is an in-process scheduler, the same kind the lead desk uses.
 * Reminders and the staff escalation run from tickAgentBookings. The Monday
 * availability check-in uses that same tick, and it stays off unless
 * AGENT_WEEKLY_CHECKIN_ENABLED is true. On a sleeping host those ticks wait
 * until the process is awake.
 */

const crypto = require('crypto');
const logger = require('../config/logger');
const { bookingSay, replyWindow, siteLang } = require('./bookingMessageText');

const INTENTS = Object.freeze(['viewing', 'callback', 'question', 'offer']);
const STATUSES = Object.freeze(['pending', 'confirmed', 'reschedule', 'declined', 'no_response', 'escalated', 'completed']);
const AVAILABILITY = Object.freeze(['available', 'under_offer', 'let_agreed', 'sold']);
const DAY_NAMES = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const DAY_INDEX = Object.freeze({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 });
const FULL_DAY = Object.freeze({
  sunday: 'sun', monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat'
});
const DEFAULT_DAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const DEFAULT_WINDOWS = Object.freeze([
  { start: '09:00', end: '12:00' },
  { start: '14:00', end: '17:00' }
]);
const ONE_TAP_ACTIONS = Object.freeze([
  'confirm', 'decline', 'still_available', 'under_offer', 'let_agreed', 'sold',
  'visitor_cancel', 'outcome_went', 'outcome_noshow', 'outcome_taken',
  'guest_accept', 'open', 'fully_booked', 'paused'
]);
const WEEKLY_ACTIONS = Object.freeze(['still_available', 'under_offer', 'let_agreed', 'sold']);
const REF_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const REF_DIGITS = '23456789';

function text(value, fallback = '') {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function numberSetting(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bookingConfig(env = process.env) {
  return {
    replyWindowHours: numberSetting(env.AGENT_BOOKING_REPLY_WINDOW_HOURS, 1, 0.25, 72),
    escalateHours: numberSetting(env.AGENT_BOOKING_ESCALATE_HOURS, 2, 0.5, 96),
    quietHours: text(env.AGENT_BOOKING_QUIET_HOURS, '20:00-07:00'),
    escalationResume: text(env.AGENT_BOOKING_ESCALATION_RESUME, '09:00'),
    timezone: text(env.AGENT_BOOKING_TIMEZONE, 'Africa/Kampala'),
    tokenTtlHours: numberSetting(env.AGENT_BOOKING_TOKEN_TTL_HOURS, 72, 1, 24 * 30),
    hideStale: flagOn(env.AVAILABILITY_HIDE_STALE),
    staleBadgeDays: numberSetting(env.AVAILABILITY_STALE_BADGE_DAYS, 14, 1, 365),
    hideAfterDays: numberSetting(env.AVAILABILITY_HIDE_AFTER_DAYS, 30, 1, 365),
    minReplies: numberSetting(env.AGENT_BOOKING_MIN_REPLIES, 3, 1, 100),
    outcomeDelayHours: numberSetting(env.AGENT_BOOKING_OUTCOME_DELAY_HOURS, 2, 0, 48),
    schedulerEnabled: String(env.AGENT_BOOKING_SCHEDULER_ENABLED || '').trim().toLowerCase() !== 'false',
    weeklyCheckinEnabled: flagOn(env.AGENT_WEEKLY_CHECKIN_ENABLED),
    pollMs: numberSetting(env.AGENT_BOOKING_POLL_MS, 5 * 60 * 1000, 60 * 1000, 60 * 60 * 1000),
    realertHours: numberSetting(env.AGENT_BOOKING_ESCALATION_REALERT_HOURS, 12, 1, 24 * 14),
    noteLimit: numberSetting(env.AGENT_BOOKING_NOTE_LIMIT, 900, 400, 4000)
  };
}

function escalationTargets(env = process.env) {
  const explicit = text(env.AGENT_BOOKING_ESCALATION_CONTACT);
  const fallback = explicit || text(env.LEAD_DESK_ALERT_WHATSAPP || env.LEAD_DESK_REPORT_WHATSAPP || env.AI_CEO_REPORT_WHATSAPP_RECIPIENTS);
  return fallback.split(',').map((item) => item.trim()).filter(Boolean);
}

function tokenSecret(env = process.env) {
  return text(env.AGENT_BOOKING_TOKEN_SECRET || env.JWT_SECRET, 'makaug-agent-booking-dev');
}

function siteUrl(env = process.env) {
  return text(env.PUBLIC_SITE_URL || env.PUBLIC_BASE_URL || env.APP_BASE_URL, 'https://makaug.com').replace(/\/+$/, '');
}

function bookingError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  });
  const parts = {};
  fmt.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
  });
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second || 0),
    weekday: parts.weekday
  };
}

function zoneOffsetMinutes(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function wallTimeToUtc(parts, hour, minute, timeZone) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0);
  const offset = zoneOffsetMinutes(new Date(utcGuess), timeZone);
  const instant = new Date(utcGuess - offset * 60000);
  const check = zonedParts(instant, timeZone);
  if (check.hour !== hour || check.minute !== minute || check.day !== parts.day) {
    const corrected = zoneOffsetMinutes(instant, timeZone);
    return new Date(utcGuess - corrected * 60000);
  }
  return instant;
}

function parseClock(value, fallbackMinutes) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return fallbackMinutes;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour > 23 || minute > 59) return fallbackMinutes;
  return hour * 60 + minute;
}

function quietBounds(config) {
  const raw = String(config.quietHours || '').trim();
  const [start, end] = raw.split('-');
  return {
    start: parseClock(start, 20 * 60),
    end: parseClock(end, 7 * 60),
    resume: parseClock(config.escalationResume, 9 * 60)
  };
}

function isQuietHours(date, config = bookingConfig()) {
  const bounds = quietBounds(config);
  if (bounds.start === bounds.end) return false;
  const parts = zonedParts(date, config.timezone);
  const mins = parts.hour * 60 + parts.minute;
  if (bounds.start > bounds.end) return mins >= bounds.start || mins < bounds.end;
  return mins >= bounds.start && mins < bounds.end;
}

function nextWallClock(from, minutes, config) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const parts = zonedParts(from, config.timezone);
  let target = wallTimeToUtc(parts, hour, minute, config.timezone);
  if (target.getTime() <= from.getTime()) {
    const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    target = wallTimeToUtc({
      year: utc.getUTCFullYear(),
      month: utc.getUTCMonth() + 1,
      day: utc.getUTCDate()
    }, hour, minute, config.timezone);
  }
  return target;
}

function reminderDueAt(createdAt, config = bookingConfig()) {
  const due = new Date(createdAt.getTime() + config.replyWindowHours * 3600000);
  if (!isQuietHours(due, config)) return due;
  return nextWallClock(due, quietBounds(config).end, config);
}

function escalateDueAt(createdAt, config = bookingConfig()) {
  const due = new Date(createdAt.getTime() + config.escalateHours * 3600000);
  if (!isQuietHours(createdAt, config) && !isQuietHours(due, config)) return due;
  const resumeFrom = isQuietHours(due, config) ? due : createdAt;
  return nextWallClock(resumeFrom, quietBounds(config).resume, config);
}

function isoDate(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addCivilDays(parts, days) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function weekdayName(parts) {
  return DAY_NAMES[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
}

function normaliseDays(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  list.forEach((item) => {
    if (typeof item === 'number' && item >= 0 && item <= 6) {
      out.push(DAY_NAMES[item]);
      return;
    }
    const raw = String(item || '').trim().toLowerCase();
    if (FULL_DAY[raw]) out.push(FULL_DAY[raw]);
    else if (DAY_INDEX[raw.slice(0, 3)] !== undefined) out.push(raw.slice(0, 3));
  });
  return [...new Set(out)];
}

function normaliseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function slotsFromWindows(windows) {
  const list = Array.isArray(windows) ? windows : [];
  if (!list.length) return slotsFromWindows(DEFAULT_WINDOWS);
  if (list.every((item) => typeof item === 'string' || typeof item === 'number')) {
    const slots = list.map(normaliseClock).filter(Boolean);
    return slots.length ? slots : slotsFromWindows(DEFAULT_WINDOWS);
  }
  const slots = [];
  list.forEach((window) => {
    if (!window || typeof window !== 'object') return;
    const start = normaliseClock(window.start || window.from || window.open);
    const end = normaliseClock(window.end || window.to || window.close);
    if (!start || !end) return;
    let cursor = parseClock(start, 0);
    const last = parseClock(end, 0);
    const step = Math.max(15, Number(window.step_minutes || window.minutes || 60) || 60);
    while (cursor <= last && slots.length < 24) {
      const hour = Math.floor(cursor / 60);
      const minute = cursor % 60;
      slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
      cursor += step;
    }
  });
  return slots.length ? [...new Set(slots)] : slotsFromWindows(DEFAULT_WINDOWS);
}

function asDateList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => {
    const match = String(item || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }).filter(Boolean))];
}

function mergeSchedule(propertyConfig, agentDefaults) {
  const propertyDays = normaliseDays(propertyConfig?.available_days);
  const agentDays = normaliseDays(agentDefaults?.available_days);
  const propertyWindows = propertyConfig?.available_time_windows;
  const agentWindows = agentDefaults?.available_time_windows;
  const hasPropertyWindows = Array.isArray(propertyWindows) && propertyWindows.length > 0;
  const hasAgentWindows = Array.isArray(agentWindows) && agentWindows.length > 0;
  return {
    days: propertyDays.length ? propertyDays : (agentDays.length ? agentDays : DEFAULT_DAYS.slice()),
    slots: slotsFromWindows(hasPropertyWindows ? propertyWindows : (hasAgentWindows ? agentWindows : DEFAULT_WINDOWS)),
    noticeHours: Number.isFinite(Number(propertyConfig?.notice_period_hours))
      ? Number(propertyConfig.notice_period_hours)
      : (Number.isFinite(Number(agentDefaults?.notice_period_hours)) ? Number(agentDefaults.notice_period_hours) : 24),
    maxPerSlot: Math.max(1, Number(propertyConfig?.max_bookings_per_slot || agentDefaults?.max_bookings_per_slot || 1) || 1),
    blocked: [...new Set([
      ...asDateList(propertyConfig?.blackout_dates),
      ...asDateList(agentDefaults?.blocked_dates || agentDefaults?.blackout_dates)
    ])]
  };
}

function viewingAcceptsBookings(config) {
  if (!config) return true;
  if (config.accepts_viewings === false) return false;
  const mode = String(config.booking_mode || '').toLowerCase();
  return mode !== 'disabled' && mode !== 'callback_only';
}

function slotInstant(iso, time, timeZone) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const clock = normaliseClock(time);
  if (!match || !clock) return null;
  const [hour, minute] = clock.split(':').map(Number);
  return wallTimeToUtc({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }, hour, minute, timeZone);
}

function buildDaysAndSlots({ now = new Date(), schedule, bookings = [], timeZone, horizonDays = 31 } = {}) {
  const zone = timeZone || bookingConfig().timezone;
  const today = zonedParts(now, zone);
  const counts = new Map();
  (Array.isArray(bookings) ? bookings : []).forEach((row) => {
    const day = String(row.preferred_date || row.day || '').slice(0, 10);
    const time = normaliseClock(row.preferred_time || row.time) || String(row.preferred_time || row.time || '');
    const key = `${day}|${time}`;
    counts.set(key, (counts.get(key) || 0) + (Number(row.n || row.count || 1) || 1));
  });
  const noticeAt = new Date(now.getTime() + (Number(schedule.noticeHours) || 0) * 3600000);
  const days = [];
  const slotsByDate = {};
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const parts = addCivilDays(today, offset);
    const date = isoDate(parts);
    const weekday = weekdayName(parts);
    let reason = '';
    if (offset === 0 && parts.hour * 60 + parts.minute >= 23 * 60) reason = 'past';
    if (!schedule.days.includes(weekday)) reason = reason || 'closed';
    if (schedule.blocked.includes(date)) reason = 'blocked';
    const slots = schedule.slots.map((time) => {
      const instant = slotInstant(date, time, zone);
      const taken = (counts.get(`${date}|${time}`) || 0) >= schedule.maxPerSlot;
      let state = 'open';
      if (reason) state = reason;
      else if (!instant || instant.getTime() <= noticeAt.getTime()) state = 'notice';
      else if (taken) state = 'taken';
      return { time, label: formatClock(time), available: state === 'open', state };
    });
    const anyOpen = slots.some((slot) => slot.available);
    slots.push({ time: 'any', label: 'Any time', available: anyOpen, state: anyOpen ? 'open' : (reason || 'notice') });
    const available = !reason && slots.some((slot) => slot.available);
    days.push({ date, weekday, available, reason: available ? '' : (reason || 'notice') });
    slotsByDate[date] = slots;
  }
  return { days, slotsByDate, noticeHours: schedule.noticeHours };
}

function slotIsOpen(built, date, time) {
  const slots = built?.slotsByDate?.[date] || [];
  const wanted = time === 'any' ? 'any' : normaliseClock(time);
  return slots.some((slot) => slot.time === wanted && slot.available);
}

function formatClock(time) {
  if (time === 'any') return 'Any time';
  const clock = normaliseClock(time);
  if (!clock) return text(time);
  const [hourText, minute] = clock.split(':');
  let hour = Number(hourText);
  const suffix = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatWhen(date, time, timeZone = 'Africa/Kampala') {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text([date, formatClock(time)].filter(Boolean).join(', '));
  const instant = wallTimeToUtc({
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3])
  }, 12, 0, timeZone);
  const parts = zonedParts(instant, timeZone);
  const weekday = parts.weekday;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parts.month - 1];
  const clock = time ? formatClock(time) : '';
  return [weekday, `${parts.day} ${month}`, clock].filter(Boolean).join(' ').replace(/ (\d+:\d+ [ap]m)$/, ', $1').replace(/ (Any time)$/, ', $1');
}

function propertyLabel(listing = {}) {
  const beds = Number(listing.bedrooms);
  const kind = text(listing.property_type || listing.listing_type || 'property').toLowerCase();
  const place = text(listing.area || listing.district);
  const head = Number.isFinite(beds) && beds > 0 ? `${beds}-bed ${kind}` : text(listing.title, kind);
  return place && !head.toLowerCase().includes(place.toLowerCase()) ? `${head}, ${place}` : head;
}

function firstName(value) {
  return text(value).split(' ')[0] || 'there';
}

function calendarDaysSince(iso, now, timeZone) {
  const then = new Date(iso);
  if (!iso || Number.isNaN(then.getTime())) return null;
  const a = zonedParts(then, timeZone);
  const b = zonedParts(now, timeZone);
  const aUtc = Date.UTC(a.year, a.month - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUtc - aUtc) / 86400000);
}

function availabilityView(listing = {}, now = new Date(), config = bookingConfig()) {
  const status = AVAILABILITY.includes(listing.availability_status) ? listing.availability_status : 'available';
  const names = {
    available: 'Available',
    under_offer: 'Under offer',
    let_agreed: 'Let agreed',
    sold: 'Sold'
  };
  if (status !== 'available') {
    return { status, label: names[status], tone: status, hideFromSearch: false, days: null };
  }
  const days = calendarDaysSince(listing.last_confirmed_at, now, config.timezone);
  let label = 'Available';
  let tone = 'fresh';
  if (days == null) {
    label = 'Available';
    tone = 'fresh';
  } else if (days <= 0) {
    label = 'Available · checked today';
    tone = 'fresh';
  } else if (days >= config.staleBadgeDays) {
    label = 'Available · not recently confirmed';
    tone = 'stale';
  } else if (days === 1) {
    label = 'Available · checked 1 day ago';
    tone = 'fresh';
  } else {
    label = `Available · checked ${days} days ago`;
    tone = 'fresh';
  }
  const hideFromSearch = config.hideStale && days != null && days >= config.hideAfterDays;
  return { status, label, tone, hideFromSearch, days };
}

function publicStaleAvailabilitySql(alias = 'p', env = process.env) {
  const config = bookingConfig(env);
  if (!config.hideStale) return '';
  const column = `${alias}.last_confirmed_at`;
  return `(${column} IS NULL OR ${column} >= NOW() - (${config.hideAfterDays} * INTERVAL '1 day'))`;
}

function makeShortRef() {
  const bytes = crypto.randomBytes(2);
  return REF_LETTERS[bytes[0] % REF_LETTERS.length] + REF_DIGITS[bytes[1] % REF_DIGITS.length];
}

function parseOfferUgx(value) {
  const raw = String(value ?? '').replace(/[,_\s]/g, '').replace(/ugx/ig, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const amount = Math.round(Number(raw));
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000000000) return null;
  return amount;
}

function formatOfferUgx(amount) {
  const digits = String(Math.round(Number(amount)));
  return `UGX ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function clipNote(value, limit = 900) {
  const raw = text(value);
  const max = Math.max(1, Number(limit) || 900);
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)} (cut)`;
}

function appointmentInstant(date, time, timeZone) {
  return slotInstant(date, time, timeZone || bookingConfig().timezone);
}

function shouldCatchUpWeekly(date, config = bookingConfig()) {
  const parts = zonedParts(date, config.timezone);
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  if (!day) return false;
  if (day === 1) return parts.hour >= 9;
  return true;
}

function realertDue(request, now = new Date(), config = bookingConfig()) {
  if (!request || request.status !== 'escalated') return false;
  const stamp = request.staff_alerted_at || request.escalated_at;
  if (!stamp) return true;
  const at = now instanceof Date ? now : new Date(now);
  const from = new Date(stamp);
  if (Number.isNaN(from.getTime())) return true;
  return from.getTime() + config.realertHours * 3600000 <= at.getTime();
}

function responseTimeLabel(samples, config = bookingConfig()) {
  const seconds = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (seconds.length < config.minReplies) return '';
  const sorted = seconds.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)];
  const hours = mid / 3600;
  if (hours <= 1) return 'Usually replies within 1 hour';
  if (hours <= 3) return 'Usually replies within 3 hours';
  if (hours <= 24) return 'Usually replies within a day';
  return 'Usually replies within a few days';
}

function signToken(payload, secret = tokenSecret()) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readToken(token, secret = tokenSecret(), now = Date.now()) {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (dot < 1 || !secret) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function issueLinks(request, now = Date.now(), env = process.env) {
  const exp = now + bookingConfig(env).tokenTtlHours * 3600000;
  const secret = tokenSecret(env);
  const base = siteUrl(env);
  const link = (action) => `${base}/v/${signToken({ v: 1, bid: request.id, action, exp }, secret)}`;
  return {
    confirm: link('confirm'),
    reschedule: link('reschedule'),
    decline: link('decline'),
    calendar: link('calendar'),
    visitor_cancel: link('visitor_cancel'),
    visitor_reschedule: link('visitor_reschedule')
  };
}

function issueStayLinks(reference, now = Date.now(), env = process.env) {
  const exp = now + bookingConfig(env).tokenTtlHours * 3600000;
  const secret = tokenSecret(env);
  const base = siteUrl(env);
  const link = (action) => `${base}/v/${signToken({ v: 1, stay: reference, action, exp }, secret)}`;
  return {
    confirm: link('confirm'),
    reschedule: link('reschedule'),
    decline: link('decline'),
    guest_accept: link('guest_accept'),
    guest_pick: link('guest_pick')
  };
}

function issueStayListingLinks(listingId, now = Date.now(), env = process.env) {
  const exp = now + bookingConfig(env).tokenTtlHours * 3600000;
  const secret = tokenSecret(env);
  const base = siteUrl(env);
  const link = (action) => `${base}/v/${signToken({ v: 1, stay_listing: listingId, action, exp }, secret)}`;
  return {
    open: link('open'),
    fully_booked: link('fully_booked'),
    paused: link('paused'),
    still_available: link('still_available'),
    under_offer: link('under_offer'),
    let_agreed: link('let_agreed'),
    sold: link('sold')
  };
}

function issueListingLinks(listing, agentId, now = Date.now(), env = process.env) {
  const exp = now + bookingConfig(env).tokenTtlHours * 3600000;
  const secret = tokenSecret(env);
  const base = siteUrl(env);
  const link = (action) => `${base}/v/${signToken({ v: 1, listing_id: listing.id, agent_id: agentId, action, exp }, secret)}`;
  return {
    still_available: link('still_available'),
    under_offer: link('under_offer'),
    let_agreed: link('let_agreed'),
    sold: link('sold')
  };
}

function shouldApplyOnOpen({ method = 'GET', purpose = '', action = '' } = {}) {
  if (String(method || '').toUpperCase() !== 'GET') return false;
  if (String(purpose || '').toLowerCase().includes('prefetch')) return false;
  return ONE_TAP_ACTIONS.includes(action);
}

function actionFromBookingToken(token) {
  const value = String(token || '').toLowerCase();
  if (value === '1' || value === 'confirm') return 'confirm';
  if (value === '2' || value === 'suggest' || value === 'suggest new time') return 'reschedule';
  if (value === '3' || value === "can't" || value === 'cant' || value === "can't do it" || value === 'decline') return 'decline';
  if (value === 'sold') return 'sold';
  if (value === 'let') return 'let_agreed';
  return null;
}

function parseAgentReply(body) {
  const raw = text(body);
  const value = raw.toLowerCase();
  const withRef = raw.match(/^(1|2|3)\s+([A-Za-z][2-9])$/);
  if (withRef) return { action: actionFromBookingToken(withRef[1]), ref: withRef[2].toUpperCase() };
  const mapped = actionFromBookingToken(value);
  if (mapped) return { action: mapped, ref: '' };
  if (value === 'went' || value === 'went ahead') return { action: 'outcome_went', ref: '' };
  if (value === 'no-show' || value === 'noshow' || value === 'no show') return { action: 'outcome_noshow', ref: '' };
  if (value === 'taken' || value === 'property now taken') return { action: 'outcome_taken', ref: '' };
  return null;
}

function parseWeeklyReply(body) {
  const value = text(body).toLowerCase();
  const pair = value.match(/^(\d{1,2})\s+([1-4])$/);
  if (pair) return { listingIndex: Number(pair[1]), action: WEEKLY_ACTIONS[Number(pair[2]) - 1] };
  const words = {
    1: 'still_available',
    2: 'under_offer',
    3: 'let_agreed',
    4: 'sold',
    still: 'still_available',
    'still available': 'still_available',
    offer: 'under_offer',
    'under offer': 'under_offer',
    let: 'let_agreed',
    'let agreed': 'let_agreed',
    sold: 'sold'
  };
  if (!words[value]) return null;
  return { listingIndex: 0, action: words[value] };
}

function withEvent(request, type, at) {
  const events = Array.isArray(request.events) ? request.events.slice() : [];
  events.push({ at: new Date(at).toISOString(), type, status: request.status });
  return { ...request, events };
}

function applyReply(request, action, extra = {}, now = new Date()) {
  const current = { ...request, events: Array.isArray(request.events) ? request.events : [] };
  const at = now instanceof Date ? now : new Date(now);
  if (action === 'remind') {
    if (!['pending', 'reschedule'].includes(current.status)) return { ok: false, error: 'This request is no longer waiting.' };
    return { ok: true, request: withEvent({ ...current, reminded_at: at.toISOString() }, 'remind', at), listingPatch: null };
  }
  if (action === 'escalate') {
    if (!['pending', 'reschedule', 'no_response'].includes(current.status)) {
      return { ok: false, error: 'This request is no longer waiting.' };
    }
    let next = current.status === 'no_response'
      ? current
      : withEvent({ ...current, status: 'no_response', no_response_at: at.toISOString() }, 'no_response', at);
    next = withEvent({
      ...next,
      status: 'escalated',
      escalated_at: at.toISOString(),
      staff_alerted_at: at.toISOString()
    }, 'escalated', at);
    return { ok: true, request: next, listingPatch: null };
  }
  if (action === 'confirm') {
    if (!['pending', 'reschedule', 'no_response', 'escalated'].includes(current.status)) {
      return { ok: false, error: 'This request is already closed.' };
    }
    const date = extra.proposed_date || current.proposed_date || current.preferred_date;
    const time = extra.proposed_time || current.proposed_time || current.preferred_time;
    const next = withEvent({
      ...current,
      status: 'confirmed',
      preferred_date: date || current.preferred_date,
      preferred_time: time || current.preferred_time,
      first_response_at: current.first_response_at || at.toISOString(),
      visitor_confirmed_at: at.toISOString()
    }, 'confirmed', at);
    const listingPatch = current.listing_id ? { id: current.listing_id, availability_status: null, touch: true } : null;
    return { ok: true, request: next, listingPatch };
  }
  if (action === 'reschedule') {
    if (!['pending', 'reschedule', 'no_response', 'escalated', 'confirmed'].includes(current.status)) {
      return { ok: false, error: 'This request is already closed.' };
    }
    const next = withEvent({
      ...current,
      status: 'reschedule',
      proposed_date: extra.proposed_date || current.proposed_date || null,
      proposed_time: extra.proposed_time || current.proposed_time || null,
      first_response_at: current.first_response_at || at.toISOString(),
      reminded_at: null,
      escalated_at: null,
      staff_alerted_at: null,
      reminder_due_at: reminderDueAt(at).toISOString(),
      escalate_due_at: escalateDueAt(at).toISOString()
    }, 'reschedule', at);
    return { ok: true, request: next, listingPatch: null };
  }
  if (action === 'decline' || action === 'visitor_cancel') {
    if (['declined', 'completed'].includes(current.status)) return { ok: false, error: 'This request is already closed.' };
    const next = withEvent({
      ...current,
      status: 'declined',
      first_response_at: action === 'visitor_cancel' ? current.first_response_at : (current.first_response_at || at.toISOString())
    }, action, at);
    return { ok: true, request: next, listingPatch: null };
  }
  if (action === 'sold' || action === 'let_agreed' || action === 'under_offer' || action === 'still_available') {
    const status = action === 'still_available' ? 'available' : (action === 'sold' ? 'sold' : action);
    return {
      ok: true,
      request: current.listing_id ? current : current,
      listingPatch: { id: extra.listing_id || current.listing_id, availability_status: status, touch: true }
    };
  }
  if (action === 'outcome_went' || action === 'outcome_noshow' || action === 'outcome_taken') {
    if (current.status === 'completed') return { ok: true, request: current, listingPatch: null };
    if (current.status !== 'confirmed') return { ok: false, error: 'This viewing is not confirmed.' };
    const outcome = action === 'outcome_went' ? 'went_ahead' : (action === 'outcome_noshow' ? 'no_show' : 'property_taken');
    const next = withEvent({ ...current, status: 'completed', outcome }, outcome, at);
    const listingPatch = outcome === 'property_taken' && current.listing_id
      ? { id: current.listing_id, availability_status: 'sold', touch: true }
      : null;
    return { ok: true, request: next, listingPatch };
  }
  return { ok: false, error: 'Unknown action.' };
}

function dueActions(request, now = new Date(), config = bookingConfig()) {
  const actions = [];
  const at = now instanceof Date ? now : new Date(now);
  const waiting = request.status === 'pending' || request.status === 'reschedule';
  if (waiting && !request.escalated_at && request.escalate_due_at && new Date(request.escalate_due_at) <= at) {
    actions.push('escalate');
  } else if (waiting && !request.reminded_at && request.reminder_due_at && new Date(request.reminder_due_at) <= at) {
    actions.push('remind');
  }
  if (realertDue(request, at, config)) actions.push('realert');
  if (request.status === 'confirmed' && request.intent === 'viewing' && request.preferred_date && request.preferred_time && request.preferred_time !== 'any') {
    const when = slotInstant(String(request.preferred_date).slice(0, 10), request.preferred_time, config.timezone);
    if (when) {
      const dayBefore = new Date(when.getTime() - 24 * 3600000);
      const twoHours = new Date(when.getTime() - 2 * 3600000);
      const after = new Date(when.getTime() + config.outcomeDelayHours * 3600000);
      if (!request.visitor_reminder_24h_at && dayBefore <= at && at < when) actions.push('remind_visitor_24h');
      if (!request.visitor_reminder_2h_at && twoHours <= at && at < when) actions.push('remind_visitor_2h');
      if (!request.outcome_asked_at && after <= at) actions.push('ask_outcome');
    }
  }
  return actions;
}

function weekKey(date, config = bookingConfig()) {
  const parts = zonedParts(date, config.timezone);
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function shouldSendWeekly(date, config = bookingConfig()) {
  const parts = zonedParts(date, config.timezone);
  return parts.weekday === 'Mon' && parts.hour >= 9 && parts.hour < 18;
}

function agentMessageLang(request = {}) {
  return siteLang(request.agent_preferred_language || request.agent_language);
}

function visitorMessageLang(request = {}) {
  return siteLang(request.language || request.visitor_language);
}

function buildAgentRequestMessage(request, links, config = bookingConfig()) {
  const lang = agentMessageLang(request);
  const intentKey = {
    viewing: 'New viewing request',
    callback: 'New callback request',
    question: 'New question',
    offer: 'New offer'
  }[request.intent] || 'New request';
  const who = text(request.visitor_name, bookingSay(lang, 'A visitor'));
  const property = text(request.property_label || request.property_title, bookingSay(lang, 'a property on your profile'));
  const note = clipNote(request.visitor_message, config.noteLimit);
  const wants = {
    viewing: '{who} wants to view',
    callback: '{who} wants to be called about',
    offer: '{who} wants to make an offer on'
  }[request.intent] || '{who} wants to ask about';
  const offer = request.intent === 'offer' && request.offer_amount
    ? bookingSay(lang, 'Offer: {amount}', { amount: formatOfferUgx(request.offer_amount) })
    : '';
  const lines = [
    bookingSay(lang, intentKey),
    request.public_ref ? bookingSay(lang, 'Ref {ref}', { ref: request.public_ref }) : '',
    bookingSay(lang, 'Hi {name}, you\'ve got interest!', { name: firstName(request.agent_name) }),
    bookingSay(lang, wants, { who }),
    `${property}${request.inquiry_reference ? ` (${request.inquiry_reference})` : ''}`,
    offer,
    request.when_label || '',
    request.visitor_phone || '',
    note ? bookingSay(lang, 'Note: {note}', { note }) : '',
    bookingSay(lang, 'Please confirm within {window}. Reply 1 Confirm, 2 Suggest new time, 3 Can\'t do it', {
      window: replyWindow(lang, config.replyWindowHours)
    }),
    request.public_ref ? bookingSay(lang, 'Reply like 1 {ref}', { ref: request.public_ref }) : '',
    `1 ${bookingSay(lang, 'Confirm')}: ${links.confirm}`,
    `2 ${bookingSay(lang, 'Suggest new time')}: ${links.reschedule}`,
    `3 ${bookingSay(lang, 'Can\'t do it')}: ${links.decline}`
  ];
  return lines.filter((line) => line !== '').join('\n');
}

function buildVisitorRequestMessage(request) {
  const lang = visitorMessageLang(request);
  const name = firstName(request.visitor_name);
  const agent = firstName(request.agent_name);
  const property = text(request.property_label || request.property_title, bookingSay(lang, 'the property'));
  const sentKey = {
    viewing: 'Your viewing request for {property} has been sent to {agent}.',
    callback: 'Your callback request for {property} has been sent to {agent}.',
    offer: 'Your offer for {property} has been sent to {agent}.'
  }[request.intent] || 'Your question for {property} has been sent to {agent}.';
  return [
    bookingSay(lang, 'Hi {name},', { name }),
    bookingSay(lang, sentKey, { property, agent }),
    request.when_label ? bookingSay(lang, 'Time: {when}', { when: request.when_label }) : '',
    bookingSay(lang, 'We will message you when they confirm. If they have not replied in time, the MakaUG team will call you.'),
    bookingSay(lang, 'Never pay before you have seen the property and its documents.')
  ].filter((line) => line !== '').join('\n');
}

function handoffReached(status) {
  return ['sent', 'queued', 'simulated'].includes(String(status || ''));
}

function buildVisitorSkippedMessage(request, handoffStatus) {
  const lang = visitorMessageLang(request);
  const name = firstName(request.visitor_name);
  const agent = text(request.agent_name, bookingSay(lang, 'the agent'));
  const property = text(request.property_label || request.property_title, bookingSay(lang, 'the property'));
  const status = String(handoffStatus || 'skipped');
  const reasonKey = {
    repeat: 'We already have your request about {property}, so we have not sent it to {agent} again.',
    capped: 'We saved your request about {property}. {agent} has reached today\'s message limit, so the MakaUG team will follow up.',
    listing_not_live: 'We saved your request about {property}. This listing is not live, so we have not messaged {agent}. The MakaUG team will follow up.',
    disabled: 'We saved your request about {property}. Messaging the agent is turned off, so the MakaUG team will follow up.',
    agent_not_approved: 'We saved your request about {property}. This agent is not live on makaug, so we have not messaged them. The MakaUG team will follow up.',
    contact_shown: 'We saved your request about {property}. This listing keeps the original poster\'s contact, so makaug has not messaged them.',
    failed: 'We saved your request about {property}, but the message to {agent} did not go out. The MakaUG team will follow up.',
    no_lister_contact: 'We saved your request about {property}. We do not have a WhatsApp number for {agent}, so the MakaUG team will follow up.',
    no_listing: 'We saved your request. We could not match it to a live listing, so the MakaUG team will follow up.',
    no_lead: 'We saved your request about {property}. It is with the MakaUG team, and {agent} has not been messaged yet.',
    test_skipped: 'We saved your request about {property}. It was marked as a test, so {agent} was not messaged.',
    skipped: 'We saved your request about {property}. {agent} has not been messaged yet. The MakaUG team will follow up.'
  }[status] || 'We saved your request about {property}. {agent} has not been messaged yet. The MakaUG team will follow up.';
  return [
    bookingSay(lang, 'Hi {name},', { name }),
    '',
    bookingSay(lang, reasonKey, { property, agent }),
    bookingSay(lang, 'Never pay before you have seen the property and its documents.')
  ].join('\n');
}

function buildVisitorStatusMessage(request, action, links = {}) {
  const lang = visitorMessageLang(request);
  const name = firstName(request.visitor_name);
  const agent = text(request.agent_name, bookingSay(lang, 'The agent'));
  const when = request.when_label || formatWhen(request.preferred_date, request.preferred_time);
  const windowLabel = text(request.callback_window || request.when_label, bookingSay(lang, 'soon'));
  if (action === 'confirm') {
    let lead;
    if (request.intent === 'callback') {
      lead = bookingSay(lang, 'Hi {name}, confirmed. {agent} will call you {window}.', { name, agent, window: windowLabel });
    } else if (request.intent === 'question') {
      lead = bookingSay(lang, 'Hi {name}, confirmed. {agent} has your question and will reply.', { name, agent });
    } else if (request.intent === 'offer') {
      const amount = request.offer_amount ? formatOfferUgx(request.offer_amount) : 'UGX';
      lead = bookingSay(lang, 'Hi {name}, confirmed. {agent} has received your offer of {amount} and will respond.', { name, agent, amount });
    } else {
      lead = [
        bookingSay(lang, 'Hi {name}, confirmed. {agent} will meet you {when}.', { name, agent, when }),
        bookingSay(lang, 'They will call you on {phone} to agree the meeting point.', { phone: request.visitor_phone }),
        bookingSay(lang, 'Never pay before you have seen the property and its documents.')
      ].join('\n');
    }
    const extra = [];
    if (links.visitor_cancel) extra.push(bookingSay(lang, 'Cancel: {link}', { link: links.visitor_cancel }));
    if (links.visitor_reschedule) extra.push(bookingSay(lang, 'Reschedule: {link}', { link: links.visitor_reschedule }));
    return [lead, ...extra].join('\n');
  }
  if (action === 'reschedule') {
    const proposed = request.proposed_date ? formatWhen(request.proposed_date, request.proposed_time) : '';
    if (proposed) {
      return [
        bookingSay(lang, 'Hi {name}, {agent} suggests {when} instead.', { name, agent, when: proposed }),
        links.confirm ? bookingSay(lang, 'Accept: {link}', { link: links.confirm }) : '',
        links.visitor_reschedule ? bookingSay(lang, 'Pick another: {link}', { link: links.visitor_reschedule }) : ''
      ].filter((line) => line !== '').join('\n');
    }
    return [
      bookingSay(lang, 'Hi {name}, {agent} cannot do {when} and will suggest another time.', { name, agent, when }),
      links.visitor_reschedule ? bookingSay(lang, 'Pick another: {link}', { link: links.visitor_reschedule }) : ''
    ].filter((line) => line !== '').join('\n');
  }
  if (action === 'decline' || action === 'escalate') {
    return bookingSay(lang, 'Hi {name}, {agent} has not confirmed this request. A MakaUG team member will call you.', { name, agent });
  }
  if (action === 'remind_visitor_24h') {
    return bookingSay(lang, 'Reminder: your viewing with {agent} is tomorrow, {when}.', { agent, when });
  }
  if (action === 'remind_visitor_2h') {
    return bookingSay(lang, 'Reminder: your viewing with {agent} is in about 2 hours, {when}.', { agent, when });
  }
  if (action === 'ask_outcome') {
    return bookingSay(lang, 'Hi {name}, how did the viewing go? Reply WENT, NO-SHOW, or TAKEN.', { name });
  }
  return '';
}

function buildAgentAck(request, action, links) {
  const lang = agentMessageLang(request);
  const visitor = text(request.visitor_name, bookingSay(lang, 'the visitor'));
  if (action === 'confirm') {
    return bookingSay(lang, 'Confirmed. We\'ve told {visitor}. Call them on {phone} to agree where to meet. Reply SOLD or LET any time if this property is taken.', {
      visitor,
      phone: request.visitor_phone
    });
  }
  if (action === 'reschedule') {
    return request.proposed_date
      ? bookingSay(lang, 'New time saved. We\'ve told {visitor}.', { visitor })
      : bookingSay(lang, 'Open this link to pick a new time: {link}', { link: links?.reschedule || '' }).trim();
  }
  if (action === 'decline') return bookingSay(lang, 'We\'ve told them you can\'t do it. The MakaUG team will call them.');
  if (action === 'remind') {
    const ref = request.public_ref ? bookingSay(lang, ' Ref {ref}.', { ref: request.public_ref }) : '';
    const when = request.when_label ? ` (${request.when_label})` : '';
    return bookingSay(lang, 'Reminder: {visitor} is still waiting{when}.{ref} Reply 1 Confirm, 2 Suggest new time, 3 Can\'t do it.', {
      visitor: text(request.visitor_name, bookingSay(lang, 'A visitor')),
      when,
      ref
    });
  }
  if (action === 'sold') return bookingSay(lang, 'Marked sold.');
  if (action === 'let_agreed') return bookingSay(lang, 'Marked let agreed.');
  if (action === 'under_offer') return bookingSay(lang, 'Marked under offer.');
  if (action === 'still_available') return bookingSay(lang, 'Marked still available.');
  return bookingSay(lang, 'Saved.');
}

function buildEscalationMessage(request) {
  return [
    'A booking needs a person from MakaUG.',
    `${text(request.visitor_name, 'A visitor')} asked ${text(request.agent_name, 'an agent')} (${request.intent}).`,
    text(request.property_label || request.property_title),
    request.when_label || '',
    request.visitor_phone ? `Call the visitor: ${request.visitor_phone}` : '',
    'The agent has not replied.'
  ].filter(Boolean).join('\n');
}

function buildWeeklyMessage(agent, listings, linkSets) {
  const lines = [
    `Monday check-in for ${text(agent.full_name || agent.name, 'your listings')}`,
    'For each listing, tap Still available, Under offer, Let agreed, or Sold.',
    'Reply 1 Still available, 2 Under offer, 3 Let agreed, 4 Sold.',
    listings.length > 1 ? 'If you have more than one listing, reply with the listing number then the status number, for example 2 4.' : '',
    ''
  ];
  listings.forEach((listing, index) => {
    const links = linkSets[index] || {};
    lines.push(`${index + 1}. ${propertyLabel(listing)}`);
    lines.push(`Still available: ${links.still_available || ''}`);
    lines.push(`Under offer: ${links.under_offer || ''}`);
    lines.push(`Let agreed: ${links.let_agreed || ''}`);
    lines.push(`Sold: ${links.sold || ''}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

function describeRequest(row, config = bookingConfig()) {
  const property = propertyLabel(row);
  const when = row.intent === 'callback'
    ? text(row.callback_window)
    : formatWhen(row.proposed_date || row.preferred_date, row.proposed_time || row.preferred_time, config.timezone);
  return {
    ...row,
    property_label: property,
    when_label: when,
    agent_name: row.agent_name || row.full_name || ''
  };
}

function phoneTail(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

async function saveRequest(db, request) {
  await db.query(
    `/* agent-booking:save */
     UPDATE agent_booking_requests SET
       status = $2,
       preferred_date = $3,
       preferred_time = $4,
       proposed_date = $5,
       proposed_time = $6,
       reminded_at = $7,
       escalated_at = $8,
       no_response_at = $9,
       first_response_at = $10,
       visitor_reminder_24h_at = $11,
       visitor_reminder_2h_at = $12,
       outcome_asked_at = $13,
       outcome = $14,
       events = $15::jsonb,
       reminder_due_at = $16,
       escalate_due_at = $17,
       staff_alerted_at = $18,
       updated_at = NOW()
     WHERE id = $1`,
    [
      request.id,
      request.status,
      request.preferred_date || null,
      request.preferred_time || null,
      request.proposed_date || null,
      request.proposed_time || null,
      request.reminded_at || null,
      request.escalated_at || null,
      request.no_response_at || null,
      request.first_response_at || null,
      request.visitor_reminder_24h_at || null,
      request.visitor_reminder_2h_at || null,
      request.outcome_asked_at || null,
      request.outcome || null,
      JSON.stringify(request.events || []),
      request.reminder_due_at || null,
      request.escalate_due_at || null,
      request.staff_alerted_at || null
    ]
  );
  return request;
}

async function touchListing(db, patch, now) {
  if (!patch?.id) return;
  if (patch.availability_status) {
    await db.query(
      `/* agent-booking:listing-status */
       UPDATE properties
          SET availability_status = $2,
              last_confirmed_at = $3
        WHERE id = $1`,
      [patch.id, patch.availability_status, now]
    );
    return;
  }
  if (patch.touch) {
    await db.query(
      `/* agent-booking:listing-touch */
       UPDATE properties SET last_confirmed_at = $2 WHERE id = $1`,
      [patch.id, now]
    );
  }
}

async function flagStaff(db, { bookingId = null, listingId = null, kind, message }) {
  logger.warn('Agent booking staff flag', { kind, bookingId, listingId, message });
  try {
    await db.query(
      `/* agent-booking:flag */
       INSERT INTO agent_booking_staff_flags (booking_id, listing_id, kind, message)
       VALUES ($1, $2, $3, $4)`,
      [bookingId, listingId, kind, message]
    );
  } catch (error) {
    logger.warn('Agent booking staff flag was not stored', { message: error.message });
  }
}

function sendDeps(deps = {}) {
  const handoff = require('./leadHandoffService');
  return {
    handOffListingLead: deps.handOffListingLead || handoff.handOffListingLead,
    deliverWhatsapp: deps.deliverWhatsapp || handoff.deliverWhatsapp,
    createLead: deps.createLead || require('./leadService').createLead,
    loadListingContact: deps.loadListingContact || handoff.loadListingContact,
    logNotification: deps.logNotification || require('./notificationLogService').logNotification
  };
}

async function deliverPlain(deliver, { to, body, kind, leadId, nonce }) {
  if (!to || !body) return { status: 'skipped' };
  return deliver({ to, body, kind, leadId: leadId || null, nonce: nonce || kind });
}

async function createAgentBooking(db, input = {}, deps = {}) {
  const config = bookingConfig();
  const now = input.now instanceof Date ? input.now : new Date();
  const intent = text(input.intent).toLowerCase();
  if (!INTENTS.includes(intent)) throw bookingError('intent is invalid');
  const name = text(input.name || input.contact_name);
  const phone = text(input.phone || input.contact_phone).replace(/\s+/g, '');
  if (!name) throw bookingError('name is required');
  if (!phone || !/^\+?[0-9]{10,15}$/.test(phone)) throw bookingError('phone is invalid');
  const agentResult = await db.query(
    `/* agent-booking:agent */
     SELECT id, full_name, phone, whatsapp, status,
            COALESCE((SELECT preferred_language FROM users WHERE id = agents.user_id), 'en') AS agent_preferred_language
       FROM agents
      WHERE id = $1
      LIMIT 1`,
    [input.agentId]
  );
  const agent = agentResult.rows[0];
  if (!agent) throw bookingError('Agent not found', 404);
  let listing = null;
  if (input.listingId) {
    const listingResult = await db.query(
      `/* agent-booking:listing */
       SELECT id, title, district, area, bedrooms, property_type, listing_type, price, inquiry_reference,
              availability_status, last_confirmed_at, status
         FROM properties
        WHERE id = $1 AND agent_id = $2 AND LOWER(COALESCE(status, '')) = 'approved'
        LIMIT 1`,
      [input.listingId, agent.id]
    );
    listing = listingResult.rows[0] || null;
    if (!listing) throw bookingError('Property not found', 404);
  }
  if (intent === 'viewing' && !listing) throw bookingError('Choose a property, a day and a time.');
  if (intent === 'offer' && !listing) throw bookingError('Choose a property for the offer.');
  let offerAmount = null;
  if (intent === 'offer') {
    offerAmount = parseOfferUgx(input.offerAmount || input.offer_amount);
    if (offerAmount == null) throw bookingError('Offer amount must be a number in UGX.');
  }
  const preferredDate = text(input.preferredDate || input.preferred_date);
  const preferredTime = text(input.preferredTime || input.preferred_time);
  if (intent === 'viewing') {
    const configRow = await db.query(
      `/* agent-booking:config */ SELECT * FROM viewing_configs WHERE listing_id = $1 LIMIT 1`,
      [listing.id]
    );
    const defaultsRow = await db.query(
      `/* agent-booking:defaults */ SELECT * FROM agent_viewing_defaults WHERE agent_id = $1 LIMIT 1`,
      [agent.id]
    );
    const propertyConfig = configRow.rows[0] || null;
    if (!viewingAcceptsBookings(propertyConfig)) {
      throw bookingError('This listing is not accepting viewing bookings. Request a callback instead.', 409);
    }
    const schedule = mergeSchedule(propertyConfig, defaultsRow.rows[0] || null);
    const counts = await db.query(
      `/* agent-booking:slot-count */
       SELECT preferred_date::text AS preferred_date, preferred_time, COUNT(*)::int AS n
         FROM viewing_bookings
        WHERE listing_id = $1
          AND preferred_date >= CURRENT_DATE
          AND status NOT IN ('cancelled', 'declined')
        GROUP BY 1, 2`,
      [listing.id]
    );
    const built = buildDaysAndSlots({ now, schedule, bookings: counts.rows, timeZone: config.timezone });
    if (!slotIsOpen(built, preferredDate, preferredTime || 'any')) {
      throw bookingError('This time is no longer open. Pick another.', 409);
    }
  }
  const services = sendDeps(deps);
  let viewingId = null;
  if (intent === 'viewing') {
    const inserted = await db.query(
      `/* agent-booking:insert-viewing */
       INSERT INTO viewing_bookings (
         listing_id, broker_id, name, phone, preferred_date, preferred_time,
         contact_method, message, status, source, language_preference
       ) VALUES ($1, $2, $3, $4, $5, $6, 'whatsapp', $7, 'requested', 'agent_profile', $8)
       RETURNING id`,
      [
        listing.id,
        null,
        name,
        phone,
        preferredDate || null,
        preferredTime || null,
        text(input.message) || null,
        text(input.language, 'en').slice(0, 8)
      ]
    );
    viewingId = inserted.rows[0]?.id || null;
  }
  const reminderAt = reminderDueAt(now, config);
  const escalateAt = escalateDueAt(now, config);
  let publicRef = '';
  let requestRow = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    publicRef = makeShortRef();
    try {
      requestRow = await db.query(
        `/* agent-booking:insert-request */
         INSERT INTO agent_booking_requests (
           agent_id, listing_id, viewing_booking_id, intent, status, visitor_name, visitor_phone,
           visitor_message, preferred_date, preferred_time, callback_window, contact_channel,
           offer_amount, language, reminder_due_at, escalate_due_at, events, public_ref
         ) VALUES (
           $1, $2, $3, $4, 'pending', $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15, '[]'::jsonb, $16
         ) RETURNING id, created_at`,
        [
          agent.id,
          listing?.id || null,
          viewingId,
          intent,
          name,
          phone,
          text(input.message) || null,
          preferredDate || null,
          preferredTime || null,
          text(input.callbackWindow || input.callback_window) || null,
          text(input.contactChannel || input.contact_channel) || null,
          offerAmount == null ? null : String(offerAmount),
          text(input.language, 'en').slice(0, 8),
          reminderAt,
          escalateAt,
          publicRef
        ]
      );
      break;
    } catch (error) {
      if (error && error.code === '23505' && attempt < 5) continue;
      throw error;
    }
  }
  if (!requestRow?.rows?.[0]) throw bookingError('Could not save the request', 500);
  const request = describeRequest({
    id: requestRow.rows[0]?.id,
    agent_id: agent.id,
    agent_name: agent.full_name,
    listing_id: listing?.id || null,
    inquiry_reference: listing?.inquiry_reference || '',
    intent,
    status: 'pending',
    visitor_name: name,
    visitor_phone: phone,
    visitor_message: text(input.message),
    preferred_date: preferredDate || null,
    preferred_time: preferredTime || null,
    callback_window: text(input.callbackWindow || input.callback_window),
    offer_amount: offerAmount == null ? '' : String(offerAmount),
    public_ref: publicRef,
    property_title: listing?.title || '',
    bedrooms: listing?.bedrooms,
    property_type: listing?.property_type,
    area: listing?.area,
    district: listing?.district,
    reminder_due_at: reminderAt.toISOString(),
    escalate_due_at: escalateAt.toISOString(),
    events: [],
    language: siteLang(input.language),
    agent_preferred_language: siteLang(agent.agent_preferred_language)
  }, config);
  const links = issueLinks(request, now.getTime());
  const agentMessage = buildAgentRequestMessage(request, links, config);
  const visitorMessage = buildVisitorRequestMessage(request);
  let lead = null;
  try {
    lead = await services.createLead(db, {
      listingId: listing?.id || null,
      agentId: agent.id,
      channel: 'web',
      contact: { name, phone, preferredContactChannel: 'whatsapp', roleType: 'property_seeker' },
      source: 'agent_profile',
      leadType: intent === 'viewing' ? 'viewing' : intent === 'callback' ? 'callback' : 'enquiry',
      explicitContact: true,
      message: text(input.message) || `${intent} from the agent profile of ${agent.full_name}.`,
      metadata: { agent_booking_request_id: request.id, intent }
    });
  } catch (error) {
    logger.warn('Agent booking lead was not stored', { message: error.message });
  }
  if (lead?.id) {
    await db.query(`/* agent-booking:attach-lead */ UPDATE agent_booking_requests SET lead_id = $2 WHERE id = $1`, [request.id, lead.id]);
    if (viewingId) {
      await db.query(`/* agent-booking:attach-viewing-lead */ UPDATE viewing_bookings SET lead_id = $2 WHERE id = $1`, [viewingId, lead.id]);
    }
  }
  let handoff = { status: 'skipped' };
  const agentPhone = agent.whatsapp || agent.phone;
  if (listing && lead?.id) {
    const loaded = await services.loadListingContact(db, listing.id);
    handoff = await services.handOffListingLead(db, {
      lead,
      listing: loaded || listing,
      kind: intent === 'viewing' ? 'viewing' : intent === 'callback' ? 'callback' : 'enquiry',
      seeker: { name, phone },
      message: text(input.message),
      extra: {
        preferred_date: preferredDate,
        preferred_time: preferredTime,
        preferred_callback_time: request.callback_window,
        agent_message: agentMessage,
        seeker_message: visitorMessage
      }
    });
  } else {
    const agentDelivery = await deliverPlain(services.deliverWhatsapp, {
      to: agentPhone, body: agentMessage, kind: `agent_booking_${intent}`, leadId: lead?.id, nonce: request.id
    });
    const visitorDelivery = await deliverPlain(services.deliverWhatsapp, {
      to: phone, body: visitorMessage, kind: `agent_booking_visitor_${intent}`, leadId: lead?.id, nonce: `${request.id}:visitor`
    });
    handoff = { status: agentDelivery.status, visitor: visitorDelivery.status, lister: { phone: agentPhone } };
  }
  const sentTo = handoff?.lister?.phone || agentPhone || '';
  await db.query(
    `/* agent-booking:sent-to */ UPDATE agent_booking_requests SET sent_to_phone = $2 WHERE id = $1`,
    [request.id, sentTo || null]
  );
  request.sent_to_phone = sentTo || '';
  let visitorShown = visitorMessage;
  if (!handoffReached(handoff.status)) {
    visitorShown = buildVisitorSkippedMessage(request, handoff.status);
    await deliverPlain(services.deliverWhatsapp, {
      to: phone,
      body: visitorShown,
      kind: `agent_booking_visitor_status_${handoff.status || 'skipped'}`,
      leadId: lead?.id,
      nonce: `${request.id}:visitor-status`
    });
  }
  return {
    request,
    links,
    handoff: handoff.status,
    agent_message: agentMessage,
    visitor_message: visitorShown
  };
}

async function loadRequest(db, id) {
  const result = await db.query(
    `/* agent-booking:by-id */
     SELECT r.*, p.title AS property_title, p.area, p.district, p.bedrooms, p.property_type,
            p.inquiry_reference, a.full_name AS agent_name, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
            COALESCE((SELECT preferred_language FROM users WHERE id = a.user_id), 'en') AS agent_preferred_language
       FROM agent_booking_requests r
       LEFT JOIN properties p ON p.id = r.listing_id
       LEFT JOIN agents a ON a.id = r.agent_id
      WHERE r.id = $1
      LIMIT 1`,
    [id]
  );
  return result.rows[0] ? describeRequest(result.rows[0]) : null;
}

async function applyStoredAction(db, request, action, extra, deps, now = new Date()) {
  const services = sendDeps(deps);
  const described = describeRequest(request);
  const applied = applyReply(described, action, extra, now);
  if (!applied.ok) return applied;
  if (applied.request.id) await saveRequest(db, applied.request);
  if (applied.listingPatch) await touchListing(db, applied.listingPatch, now);
  const links = described.id ? issueLinks(described, now.getTime()) : null;
  const saved = describeRequest({ ...described, ...applied.request });
  const visitorBody = buildVisitorStatusMessage(saved, action, links || {});
  if (visitorBody && !['remind', 'sold', 'let_agreed', 'under_offer', 'still_available'].includes(action)) {
    await deliverPlain(services.deliverWhatsapp, {
      to: saved.visitor_phone,
      body: visitorBody,
      kind: `agent_booking_${action}`,
      leadId: saved.lead_id,
      nonce: `${saved.id}:${action}`
    });
  }
  return { ok: true, request: saved, agentAck: buildAgentAck(saved, action, links), visitorBody };
}

async function findOpenRequestsForAgentPhone(db, phone) {
  const tail = phoneTail(phone);
  if (!tail) return [];
  const result = await db.query(
    `/* agent-booking:pending-agent */
     SELECT r.*, p.title AS property_title, p.area, p.district, p.bedrooms, p.property_type,
            p.inquiry_reference, a.full_name AS agent_name, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
            COALESCE((SELECT preferred_language FROM users WHERE id = a.user_id), 'en') AS agent_preferred_language
       FROM agent_booking_requests r
       JOIN agents a ON a.id = r.agent_id
       LEFT JOIN properties p ON p.id = r.listing_id
      WHERE r.status IN ('pending', 'reschedule', 'no_response', 'escalated')
        AND (
          right(regexp_replace(COALESCE(r.sent_to_phone, ''), '\\D', '', 'g'), 9) = $1
          OR right(regexp_replace(COALESCE(a.whatsapp, ''), '\\D', '', 'g'), 9) = $1
          OR right(regexp_replace(COALESCE(a.phone, ''), '\\D', '', 'g'), 9) = $1
        )
      ORDER BY r.created_at DESC
      LIMIT 8`,
    [tail]
  );
  return result.rows.map((row) => describeRequest(row));
}

function whichRequestMessage(rows) {
  const lines = ['Which request? Reply with the number and the reference.', 'Example: 1 A7'];
  rows.forEach((row) => {
    lines.push(`${row.public_ref || 'request'} — ${text(row.visitor_name, 'Visitor')}, ${text(row.property_label, row.intent)}`);
  });
  return lines.join('\n');
}

async function findOutcomeForVisitorPhone(db, phone) {
  const tail = phoneTail(phone);
  if (!tail) return null;
  const result = await db.query(
    `/* agent-booking:outcome-visitor */
     SELECT r.*, p.title AS property_title, p.area, p.district, p.bedrooms, p.property_type,
            a.full_name AS agent_name,
            COALESCE((SELECT preferred_language FROM users WHERE id = a.user_id), 'en') AS agent_preferred_language
       FROM agent_booking_requests r
       LEFT JOIN properties p ON p.id = r.listing_id
       LEFT JOIN agents a ON a.id = r.agent_id
      WHERE r.status = 'confirmed'
        AND r.outcome_asked_at IS NOT NULL
        AND right(regexp_replace(COALESCE(r.visitor_phone, ''), '\\D', '', 'g'), 9) = $1
      ORDER BY r.outcome_asked_at DESC
      LIMIT 1`,
    [tail]
  );
  return result.rows[0] ? describeRequest(result.rows[0]) : null;
}

async function applyWeeklyReply(db, phone, weekly, { dryRun = false } = {}) {
  const tail = phoneTail(phone);
  if (!tail || !weekly?.action) return { handled: false };
  const agents = await db.query(
    `/* agent-booking:weekly-by-phone */
     SELECT id, full_name FROM agents
      WHERE status = 'approved'
        AND (
          right(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 9) = $1
          OR right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) = $1
        )
      LIMIT 1`,
    [tail]
  );
  const agent = agents.rows[0];
  if (!agent) return { handled: false };
  const checkin = await db.query(
    `/* agent-booking:weekly-open */
     SELECT week_key FROM listing_availability_checkins
      WHERE agent_id = $1
      ORDER BY sent_at DESC
      LIMIT 1`,
    [agent.id]
  );
  if (!checkin.rows.length) return { handled: false };
  const listings = await db.query(
    `/* agent-booking:weekly-reply-listings */
     SELECT id, title, area, district, bedrooms, property_type
       FROM properties
      WHERE agent_id = $1 AND LOWER(COALESCE(status, '')) = 'approved'
      ORDER BY created_at DESC
      LIMIT 12`,
    [agent.id]
  );
  if (!listings.rows.length) return { handled: false };
  let index = Number(weekly.listingIndex) || 0;
  if (!index) {
    if (listings.rows.length > 1) {
      const lines = [
        'Which listing? Reply with the listing number then the status number, for example 2 4.',
        '1 Still available, 2 Under offer, 3 Let agreed, 4 Sold.'
      ];
      listings.rows.forEach((listing, item) => lines.push(`${item + 1}. ${propertyLabel(listing)}`));
      return { handled: true, message: lines.join('\n') };
    }
    index = 1;
  }
  const listing = listings.rows[index - 1];
  if (!listing) return { handled: true, message: 'That listing number is not in this week\'s check-in.' };
  const status = weekly.action === 'still_available' ? 'available' : weekly.action;
  if (!dryRun) await touchListing(db, { id: listing.id, availability_status: status, touch: true }, new Date());
  const names = { available: 'Still available', under_offer: 'Under offer', let_agreed: 'Let agreed', sold: 'Sold' };
  return { handled: true, dry_run: Boolean(dryRun), message: `${propertyLabel(listing)}: ${names[status] || 'Saved.'}` };
}

async function handleAgentBookingReply(db, { phone, body, dryRun = false } = {}, deps = {}) {
  const parsed = parseAgentReply(body);
  const weekly = parseWeeklyReply(body);
  const agentActions = ['confirm', 'reschedule', 'decline', 'sold', 'let_agreed'];
  if (parsed && agentActions.includes(parsed.action)) {
    const rows = await findOpenRequestsForAgentPhone(db, phone);
    const matches = parsed.ref
      ? rows.filter((row) => String(row.public_ref || '').toUpperCase() === parsed.ref)
      : rows;
    if (parsed.ref && !matches.length) {
      const known = rows.map((row) => row.public_ref).filter(Boolean);
      return {
        handled: true,
        message: known.length ? `No open request ${parsed.ref}. Open ones: ${known.join(', ')}.` : `No open request ${parsed.ref}.`
      };
    }
    if (!parsed.ref && rows.length > 1 && ['confirm', 'reschedule', 'decline'].includes(parsed.action)) {
      return { handled: true, message: whichRequestMessage(rows) };
    }
    const row = matches[0] || null;
    if (row) {
      if (dryRun) return { handled: true, dry_run: true, message: '', request: { id: row.id, action: parsed.action } };
      const result = await applyStoredAction(db, row, parsed.action, {}, deps);
      return { handled: true, message: result.agentAck || result.error || '', request: result.request || null };
    }
  }
  if (parsed && String(parsed.action).startsWith('outcome_')) {
    const row = await findOutcomeForVisitorPhone(db, phone);
    if (row) {
      if (dryRun) return { handled: true, dry_run: true, message: '', request: { id: row.id, action: parsed.action } };
      const result = await applyStoredAction(db, row, parsed.action, {}, deps);
      return { handled: true, message: result.ok ? 'Thank you. That is saved.' : (result.error || ''), request: result.request || null };
    }
  }
  if (weekly) return applyWeeklyReply(db, phone, weekly, { dryRun });
  return { handled: false };
}

function icsFor(request) {
  const when = request.preferred_time && request.preferred_time !== 'any'
    ? slotInstant(String(request.preferred_date).slice(0, 10), request.preferred_time, bookingConfig().timezone)
    : null;
  if (!when) return '';
  const stamp = when.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const end = new Date(when.getTime() + 60 * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const summary = `Viewing: ${text(request.property_label || request.property_title, 'makaug property')}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//makaug//agent booking//EN',
    'BEGIN:VEVENT',
    `UID:${request.id}@makaug.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${stamp}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

let phrasePacks = null;
function phrase(lang, english) {
  const code = text(lang, 'en').toLowerCase();
  if (!english || code === 'en') return english;
  if (!phrasePacks) {
    phrasePacks = {};
    ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'].forEach((item) => {
      try {
        phrasePacks[item] = require(`../assets/i18n/site-${item}.json`).phrases || {};
      } catch (_error) {
        phrasePacks[item] = {};
      }
    });
  }
  return phrasePacks[code]?.[english] || english;
}

function renderTokenPage({ title, body, lang = 'en', form = null }) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const formHtml = form ? `
    <form method="post">
      <label>${escapeHtml(phrase(lang, 'Pick a day'))}<input type="date" name="preferred_date" required value="${escapeHtml(form.date || '')}"></label>
      <label>${escapeHtml(phrase(lang, 'Pick a time'))}<input type="time" name="preferred_time" required value="${escapeHtml(form.time || '')}"></label>
      <button type="submit">${escapeHtml(phrase(lang, form.submit || 'Suggest a new time'))}</button>
    </form>` : '';
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: "Plus Jakarta Sans", system-ui, sans-serif; background: #f0fdf4; color: #14532d; }
    main { max-width: 32rem; margin: 2rem auto; background: #fff; border: 1px solid #bbf7d0; border-radius: 20px; padding: 1.25rem; }
    h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
    p { line-height: 1.45; }
    label { display: grid; gap: .25rem; font-weight: 700; margin: .75rem 0; }
    input { border: 1px solid #bbf7d0; border-radius: 12px; padding: .7rem .8rem; font: inherit; }
    button { background: #15803d; color: #fff; border: 0; border-radius: 999px; padding: .8rem 1rem; font-weight: 800; width: 100%; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    ${formHtml}
  </main>
</body>
</html>`;
}

async function openToken(db, token, { method = 'GET', purpose = '', body = {}, lang = 'en' } = {}, deps = {}) {
  const payload = readToken(token);
  if (payload && (payload.stay || payload.stay_listing)) {
    const stay = require('./shortTermBookingService');
    return stay.openStayToken(db, payload, { method, purpose, body, lang }, deps);
  }
  if (!payload) {
    return {
      status: 410,
      contentType: 'text/html; charset=utf-8',
      body: renderTokenPage({ title: phrase(lang, 'This link has expired.'), body: phrase(lang, 'Ask for a new link.'), lang })
    };
  }
  if (payload.listing_id && ['still_available', 'under_offer', 'let_agreed', 'sold'].includes(payload.action)) {
    if (!shouldApplyOnOpen({ method, purpose, action: payload.action })) {
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: renderTokenPage({
          title: phrase(lang, 'Still available'),
          body: phrase(lang, 'Open this link again to save the listing status.'),
          lang
        })
      };
    }
    const status = payload.action === 'still_available' ? 'available' : payload.action;
    await touchListing(db, { id: payload.listing_id, availability_status: status, touch: true }, new Date());
    const titles = { available: 'Still available', under_offer: 'Under offer', let_agreed: 'Let agreed', sold: 'Sold' };
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: renderTokenPage({ title: phrase(lang, titles[status] || 'Saved'), body: phrase(lang, 'Saved.'), lang })
    };
  }
  const request = payload.bid ? await loadRequest(db, payload.bid) : null;
  if (!request) {
    return {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: renderTokenPage({ title: phrase(lang, 'This link has expired.'), body: phrase(lang, 'Ask for a new link.'), lang })
    };
  }
  if (payload.action === 'calendar') {
    const ics = icsFor(request);
    if (!ics) {
      return { status: 409, contentType: 'text/plain; charset=utf-8', body: 'This request has no fixed time.' };
    }
    return { status: 200, contentType: 'text/calendar; charset=utf-8', body: ics };
  }
  if (payload.action === 'reschedule' || payload.action === 'visitor_reschedule') {
    if (String(method).toUpperCase() === 'POST') {
      const date = text(body.preferred_date);
      const time = normaliseClock(body.preferred_time);
      if (!date || !time) {
        return {
          status: 400,
          contentType: 'text/html; charset=utf-8',
          body: renderTokenPage({
            title: phrase(lang, 'Suggest a new time'),
            body: phrase(lang, 'Choose a property, a day and a time.'),
            lang,
            form: { date, time, submit: 'Suggest a new time' }
          })
        };
      }
      const result = await applyStoredAction(db, request, 'reschedule', { proposed_date: date, proposed_time: time }, deps);
      return {
        status: result.ok ? 200 : 409,
        contentType: 'text/html; charset=utf-8',
        body: renderTokenPage({
          title: phrase(lang, result.ok ? 'New time saved' : 'This request is already closed.'),
          body: result.ok ? formatWhen(date, time) : (result.error || ''),
          lang
        })
      };
    }
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: renderTokenPage({
        title: phrase(lang, 'Suggest a new time'),
        body: text(request.property_label || request.property_title),
        lang,
        form: { date: String(request.preferred_date || '').slice(0, 10), time: normaliseClock(request.preferred_time), submit: 'Suggest a new time' }
      })
    };
  }
  if (!shouldApplyOnOpen({ method, purpose, action: payload.action })) {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: renderTokenPage({
        title: phrase(lang, 'Confirm this viewing'),
        body: text(request.when_label || request.property_label),
        lang
      })
    };
  }
  const result = await applyStoredAction(db, request, payload.action, {}, deps);
  const title = result.ok ? phrase(lang, result.agentAck ? 'Saved.' : 'Saved.') : phrase(lang, 'This request is already closed.');
  return {
    status: result.ok ? 200 : 409,
    contentType: 'text/html; charset=utf-8',
    body: renderTokenPage({ title, body: result.ok ? (result.agentAck || result.visitorBody || 'Saved.') : (result.error || ''), lang })
  };
}

async function tickAgentBookings(db, now = new Date(), deps = {}) {
  const config = bookingConfig();
  const services = sendDeps(deps);
  const due = await db.query(
    `/* agent-booking:due */
     SELECT r.*, p.title AS property_title, p.area, p.district, p.bedrooms, p.property_type,
            p.inquiry_reference, a.full_name AS agent_name, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
            COALESCE((SELECT preferred_language FROM users WHERE id = a.user_id), 'en') AS agent_preferred_language
       FROM agent_booking_requests r
       LEFT JOIN properties p ON p.id = r.listing_id
       LEFT JOIN agents a ON a.id = r.agent_id
      WHERE r.status IN ('pending', 'reschedule', 'confirmed', 'escalated')
        AND r.created_at > NOW() - INTERVAL '21 days'
      ORDER BY r.created_at ASC
      LIMIT 200`
  );
  const summary = { reminded: 0, escalated: 0, visitor_reminders: 0, outcomes: 0, weekly: 0 };
  let bookingRowsSeen = 0;
  for (const row of due.rows) {
    if (bookingRowsSeen > 0 && bookingRowsSeen % 5 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    bookingRowsSeen += 1;
    const request = describeRequest(row, config);
    const actions = dueActions(request, now, config);
    for (const action of actions) {
      if (action === 'remind') {
        const applied = applyReply(request, 'remind', {}, now);
        if (!applied.ok) continue;
        Object.assign(request, applied.request);
        await saveRequest(db, request);
        const links = issueLinks(request, now.getTime());
        await deliverPlain(services.deliverWhatsapp, {
          to: request.agent_whatsapp || request.agent_phone,
          body: buildAgentAck(request, 'remind', links),
          kind: 'agent_booking_reminder',
          leadId: request.lead_id,
          nonce: `${request.id}:remind`
        });
        summary.reminded += 1;
      } else if (action === 'escalate') {
        const applied = applyReply(request, 'escalate', {}, now);
        if (!applied.ok) continue;
        Object.assign(request, applied.request);
        await saveRequest(db, request);
        const targets = escalationTargets();
        const body = buildEscalationMessage(request);
        await flagStaff(db, {
          bookingId: request.id,
          listingId: request.listing_id,
          kind: 'escalation',
          message: body
        });
        for (const target of targets) {
          await deliverPlain(services.deliverWhatsapp, {
            to: target,
            body,
            kind: 'agent_booking_escalation',
            leadId: request.lead_id,
            nonce: `${request.id}:escalate:${phoneTail(target)}`
          });
        }
        await deliverPlain(services.deliverWhatsapp, {
          to: request.visitor_phone,
          body: buildVisitorStatusMessage(request, 'escalate'),
          kind: 'agent_booking_escalation_visitor',
          leadId: request.lead_id,
          nonce: `${request.id}:escalate:visitor`
        });
        summary.escalated += 1;
      } else if (action === 'remind_visitor_24h' || action === 'remind_visitor_2h') {
        const column = action === 'remind_visitor_24h' ? 'visitor_reminder_24h_at' : 'visitor_reminder_2h_at';
        request[column] = now.toISOString();
        await saveRequest(db, request);
        await deliverPlain(services.deliverWhatsapp, {
          to: request.visitor_phone,
          body: buildVisitorStatusMessage(request, action),
          kind: `agent_booking_${action}`,
          leadId: request.lead_id,
          nonce: `${request.id}:${action}`
        });
        summary.visitor_reminders += 1;
      } else if (action === 'ask_outcome') {
        request.outcome_asked_at = now.toISOString();
        await saveRequest(db, request);
        await deliverPlain(services.deliverWhatsapp, {
          to: request.visitor_phone,
          body: buildVisitorStatusMessage(request, action),
          kind: 'agent_booking_outcome',
          leadId: request.lead_id,
          nonce: `${request.id}:outcome`
        });
        summary.outcomes += 1;
      } else if (action === 'realert') {
        request.staff_alerted_at = now.toISOString();
        await saveRequest(db, request);
        const body = buildEscalationMessage(request);
        await flagStaff(db, {
          bookingId: request.id,
          listingId: request.listing_id,
          kind: 'escalation_realert',
          message: body
        });
        for (const target of escalationTargets()) {
          await deliverPlain(services.deliverWhatsapp, {
            to: target,
            body,
            kind: 'agent_booking_escalation_realert',
            leadId: request.lead_id,
            nonce: `${request.id}:realert:${phoneTail(target)}:${request.staff_alerted_at}`
          });
        }
        summary.realerts = (summary.realerts || 0) + 1;
      }
    }
  }
  // Off unless AGENT_WEEKLY_CHECKIN_ENABLED is true. No query, send, or
  // check-in row while paused, so a later week can still catch up.
  if (config.weeklyCheckinEnabled && shouldCatchUpWeekly(now, config)) {
    const key = weekKey(now, config);
    const agents = await db.query(
      `/* agent-booking:weekly-agents */
       SELECT a.id, a.full_name, a.phone, a.whatsapp
         FROM agents a
        WHERE a.status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM listing_availability_checkins c
             WHERE c.agent_id = a.id AND c.week_key = $1
          )
          AND EXISTS (
            SELECT 1 FROM properties p
             WHERE p.agent_id = a.id AND LOWER(COALESCE(p.status, '')) = 'approved'
          )
        LIMIT 50`,
      [key]
    );
    for (const agent of agents.rows) {
      const listings = await db.query(
        `/* agent-booking:weekly-listings */
         SELECT id, title, area, district, bedrooms, property_type
           FROM properties
          WHERE agent_id = $1 AND LOWER(COALESCE(status, '')) = 'approved'
          ORDER BY created_at DESC
          LIMIT 12`,
        [agent.id]
      );
      if (!listings.rows.length) continue;
      const linkSets = listings.rows.map((listing) => issueListingLinks(listing, agent.id, now.getTime()));
      const body = buildWeeklyMessage(agent, listings.rows, linkSets);
      await deliverPlain(services.deliverWhatsapp, {
        to: agent.whatsapp || agent.phone,
        body,
        kind: 'agent_booking_weekly',
        nonce: `${agent.id}:${key}`
      });
      await db.query(
        `/* agent-booking:weekly-mark */
         INSERT INTO listing_availability_checkins (agent_id, week_key) VALUES ($1, $2)
         ON CONFLICT (agent_id, week_key) DO NOTHING`,
        [agent.id, key]
      );
      summary.weekly += 1;
    }
  }
  try {
    const stay = require('./shortTermBookingService');
    summary.stay = await stay.sweepStayReplyLoop(db, now, deps);
  } catch (error) {
    logger.warn('Stay reply sweep skipped', { message: error.message });
  }
  return summary;
}

let schedulerTimer = null;
function startAgentBookingScheduler(db) {
  if (schedulerTimer || !process.env.DATABASE_URL || !bookingConfig().schedulerEnabled) return;
  const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');
  const { runBackgroundWork } = require('../config/database');
  const pollMs = bookingConfig().pollMs;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runBackgroundWork(() => tickAgentBookings(db)).catch((error) => {
      logger.error('Agent booking tick failed', { error: error.message });
    }).finally(() => {
      running = false;
    });
  };
  schedulerTimer = setInterval(run, pollMs);
  schedulerTimer.unref?.();
  setTimeout(run, BOOT_DELAY_MS.agent_booking).unref?.();
  logger.info('Agent booking scheduler armed', {
    pollMs,
    catchUp: true,
    quietHours: bookingConfig().quietHours,
    escalationTargets: escalationTargets().length,
    realertHours: bookingConfig().realertHours,
    weeklyCheckinEnabled: bookingConfig().weeklyCheckinEnabled
  });
}

async function loadResponseTimeLabel(db, agentId) {
  try {
    const samples = await db.query(
      `/* agent-booking:response-times */
       SELECT EXTRACT(EPOCH FROM (first_response_at - created_at)) AS seconds
         FROM agent_booking_requests
        WHERE agent_id = $1 AND first_response_at IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 30`,
      [agentId]
    );
    return responseTimeLabel(samples.rows.map((row) => Number(row.seconds)));
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') return '';
    throw error;
  }
}

module.exports = {
  AVAILABILITY,
  INTENTS,
  STATUSES,
  appointmentInstant,
  applyReply,
  availabilityView,
  bookingConfig,
  buildAgentAck,
  buildAgentRequestMessage,
  buildBookingCalendar: buildDaysAndSlots,
  buildDaysAndSlots,
  buildEscalationMessage,
  buildVisitorRequestMessage,
  buildVisitorSkippedMessage,
  buildVisitorStatusMessage,
  buildWeeklyMessage,
  clipNote,
  formatOfferUgx,
  createAgentBooking,
  dueActions,
  escalateDueAt,
  escalationTargets,
  flagStaff,
  formatWhen,
  handleAgentBookingReply,
  handoffReached,
  isQuietHours,
  loadResponseTimeLabel,
  makeShortRef,
  parseOfferUgx,
  parseWeeklyReply,
  issueLinks,
  issueListingLinks,
  issueStayLinks,
  issueStayListingLinks,
  phrase,
  mergeSchedule,
  openToken,
  parseAgentReply,
  propertyLabel,
  publicStaleAvailabilitySql,
  readToken,
  realertDue,
  reminderDueAt,
  responseTimeLabel,
  shouldApplyOnOpen,
  shouldCatchUpWeekly,
  shouldSendWeekly,
  signToken,
  slotIsOpen,
  startAgentBookingScheduler,
  tickAgentBookings,
  viewingAcceptsBookings,
  weekKey
};
