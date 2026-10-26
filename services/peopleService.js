'use strict';

// The master contact list ("people"). One row per person, keyed by their
// E.164 phone (email only when there is no phone), linked to the rows they
// came from. The list is derived: people_reconcile() in the database
// (migration 188) recomputes it from users, contacts, leads,
// whatsapp_user_profiles and property_seeker_profiles and writes only what
// changed. This file decides when to run it and serves the list to staff.
//
// Logs carry counts and ids only, never a name, number or email.

const logger = require('../config/logger');

const ROLES = Object.freeze(['home_seeker', 'agent', 'owner_advertiser', 'lead', 'whatsapp_contact', 'staff']);
const SOURCES = Object.freeze(['users', 'contacts', 'leads', 'whatsapp_user_profiles', 'property_seeker_profiles']);
const CONSENT = Object.freeze(['consented', 'opted_out', 'unverified_flag', 'legitimate_interest', 'none']);
const SORTS = Object.freeze({
  last_activity: 'p.last_activity_at DESC NULLS LAST, p.id',
  first_seen: 'p.first_seen_at DESC NULLS LAST, p.id',
  oldest_activity: 'p.last_activity_at ASC NULLS LAST, p.id',
  name: "lower(COALESCE(p.display_name, '~')) ASC, p.id"
});
const DATE_FIELDS = Object.freeze({ last_activity: 'p.last_activity_at', first_seen: 'p.first_seen_at' });

const POLL_MS = Number(process.env.PEOPLE_POLL_MS || 90_000);
const DEBOUNCE_MS = Number(process.env.PEOPLE_DEBOUNCE_MS || 15_000);
const NIGHTLY_HOUR_LONDON = 3;
const NIGHTLY_MINUTE_LONDON = 15;
const CSV_MAX_ROWS = 20_000;

const state = {
  db: null,
  countryCode: 'UG',
  debounceTimer: null,
  pollTimer: null,
  running: null,
  pendingTrigger: null,
  lastFingerprint: null,
  lastNightlyDate: null
};

function defaultCallingCode(countryCode = state.countryCode) {
  return String(countryCode || '').toUpperCase() === 'ZA' ? '27' : '256';
}

function londonParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    dateKey: `${pick('year')}-${pick('month')}-${pick('day')}`,
    hour: Number(pick('hour')) % 24,
    minute: Number(pick('minute') || 0)
  };
}

function summarizeStats(stats = {}) {
  return {
    trigger: stats.trigger,
    people: stats.people,
    merged_duplicates: stats.merged_duplicates,
    consented: stats.consent?.consented || 0,
    written: stats.written,
    duration_ms: stats.duration_ms,
    skipped: stats.skipped
  };
}

async function reconcilePeople(db, trigger = 'manual', { countryCode } = {}) {
  const database = db || state.db;
  if (!database) return { skipped: 'no_database' };
  const { runBackgroundWork } = require('../config/database');
  const run = () => database.query(
    'SELECT people_reconcile($1, $2) AS stats',
    [String(trigger).slice(0, 60), defaultCallingCode(countryCode)]
  );
  const result = await (typeof runBackgroundWork === 'function' ? runBackgroundWork(run) : run());
  const stats = { trigger, ...(result.rows?.[0]?.stats || {}) };
  logger.info('People list reconciled', summarizeStats(stats));
  return stats;
}

// Coalesces bursts (a sign-up writes users, contacts and a lead in one go)
// into one reconcile a few seconds later. Never throws.
function schedulePeopleRefresh(trigger = 'event') {
  if (!state.db) return false;
  state.pendingTrigger = state.pendingTrigger || trigger;
  if (state.debounceTimer) return true;
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    const why = state.pendingTrigger || trigger;
    state.pendingTrigger = null;
    runExclusive(why);
  }, DEBOUNCE_MS);
  state.debounceTimer.unref?.();
  return true;
}

