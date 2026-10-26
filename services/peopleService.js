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

// Quick filters for the clean-up (Arthur, 26 Oct 2026). "Looks like test"
// is a hint for a person to check, never an automatic delete: a test word
// on its own (not inside a longer name such as Testimony), keyboard mashing
// (five consonants in a row, or one letter four times), a test-looking
// email, or a phone of one repeated digit or a straight run.
const QUICK_FILTERS = Object.freeze(['unnamed', 'test']);
const QUICK_SQL = Object.freeze({
  unnamed: "NULLIF(btrim(COALESCE(p.display_name, '')), '') IS NULL",
  test: `(
    p.display_name ~* '\\m(test|testing|tester|demo|fake|dummy|sample|asdf|qwerty|lorem|xxx+)\\M'
    OR p.display_name ~* '[bcdfghjklmnpqrstvwxz]{5,}'
    OR p.display_name ~* '([a-z])\\1{3,}'
    OR p.email ~* '(^test|test[0-9]*@|@(test|example)\\.|mailinator|@x+\\.)'
    OR p.phone_e164 ~ '([0-9])\\1{5,}'
    OR p.phone_e164 ~ '(0123456|1234567|2345678|3456789|9876543)'
  )`
});

// Every 15 minutes. The poll only reads (seven index lookups); a full
// reconcile runs only when something moved, plus once a night. Never below
// five minutes, whatever the environment says.
const POLL_DEFAULT_MS = 15 * 60_000;
const POLL_MIN_MS = 5 * 60_000;
const POLL_MS = Math.max(POLL_MIN_MS, Number(process.env.PEOPLE_POLL_MS) || POLL_DEFAULT_MS);
const DEBOUNCE_MS = Number(process.env.PEOPLE_DEBOUNCE_MS || 15_000);
const NIGHTLY_HOUR_LONDON = 3;
const NIGHTLY_MINUTE_LONDON = 15;
const CSV_MAX_ROWS = 20_000;