function runExclusive(trigger) {
  if (state.running) {
    state.pendingTrigger = state.pendingTrigger || trigger;
    return state.running;
  }
  state.running = reconcilePeople(state.db, trigger)
    .catch((error) => {
      logger.warn('People list reconcile failed', { trigger, message: error.message });
      return null;
    })
    .finally(() => {
      state.running = null;
      if (state.pendingTrigger) schedulePeopleRefresh(state.pendingTrigger);
    });
  return state.running;
}

// A cheap fingerprint of the source tables: row counts and newest change.
// When it moves, something was added or updated (a sign-up, a lead, a
// WhatsApp profile update) and the list is reconciled. This is how WhatsApp
// profile changes are picked up without touching the WhatsApp code.
const FINGERPRINT_SQL = `
  SELECT concat_ws('|',
    (SELECT count(*) || ':' || COALESCE(max(GREATEST(created_at, updated_at, last_login_at))::text, '') FROM users),
    (SELECT count(*) || ':' || COALESCE(max(GREATEST(created_at, updated_at))::text, '') FROM contacts),
    (SELECT count(*) || ':' || COALESCE(max(GREATEST(created_at, updated_at, last_contacted_at))::text, '') FROM leads),
    (SELECT count(*) || ':' || COALESCE(max(GREATEST(created_at, updated_at, last_seen_at))::text, '') FROM whatsapp_user_profiles),
    (SELECT count(*) || ':' || COALESCE(max(GREATEST(created_at, updated_at))::text, '') FROM property_seeker_profiles),
    (SELECT count(*) || ':' || COALESCE(max(GREATEST(created_at, updated_at))::text, '') FROM saved_searches),
    (SELECT count(*)::text FROM saved_properties)
  ) AS fingerprint`;

async function sourceFingerprint(db = state.db) {
  const { runBackgroundWork } = require('../config/database');
  const run = () => db.query(FINGERPRINT_SQL);
  const result = await (typeof runBackgroundWork === 'function' ? runBackgroundWork(run) : run());
  return result.rows?.[0]?.fingerprint || '';
}

async function pollTick(now = new Date()) {
  if (!state.db) return null;
  const london = londonParts(now);
  const nightlyDue = london.dateKey !== state.lastNightlyDate
    && (london.hour > NIGHTLY_HOUR_LONDON || (london.hour === NIGHTLY_HOUR_LONDON && london.minute >= NIGHTLY_MINUTE_LONDON));
  if (nightlyDue && state.lastNightlyDate !== null) {
    state.lastNightlyDate = london.dateKey;
    return runExclusive('nightly');
  }
  if (state.lastNightlyDate === null) state.lastNightlyDate = nightlyDue ? london.dateKey : 'boot';
  const fingerprint = await sourceFingerprint();
  if (state.lastFingerprint === null) {
    state.lastFingerprint = fingerprint;
    return runExclusive('boot');
  }
  if (fingerprint !== state.lastFingerprint) {
    state.lastFingerprint = fingerprint;
    return runExclusive('source_change');
  }
  return null;
}

function startPeopleScheduler(db, { countryCode = 'UG', bootDelayMs = 0 } = {}) {
  state.db = db;
  state.countryCode = countryCode;
  if (state.pollTimer || process.env.NODE_ENV === 'test' || process.env.PEOPLE_RECONCILE === 'off') return false;
  const tick = () => pollTick().catch((error) => logger.warn('People list poll failed', { message: error.message }));
  setTimeout(tick, bootDelayMs).unref?.();
  state.pollTimer = setInterval(tick, POLL_MS);
  state.pollTimer.unref?.();
  return true;
}

function stopPeopleSchedulerForTests() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  Object.assign(state, {
    db: null, debounceTimer: null, pollTimer: null, running: null, pendingTrigger: null,
    lastFingerprint: null, lastNightlyDate: null
  });
}

function bindPeopleDb(db, countryCode) {
  state.db = db;
  if (countryCode) state.countryCode = countryCode;
}

function oneOf(value, allowed) {
  const v = String(value || '').trim().toLowerCase();
  return allowed.includes(v) ? v : '';
}

function parseDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function parsePeopleFilters(query = {}) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return {
    q: String(query.q || '').trim().slice(0, 120),
    role: oneOf(query.role, ROLES),
    source: oneOf(query.source, SOURCES),
    consent: oneOf(query.consent, CONSENT),
    dateField: oneOf(query.date_field, Object.keys(DATE_FIELDS)) || 'last_activity',
    from: parseDate(query.from),
    to: parseDate(query.to),
    sort: oneOf(query.sort, Object.keys(SORTS)) || 'last_activity',
    limit,
    page,
    offset: (page - 1) * limit
  };
}

function buildPeopleWhere(filters) {
  const where = [];
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  if (filters.q) {
    const like = add(`%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    // A local number is typed with its trunk 0 (0772…); stored numbers are +256772….
    const digits = filters.q.replace(/\D/g, '').replace(/^0+/, '');
    const parts = [`p.display_name ILIKE ${like}`, `p.email ILIKE ${like}`];
    if (digits.length >= 3) {
      const tail = digits.length > 9 ? digits.slice(-9) : digits;
      parts.push(`p.phone_e164 LIKE ${add(`%${tail}%`)}`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (filters.role) where.push(`${add(filters.role)} = ANY(p.roles)`);
  if (filters.source) where.push(`${add(filters.source)} = ANY(p.sources)`);
  if (filters.consent) where.push(`p.consent_status = ${add(filters.consent)}`);
  const dateColumn = DATE_FIELDS[filters.dateField] || DATE_FIELDS.last_activity;
  if (filters.from) where.push(`${dateColumn} >= ${add(filters.from)}::date`);
  if (filters.to) where.push(`${dateColumn} < (${add(filters.to)}::date + 1)`);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const LIST_COLUMNS = `
  p.id, p.display_name, p.phone_e164, p.email, p.key_kind, p.roles, p.sources, p.source_row_count,
  p.first_seen_at, p.last_activity_at, p.saves_count, p.alerts_count, p.leads_count,
  p.consent_status, p.consent_source, p.consent_at, p.assigned_staff_user_id, p.user_id, p.updated_at,
  NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), '') AS assigned_staff_name`;

async function listPeople(db, query = {}) {
  const filters = parsePeopleFilters(query);
  const { sql, params } = buildPeopleWhere(filters);
  const listParams = [...params, filters.limit, filters.offset];
  const [rows, total, meta] = await Promise.all([
    db.query(
      `SELECT ${LIST_COLUMNS}
       FROM people p
       LEFT JOIN users s ON s.id = p.assigned_staff_user_id
       ${sql}
       ORDER BY ${SORTS[filters.sort]}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    ),
    db.query(`SELECT count(*)::int AS n FROM people p ${sql}`, params),
    peopleListMeta(db)
  ]);
  return {
    rows: rows.rows,
    total: total.rows[0]?.n || 0,
    page: filters.page,
    limit: filters.limit,
    filters: { ...filters, offset: undefined },
    meta
  };
}

async function peopleListMeta(db) {
  const [runs, counts] = await Promise.all([
    db.query(
      `SELECT
         (SELECT max(finished_at) FROM people_reconcile_runs WHERE ok) AS last_reconciled_at,
         (SELECT trigger FROM people_reconcile_runs WHERE ok ORDER BY finished_at DESC NULLS LAST LIMIT 1) AS last_trigger,
         (SELECT max(updated_at) FROM people) AS last_changed_at`
    ),
    db.query(
      `SELECT count(*)::int AS people,
              count(*) FILTER (WHERE consent_status = 'consented')::int AS consented,
              count(*) FILTER (WHERE consent_status = 'opted_out')::int AS opted_out,
              count(*) FILTER (WHERE consent_status = 'unverified_flag')::int AS unverified_flag,
              count(*) FILTER (WHERE cardinality(sources) > 1)::int AS in_several_sources
       FROM people`
    )
  ]);
  return { ...(runs.rows[0] || {}), counts: counts.rows[0] || {} };
}