const state = {
  db: null,
  countryCode: 'UG',
  debounceTimer: null,
  pollTimer: null,
  polling: false,
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

// A cheap fingerprint of the source tables: the newest change in each.
// When it moves, something was added or updated (a sign-up, a lead, a
// WhatsApp profile update) and the list is reconciled. This is how WhatsApp
// profile changes are picked up without touching the WhatsApp code.
// Each probe is max() over an expression that has its own index (migration
// 188), so it is one index lookup, never a table scan. Deletions are not
// seen here; the nightly full reconcile picks them up.
const FINGERPRINT_PROBES = Object.freeze([
  ['users', 'GREATEST(created_at, updated_at, last_login_at)'],
  ['contacts', 'GREATEST(created_at, updated_at)'],
  ['leads', 'GREATEST(created_at, updated_at, last_contacted_at)'],
  ['whatsapp_user_profiles', 'GREATEST(created_at, updated_at, last_seen_at)'],
  ['property_seeker_profiles', 'GREATEST(created_at, updated_at)'],
  ['saved_searches', 'GREATEST(created_at, updated_at)'],
  ['saved_properties', 'created_at']
]);
const FINGERPRINT_SQL = `
  SELECT concat_ws('|',
    ${FINGERPRINT_PROBES.map(([table, expr]) => `(SELECT COALESCE(max(${expr})::text, '') FROM ${table})`).join(',\n    ')}
  ) AS fingerprint`;

async function sourceFingerprint(db = state.db) {
  const { runBackgroundWork } = require('../config/database');
  const run = () => db.query(FINGERPRINT_SQL);
  const result = await (typeof runBackgroundWork === 'function' ? runBackgroundWork(run) : run());
  return result.rows?.[0]?.fingerprint || '';
}

async function pollTick(now = new Date()) {
  if (!state.db || state.polling) return null;
  state.polling = true;
  try {
    return await pollTickInner(now);
  } finally {
    state.polling = false;
  }
}

async function pollTickInner(now) {
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
    db: null, debounceTimer: null, pollTimer: null, polling: false, running: null, pendingTrigger: null,
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
    quick: oneOf(query.quick, QUICK_FILTERS),
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
  if (filters.quick && QUICK_SQL[filters.quick]) where.push(QUICK_SQL[filters.quick]);
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
  const queries = await originalQueriesFor(db, rows.rows).catch((error) => {
    logger.warn('People original query lookup failed', { message: error.message });
    return new Map();
  });
  return {
    rows: rows.rows.map((row) => ({ ...row, original_query: snippetOf(queries.get(row.id)?.[0]) })),
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
  const deleted = await db.query(
    'SELECT count(*)::int AS n FROM people_suppressions WHERE restored_at IS NULL'
  ).then((r) => r.rows[0]?.n || 0).catch(() => null);
  return { ...(runs.rows[0] || {}), counts: { ...(counts.rows[0] || {}), deleted } };
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

  const queries = await originalQueriesFor(db, [person]).catch((error) => {
    logger.warn('People original query lookup failed', { message: error.message });
    return new Map();
  });

  return {
    person,
    original_queries: queries.get(person.id) || [],
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

// ---------------------------------------------------------------------------
// Original query: what the person first asked for, read from the rows they
// came from (never written). Ranked most useful first:
//   1. a listing they enquired about (lead with a listing, with its link)
//   2. what they asked for in a lead (a property need, a viewing, mortgage…)
//   3. their first real WhatsApp request (not a bare greeting or menu digit)
//   4. a listing they submitted
//   5. a saved search / alert
//   6. other lead messages (missed-call callbacks and the like)
//   7. their home-seeker goal
//   8. their first WhatsApp message when it was only a greeting
// Batched: one round of queries for a whole list page.

const WA_FILLER_RE = "^\\s*(hi+|hello+|hel+o|hey+|hallo|helo|hy|hie|good\\s+(morning|afternoon|evening|day)|morning|menu|main menu|start|restart|back|ok(ay)?|k|thanks?( you)?|thank you|yes|no|y|n|sure|oli otya|gyebale ko|ki kati|[0-9]+|#|\\*)[\\s.!?,]*$";
const WA_IGNORED_INTENTS = ['greeting', 'unknown', 'menu', 'fallback', 'small_talk', 'thanks', 'language_selection', 'language_change', 'main_menu', 'menu_option', 'apply_filters'];
const SNIPPET_LEN = 120;
const TEXT_LEN = 600;

function cleanText(value, max = TEXT_LEN) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ').trim();
}

function snippetOf(item) {
  if (!item) return null;
  const text = item.listing?.title && !item.text ? item.listing.title : item.text;
  return {
    kind: item.kind,
    label: item.label,
    text: cleanText(text, SNIPPET_LEN),
    at: item.at,
    source: item.source
  };
}

function listingOf(row) {
  if (!row.listing_id) return null;
  return { id: row.listing_id, title: row.listing_title || null, url: `/property/${row.listing_id}` };
}

function searchText(s) {
  const price = s.min_price || s.max_price
    ? `${s.currency || 'UGX'} ${[s.min_price, s.max_price].map((v) => (v ? Number(v).toLocaleString('en-GB') : '…')).join('–')}`
    : '';
  return [
    s.label,
    humanize(s.category),
    humanize(s.property_type),
    s.bedrooms ? `${s.bedrooms} bed` : '',
    s.location,
    price
  ].filter(Boolean).join(' · ');
}

async function originalQueriesFor(db, people = []) {
  const out = new Map();
  const list = (people || []).filter((p) => p && p.id);
  if (!list.length) return out;
  const ids = list.map((p) => p.id);
  // WhatsApp tables store the number as digits without the plus.
  const waPhones = [...new Set(list.map((p) => String(p.phone_e164 || '').replace(/\D/g, '')).filter((d) => d.length >= 7))];
  const userIds = [...new Set(list.map((p) => p.user_id).filter(Boolean))];
  const phones = [...new Set(list.map((p) => p.phone_e164).filter(Boolean))];
  const empty = { rows: [] };

  const [wa, leads, searches, seekers] = await Promise.all([
    waPhones.length ? db.query(
      `SELECT ph AS wa_phone,
              f.created_at AS first_at, f.body AS first_body, f.message_type AS first_type,
              r.created_at AS real_at, r.body AS real_body,
              i.detected_intent, i.created_at AS intent_at
       FROM unnest($1::text[]) AS ph
       LEFT JOIN LATERAL (
         SELECT m.created_at, m.message_type,
                COALESCE(NULLIF(m.payload->>'effectiveBody', ''), m.payload->>'body') AS body
         FROM whatsapp_messages m
         WHERE m.user_phone = ph AND m.direction = 'inbound'
         ORDER BY m.created_at ASC LIMIT 1
       ) f ON TRUE
       LEFT JOIN LATERAL (
         SELECT x.created_at, x.body FROM (
           SELECT m.created_at,
                  btrim(COALESCE(NULLIF(m.payload->>'effectiveBody', ''), m.payload->>'body')) AS body
           FROM whatsapp_messages m
           WHERE m.user_phone = ph AND m.direction = 'inbound'
           ORDER BY m.created_at ASC LIMIT 40
         ) x
         WHERE length(x.body) >= 8 AND x.body !~* $2
         ORDER BY x.created_at ASC LIMIT 1
       ) r ON TRUE
       LEFT JOIN LATERAL (
         SELECT l.detected_intent, l.created_at
         FROM whatsapp_intent_logs l
         WHERE l.user_phone = ph AND l.detected_intent IS NOT NULL
           AND NOT (l.detected_intent = ANY($3::text[]))
         ORDER BY l.created_at ASC LIMIT 1
       ) i ON TRUE`,
      [waPhones, WA_FILLER_RE, WA_IGNORED_INTENTS]
    ) : empty,
    db.query(
      `SELECT pl.person_id, l.id, l.created_at, l.message, l.listing_id, l.lead_type, l.source,
              pr.title AS listing_title
       FROM people_links pl
       JOIN leads l ON l.id::text = pl.source_id
       LEFT JOIN properties pr ON pr.id = l.listing_id
       WHERE pl.source_table = 'leads' AND pl.person_id = ANY($1::uuid[])
       ORDER BY l.created_at ASC
       LIMIT 2000`,
      [ids]
    ),
    (userIds.length || phones.length) ? db.query(
      `SELECT s.user_id, people_normalize_phone(s.phone, $3) AS phone_e164, s.created_at, s.label, s.category,
              s.property_type, s.bedrooms, s.location, s.min_price, s.max_price, s.currency
       FROM saved_searches s
       WHERE (s.user_id = ANY($1::uuid[]))
          OR (s.user_id IS NULL AND s.phone IS NOT NULL AND people_normalize_phone(s.phone, $3) = ANY($2::text[]))
       ORDER BY s.created_at ASC
       LIMIT 2000`,
      [userIds, phones, defaultCallingCode()]
    ) : empty,
    db.query(
      `SELECT pl.person_id, sp.current_goal, sp.seeker_type, sp.timeline, sp.created_at
       FROM people_links pl
       JOIN property_seeker_profiles sp ON sp.id::text = pl.source_id
       WHERE pl.source_table = 'property_seeker_profiles' AND pl.person_id = ANY($1::uuid[])
       ORDER BY sp.created_at ASC`,
      [ids]
    )
  ]);

  const waByPhone = new Map(wa.rows.map((r) => [r.wa_phone, r]));
  for (const person of list) {
    const items = [];
    const add = (rank, item) => { if (item.text || item.listing) items.push({ rank, ...item }); };

    for (const l of leads.rows.filter((r) => r.person_id === person.id)) {
      const type = String(l.lead_type || '');
      const base = { at: l.created_at, source: 'lead', source_detail: humanize(l.source), text: cleanText(l.message) };
      if (l.listing_id && type === 'listing_owner') {
        add(4, { ...base, kind: 'listing_submitted', label: 'Submitted a listing', listing: listingOf(l) });
      } else if (l.listing_id) {
        add(1, { ...base, kind: 'listing_enquiry', label: `Enquired about a listing (${humanize(type) || 'enquiry'})`, listing: listingOf(l) });
      } else if (['callback'].includes(type) || /missed_call/.test(String(l.source || ''))) {
        add(6, { ...base, kind: 'lead_other', label: `Lead: ${humanize(type) || 'callback'}` });
      } else {
        add(2, { ...base, kind: 'lead_request', label: `Asked for: ${humanize(type) || 'enquiry'}` });
      }
    }

    const w = waByPhone.get(String(person.phone_e164 || '').replace(/\D/g, ''));
    if (w) {
      const intent = w.detected_intent ? humanize(w.detected_intent) : '';
      if (w.real_at) {
        add(3, {
          kind: 'whatsapp_request',
          label: 'First WhatsApp request',
          text: cleanText(w.real_body),
          intent: intent || null,
          at: w.real_at,
          source: 'whatsapp'
        });
      }
      if (w.first_at && (!w.real_at || new Date(w.first_at).getTime() !== new Date(w.real_at).getTime())) {
        const body = cleanText(w.first_body);
        add(w.real_at ? 9 : 8, {
          kind: 'whatsapp_first',
          label: w.real_at ? 'First WhatsApp message' : 'First WhatsApp message (greeting only, nothing asked yet)',
          text: body || (w.first_type ? `[${humanize(w.first_type)}]` : ''),
          intent: intent || null,
          at: w.first_at,
          source: 'whatsapp'
        });
      }
    }

    for (const s of searches.rows.filter((r) => (person.user_id && r.user_id === person.user_id)
      || (!r.user_id && person.phone_e164 && r.phone_e164 === person.phone_e164))) {
      add(5, { kind: 'saved_search', label: 'Saved a search / alert', text: searchText(s), at: s.created_at, source: 'saved_search' });
    }

    for (const sp of seekers.rows.filter((r) => r.person_id === person.id)) {
      const text = [humanize(sp.current_goal), humanize(sp.seeker_type), sp.timeline ? `timeline: ${humanize(sp.timeline)}` : '']
        .filter(Boolean).join(' · ');
      add(7, { kind: 'seeker_goal', label: 'Home-seeker goal', text, at: sp.created_at, source: 'property_seeker_profile' });
    }

    items.sort((a, b) => a.rank - b.rank || new Date(a.at || 0) - new Date(b.at || 0));
    // The earliest item of each kind; at most eight.
    const seen = new Set();
    const ranked = [];
    for (const item of items) {
      const key = item.kind === 'listing_enquiry' || item.kind === 'lead_request'
        ? `${item.kind}:${item.listing?.id || item.text}` : item.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      const { rank, ...rest } = item;
      ranked.push(rest);
      if (ranked.length >= 8) break;
    }
    out.set(person.id, ranked);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delete (super_admin) = take the person off the list and keep them off.
// The person row and its links go (links cascade); a people_suppressions row
// keeps their key, phone and email so the 15-minute and nightly reconcile
// skip them (trigger, migration 189). No source row is touched: accounts,
// leads, WhatsApp tables and seeker profiles stay exactly as they are.
// The reconcile advisory lock is held for the write, so a reconcile running
// at the same moment cannot put the person back.

const DELETE_MAX = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanIds(value, max = DELETE_MAX) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((v) => String(v || '').trim()).filter((v) => UUID_RE.test(v)))].slice(0, max);
}

function cleanSuppressionIds(value, max = DELETE_MAX) {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((v) => String(v ?? '').trim()).filter((v) => /^\d{1,18}$/.test(v)))].slice(0, max);
}