async function latestDedupeReport(db) {
  const result = await db.query(
    `SELECT trigger, finished_at, stats FROM people_reconcile_runs
     WHERE ok ORDER BY finished_at DESC NULLS LAST LIMIT 1`
  );
  return result.rows[0] || null;
}

// One person, their linked rows and a dated history built from those rows.
async function getPersonDetail(db, personId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(personId || ''))) return null;
  const personResult = await db.query(
    `SELECT ${LIST_COLUMNS}, p.consent_detail, p.created_at
     FROM people p LEFT JOIN users s ON s.id = p.assigned_staff_user_id
     WHERE p.id = $1`,
    [personId]
  );
  const person = personResult.rows[0];
  if (!person) return null;
  const linksResult = await db.query(
    `SELECT source_table, source_id, role, first_seen_at, last_activity_at, linked_at
     FROM people_links WHERE person_id = $1 ORDER BY last_activity_at DESC NULLS LAST`,
    [personId]
  );
  const links = linksResult.rows;
  const idsFor = (table) => links.filter((l) => l.source_table === table).map((l) => l.source_id);
  const userIds = idsFor('users');
  const leadIds = idsFor('leads');
  const contactIds = idsFor('contacts');
  const waPhones = idsFor('whatsapp_user_profiles');
  const seekerIds = idsFor('property_seeker_profiles');

  const empty = { rows: [] };
  const [users, leads, activities, contacts, wa, seekers, searches, saves] = await Promise.all([
    userIds.length ? db.query(
      `SELECT id, role, status, created_at, last_login_at, preferred_contact_channel
       FROM users WHERE id::text = ANY($1)`, [userIds]) : empty,
    leadIds.length ? db.query(
      `SELECT l.id, l.source, l.lead_type, l.lead_status, l.category, l.location, l.created_at, l.updated_at,
              l.last_contacted_at, l.assigned_to_user_id,
              NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), '') AS assigned_staff_name
       FROM leads l LEFT JOIN users s ON s.id = l.assigned_to_user_id
       WHERE l.id::text = ANY($1) ORDER BY l.created_at DESC LIMIT 200`, [leadIds]) : empty,
    leadIds.length ? db.query(
      `SELECT lead_id, activity_type, actor_type, old_status, new_status, created_at
       FROM lead_activities WHERE lead_id::text = ANY($1) ORDER BY created_at DESC LIMIT 200`, [leadIds]) : empty,
    contactIds.length ? db.query(
      `SELECT id, role_type, consent_status, marketing_consent, whatsapp_consent, sms_consent, created_at, updated_at
       FROM contacts WHERE id::text = ANY($1)`, [contactIds]) : empty,
    waPhones.length ? db.query(
      `SELECT preferred_language, marketing_opt_in, marketing_opt_in_at, marketing_opt_out_at, opt_in_source,
              created_at, last_seen_at
       FROM whatsapp_user_profiles WHERE phone = ANY($1)`, [waPhones]) : empty,
    seekerIds.length ? db.query(
      `SELECT id, seeker_type, current_goal, marketing_consent, whatsapp_consent, email_alert_consent, created_at, updated_at
       FROM property_seeker_profiles WHERE id::text = ANY($1)`, [seekerIds]) : empty,
    db.query(
      `SELECT id, category, location, status, alert_frequency, created_at, last_sent_at
       FROM saved_searches
       WHERE ($1::uuid IS NOT NULL AND user_id = $1::uuid)
          OR ($2::text IS NOT NULL AND user_id IS NULL AND people_normalize_phone(phone, $3) = $2::text)
       ORDER BY created_at DESC LIMIT 50`,
      [person.user_id, person.phone_e164, defaultCallingCode()]
    ),
    person.user_id ? db.query(
      `SELECT sp.property_id, sp.created_at, pr.title
       FROM saved_properties sp LEFT JOIN properties pr ON pr.id = sp.property_id
       WHERE sp.user_id = $1 ORDER BY sp.created_at DESC LIMIT 50`, [person.user_id]) : empty
  ]);

  const history = [];
  const push = (at, kind, label, detail = '') => { if (at) history.push({ at, kind, label, detail }); };
  for (const u of users.rows) {
    push(u.created_at, 'account', 'Account created', u.role);
    push(u.last_login_at, 'account', 'Last sign-in', '');
  }
  for (const c of contacts.rows) push(c.created_at, 'contact', 'Contact record created', c.role_type || '');
  for (const l of leads.rows) {
    push(l.created_at, 'lead', `Lead: ${String(l.lead_type || 'enquiry').replace(/_/g, ' ')}`,
      [l.source, l.lead_status, l.location].filter(Boolean).join(' · '));
  }
  for (const a of activities.rows) {
    push(a.created_at, 'lead_activity', `Lead ${String(a.activity_type || 'update').replace(/_/g, ' ')}`,
      [a.old_status && a.new_status ? `${a.old_status} → ${a.new_status}` : '', a.actor_type].filter(Boolean).join(' · '));
  }
  for (const w of wa.rows) {
    push(w.created_at, 'whatsapp', 'First WhatsApp message', w.preferred_language || '');
    push(w.last_seen_at, 'whatsapp', 'Last WhatsApp message', '');
    push(w.marketing_opt_in_at, 'consent', 'Opted in on WhatsApp', w.opt_in_source || '');
    push(w.marketing_opt_out_at, 'consent', 'Opted out on WhatsApp', '');
  }
  for (const s of seekers.rows) push(s.created_at, 'seeker', 'Home-seeker profile created', s.seeker_type || '');
  for (const s of searches.rows) push(s.created_at, 'alert', 'Saved search / alert', [s.category, s.location, s.status].filter(Boolean).join(' · '));
  for (const s of saves.rows) push(s.created_at, 'save', 'Saved a property', s.title || '');
  history.sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    person,
    links,
    sources: {
      users: users.rows,
      contacts: contacts.rows,
      leads: leads.rows,
      whatsapp_user_profiles: wa.rows,
      property_seeker_profiles: seekers.rows,
      saved_searches: searches.rows,
      saved_properties: saves.rows
    },
    history: history.slice(0, 300)
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join(';') : value instanceof Date ? value.toISOString() : String(value);
  // Spreadsheet formula injection: a cell that starts with = + - @ is text.
  // An E.164 number (+ then digits only) cannot run as a formula and stays as is.
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  'person_id', 'name', 'phone_e164', 'email', 'roles', 'sources', 'first_seen_at', 'last_activity_at',
  'saves_count', 'alerts_count', 'leads_count', 'consent_status', 'consent_source', 'consent_at', 'assigned_staff'
];