async function withReconcileLock(db, work) {
  const client = typeof db.getClient === 'function' ? await db.getClient() : await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('makaug_people_reconcile'))");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deletePeople(db, personIds, { actorId = null, reason = 'staff_delete' } = {}) {
  const ids = cleanIds(personIds);
  if (!ids.length) return { requested: 0, deleted: 0, suppressed: 0 };
  // Read the snapshot's "original query" before the links go.
  const people = await db.query('SELECT id, phone_e164, user_id FROM people WHERE id = ANY($1::uuid[])', [ids]);
  const queries = await originalQueriesFor(db, people.rows).catch(() => new Map());
  const firstQuery = {};
  for (const [id, items] of queries) firstQuery[id] = snippetOf(items[0]);
  const actor = UUID_RE.test(String(actorId || '')) ? actorId : null;
  const counts = await withReconcileLock(db, async (client) => {
    const result = await client.query(
      `WITH target AS (
         SELECT * FROM people WHERE id = ANY($1::uuid[]) FOR UPDATE
       ), ins AS (
         INSERT INTO people_suppressions (person_key, key_kind, phone_e164, email, snapshot, reason, deleted_by)
         SELECT t.person_key, t.key_kind, t.phone_e164, t.email,
                jsonb_build_object(
                  'person_id', t.id, 'display_name', t.display_name, 'roles', t.roles, 'sources', t.sources,
                  'source_row_count', t.source_row_count, 'first_seen_at', t.first_seen_at,
                  'last_activity_at', t.last_activity_at, 'saves_count', t.saves_count,
                  'alerts_count', t.alerts_count, 'leads_count', t.leads_count,
                  'consent_status', t.consent_status, 'user_id', t.user_id,
                  'original_query', $2::jsonb -> t.id::text
                ),
                $3, $4::uuid
         FROM target t
         ON CONFLICT (person_key) WHERE restored_at IS NULL DO NOTHING
         RETURNING id
       ), del AS (
         DELETE FROM people p USING target t WHERE p.id = t.id RETURNING p.id
       )
       SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM ins)::int AS suppressed`,
      [ids, JSON.stringify(firstQuery), String(reason || 'staff_delete').slice(0, 60), actor]
    );
    return result.rows[0] || { deleted: 0, suppressed: 0 };
  });
  logger.info('People deleted from list', { requested: ids.length, deleted: counts.deleted, suppressed: counts.suppressed });
  return { requested: ids.length, deleted: counts.deleted, suppressed: counts.suppressed };
}