async function peopleCsv(db, query = {}) {
  const filters = { ...parsePeopleFilters(query), limit: CSV_MAX_ROWS, offset: 0 };
  const { sql, params } = buildPeopleWhere(filters);
  const result = await db.query(
    `SELECT ${LIST_COLUMNS} FROM people p LEFT JOIN users s ON s.id = p.assigned_staff_user_id
     ${sql} ORDER BY ${SORTS[filters.sort]} LIMIT ${CSV_MAX_ROWS}`,
    params
  );
  const lines = [CSV_HEADER.join(',')];
  for (const r of result.rows) {
    lines.push([
      r.id, r.display_name, r.phone_e164, r.email, r.roles, r.sources, r.first_seen_at, r.last_activity_at,
      r.saves_count, r.alerts_count, r.leads_count, r.consent_status, r.consent_source, r.consent_at,
      r.assigned_staff_name
    ].map(csvCell).join(','));
  }
  return { csv: `${lines.join('\r\n')}\r\n`, count: result.rows.length };
}

module.exports = {
  CONSENT,
  ROLES,
  SOURCES,
  bindPeopleDb,
  buildPeopleWhere,
  csvCell,
  defaultCallingCode,
  getPersonDetail,
  latestDedupeReport,
  listPeople,
  parsePeopleFilters,
  peopleCsv,
  pollTick,
  reconcilePeople,
  schedulePeopleRefresh,
  startPeopleScheduler,
  stopPeopleSchedulerForTests
};