async function restorePeople(db, suppressionIds, { actorId = null } = {}) {
  const ids = cleanSuppressionIds(suppressionIds);
  if (!ids.length) return { requested: 0, restored: 0 };
  const actor = UUID_RE.test(String(actorId || '')) ? actorId : null;
  const restored = await withReconcileLock(db, async (client) => {
    const result = await client.query(
      `UPDATE people_suppressions SET restored_at = NOW(), restored_by = $2::uuid
       WHERE id = ANY($1::bigint[]) AND restored_at IS NULL
       RETURNING id`,
      [ids, actor]
    );
    return result.rowCount || 0;
  });
  let back = null;
  if (restored) {
    // Put them back now from the untouched source rows.
    const stats = await reconcilePeople(db, 'people_restore').catch((error) => {
      logger.warn('People restore reconcile failed', { message: error.message });
      return { skipped: 'error' };
    });
    if (stats?.skipped) schedulePeopleRefresh('people_restore');
    back = stats?.skipped ? null : (stats?.written?.people_inserted ?? null);
  }
  logger.info('People restored to list', { requested: ids.length, restored, re_added: back });
  return { requested: ids.length, restored, re_added: back };
}

async function listDeletedPeople(db, query = {}) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const q = String(query.q || '').trim().slice(0, 120);
  const params = [];
  const where = ['s.restored_at IS NULL'];
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const like = `$${params.length}`;
    const digits = q.replace(/\D/g, '').replace(/^0+/, '');
    const parts = [`s.snapshot->>'display_name' ILIKE ${like}`, `s.email ILIKE ${like}`];
    if (digits.length >= 3) {
      params.push(`%${digits.length > 9 ? digits.slice(-9) : digits}%`);
      parts.push(`s.phone_e164 LIKE $${params.length}`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [rows, total] = await Promise.all([
    db.query(
      `SELECT s.id, s.key_kind, s.phone_e164, s.email, s.snapshot, s.reason, s.deleted_at, s.deleted_by,
              NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS deleted_by_name
       FROM people_suppressions s LEFT JOIN users u ON u.id = s.deleted_by
       ${whereSql}
       ORDER BY s.deleted_at DESC, s.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    ),
    db.query(`SELECT count(*)::int AS n FROM people_suppressions s ${whereSql}`, params)
  ]);
  return { rows: rows.rows, total: total.rows[0]?.n || 0, page, limit };
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
  DELETE_MAX,
  FINGERPRINT_PROBES,
  FINGERPRINT_SQL,
  POLL_MS,
  QUICK_FILTERS,
  QUICK_SQL,
  ROLES,
  SOURCES,
  bindPeopleDb,
  buildPeopleWhere,
  csvCell,
  defaultCallingCode,
  deletePeople,
  getPersonDetail,
  latestDedupeReport,
  listDeletedPeople,
  listPeople,
  originalQueriesFor,
  parsePeopleFilters,
  peopleCsv,
  pollTick,
  reconcilePeople,
  restorePeople,
  schedulePeopleRefresh,
  startPeopleScheduler,
  stopPeopleSchedulerForTests
};
