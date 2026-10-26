-- One master contact list ("people"), 26 Oct 2026.
--
-- Each person is keyed by their WhatsApp/phone number in E.164 (+256 by
-- default on the UG tenant, +27 on ZA). Email is the key only when a person
-- has no usable phone. A person is linked to the rows they came from:
-- users, contacts, leads, whatsapp_user_profiles and
-- property_seeker_profiles. The source rows are read, never moved, changed
-- or deleted. Everything in people / people_links is derived and can be
-- rebuilt at any time with SELECT people_reconcile('manual');
--
-- What this migration does:
--   1. Creates people, people_links and people_reconcile_runs.
--   2. Creates people_normalize_phone(), people_normalize_email() and
--      people_reconcile(). The last one recomputes the whole list from the
--      source tables, writes only what changed, and records counts (never
--      names, numbers or emails) in people_reconcile_runs.stats.
--   3. Backup: data_change_188_backup holds a manifest of every source table
--      (row count plus an md5 of the ordered row ids) taken before the
--      backfill. No source row is written, so there is nothing else to back
--      up; the manifest lets the rollback prove the sources are untouched.
--   4. Backfill (UG only, like every data change): runs people_reconcile
--      once. Its stats row (trigger 'migration_188') is the dedupe report.
--
-- Test data is left out of the list but counted: WhatsApp profiles whose key
-- starts with dryrun: or sim-, contacts with role_type admin_test or a
-- dryrun:/sim- number, and leads marked is_test.
--
-- Consent is read from whatever fields exist. users is read through
-- to_jsonb(), so consent columns another branch adds later (for example
-- marketing_consent_at / marketing_opt_in_at and a *_source column) are
-- picked up without a code change. A users.marketing_opt_in flag with no
-- date and no source is shown as 'unverified_flag', never as consent.
--
-- Rollback: scripts/rollback-188-people-master-contact-list.sql (manual).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '300s';
SET LOCAL TIME ZONE 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_key TEXT NOT NULL UNIQUE,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('phone', 'email')),
  phone_e164 TEXT,
  email TEXT,
  display_name TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}',
  sources TEXT[] NOT NULL DEFAULT '{}',
  source_row_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  saves_count INTEGER NOT NULL DEFAULT 0,
  alerts_count INTEGER NOT NULL DEFAULT 0,
  leads_count INTEGER NOT NULL DEFAULT 0,
  consent_status TEXT NOT NULL DEFAULT 'none'
    CHECK (consent_status IN ('consented', 'opted_out', 'unverified_flag', 'legitimate_interest', 'none')),
  consent_source TEXT,
  consent_at TIMESTAMPTZ,
  consent_detail JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_staff_user_id UUID,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_people_last_activity ON people (last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_people_first_seen ON people (first_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_people_roles ON people USING GIN (roles);
CREATE INDEX IF NOT EXISTS idx_people_sources ON people USING GIN (sources);
CREATE INDEX IF NOT EXISTS idx_people_consent ON people (consent_status);
CREATE INDEX IF NOT EXISTS idx_people_user ON people (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS people_links (
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT,
  first_seen_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_people_links_person ON people_links (person_id);

CREATE TABLE IF NOT EXISTS people_reconcile_runs (
  id BIGSERIAL PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  changed BOOLEAN NOT NULL DEFAULT FALSE,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_people_reconcile_runs_finished ON people_reconcile_runs (finished_at DESC);

CREATE OR REPLACE FUNCTION people_try_ts(value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SET TimeZone = 'UTC' AS $fn$
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION people_try_bool(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN lower(btrim(value)) IN ('true', 't', '1', 'yes', 'y') THEN TRUE
    WHEN lower(btrim(value)) IN ('false', 'f', '0', 'no', 'n') THEN FALSE
    ELSE NULL
  END
$fn$;

-- Phone to E.164, or NULL when it is not a real phone number.
-- Rejected: test keys (dryrun:, sim-, oauth:, test:...), anything with
-- letters (names such as "WhatsApp", WhatsApp LIDs written with letters),
-- emails, and digit strings that cannot be a number (a 256 prefix with the
-- wrong length, LIDs longer than 13 digits).
CREATE OR REPLACE FUNCTION people_normalize_phone(raw TEXT, default_cc TEXT DEFAULT '256')
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  s TEXT;
  d TEXT;
  had_plus BOOLEAN;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := btrim(raw);
  IF s = '' OR s LIKE '%@%' OR s ~* '^(dryrun|sim|oauth|test|demo|lid|guest|device|anon)[:_-]' THEN
    RETURN NULL;
  END IF;
  IF s ~ '[A-Za-z]' THEN RETURN NULL; END IF;
  had_plus := s ~ '^[\s/]*(\+|00)';
  d := regexp_replace(s, '\D', '', 'g');
  IF d LIKE '00%' THEN d := substr(d, 3); END IF;
  IF d = '' THEN RETURN NULL; END IF;

  IF default_cc = '256' THEN
    IF length(d) = 10 AND d ~ '^0[2347]' THEN RETURN '+256' || substr(d, 2); END IF;
    IF length(d) = 9 AND d ~ '^[2347]' AND NOT had_plus THEN RETURN '+256' || d; END IF;
    IF d LIKE '256%' THEN
      IF length(d) = 12 AND substr(d, 4, 1) <> '0' THEN RETURN '+' || d; END IF;
      RETURN NULL;
    END IF;
  ELSIF default_cc = '27' THEN
    IF length(d) = 10 AND d ~ '^0[1-8]' THEN RETURN '+27' || substr(d, 2); END IF;
    IF length(d) = 9 AND d ~ '^[1-8]' AND NOT had_plus THEN RETURN '+27' || d; END IF;
    IF d LIKE '27%' THEN
      IF length(d) = 11 AND substr(d, 3, 1) <> '0' THEN RETURN '+' || d; END IF;
      RETURN NULL;
    END IF;
  END IF;

  -- Other countries: a full international number (with + or 00, or 11 to 13
  -- digits that do not start with 0).
  IF d ~ '^[1-9]' AND length(d) BETWEEN 10 AND 13 AND (had_plus OR length(d) >= 11) THEN
    RETURN '+' || d;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION people_normalize_email(raw TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    WHEN lower(btrim(raw)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      AND lower(btrim(raw)) !~ '@(example\.(com|org|net)|test\.(com|local)|invalid|localhost)$'
      AND lower(btrim(raw)) !~ '\.(local|invalid|test)$'
      THEN lower(btrim(raw))
    ELSE NULL
  END
$fn$;

-- Recompute the list from the source tables and write only the difference.
-- Returns the stats it stored (counts only). Safe to call at any time: a
-- second caller while one is running gets {"skipped": "locked"}.
CREATE OR REPLACE FUNCTION people_reconcile(p_trigger TEXT DEFAULT 'manual', p_default_cc TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
-- Dates written into consent_detail must not depend on the caller's zone,
-- or a run from the app and a run from psql would rewrite the same rows.
SET TimeZone = 'UTC'
AS $fn$
DECLARE
  cc TEXT := COALESCE(
    NULLIF(p_default_cc, ''),
    CASE current_setting('app.country_code', true) WHEN 'ZA' THEN '27' ELSE '256' END
  );
  run_id BIGINT;
  started TIMESTAMPTZ := clock_timestamp();
  n_inserted INTEGER := 0;
  n_updated INTEGER := 0;
  n_deleted INTEGER := 0;
  n_links_upserted INTEGER := 0;
  n_links_deleted INTEGER := 0;
  result JSONB;
  by_source JSONB;
  totals JSONB;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('makaug_people_reconcile')) THEN
    RETURN jsonb_build_object('skipped', 'locked', 'trigger', p_trigger);
  END IF;

  INSERT INTO people_reconcile_runs (trigger, started_at) VALUES (left(p_trigger, 60), started)
  RETURNING id INTO run_id;

  DROP TABLE IF EXISTS _people_rows;
  CREATE TEMP TABLE _people_rows (
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    role TEXT,
    phone_e164 TEXT,
    email TEXT,
    display_name TEXT,
    name_rank INTEGER NOT NULL DEFAULT 9,
    user_id UUID,
    ref_user_id UUID,
    ref_contact_id UUID,
    first_seen_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    consent_kind TEXT,
    consent_at TIMESTAMPTZ,
    consent_source TEXT,
    assigned_staff_user_id UUID,
    is_lead INTEGER NOT NULL DEFAULT 0,
    excluded TEXT,
    person_key TEXT
  ) ON COMMIT DROP;

  -- users: their own account row.
  INSERT INTO _people_rows (source_table, source_id, role, phone_e164, email, display_name, name_rank,
                            user_id, first_seen_at, last_activity_at, consent_kind, consent_at, consent_source)
  SELECT 'users', u.id::text,
         CASE
           WHEN u.role IN ('buyer_renter', 'buyer', 'renter', 'student', 'property_seeker') THEN 'home_seeker'
           WHEN u.role IN ('agent_broker', 'agent', 'broker', 'agency') THEN 'agent'
           WHEN u.role IN ('property_owner', 'owner', 'landlord', 'advertiser', 'seller', 'developer') THEN 'owner_advertiser'
           WHEN u.role IN ('moderator', 'admin', 'super_admin', 'field_agent') THEN 'staff'
           ELSE 'home_seeker'
         END,
         people_normalize_phone(u.phone, cc),
         people_normalize_email(u.email),
         NULLIF(btrim(concat_ws(' ', NULLIF(btrim(u.first_name), ''), NULLIF(btrim(u.last_name), ''))), ''),
         1,
         u.id,
         u.created_at,
         GREATEST(u.created_at, u.updated_at, u.last_login_at),
         CASE
           WHEN c.out_at IS NOT NULL AND (c.in_at IS NULL OR c.out_at >= c.in_at) THEN 'opt_out'
           WHEN c.granted AND (c.in_at IS NOT NULL OR c.in_src IS NOT NULL) THEN 'opt_in'
           WHEN c.granted THEN 'flag_only'
           ELSE NULL
         END,
         CASE
           WHEN c.out_at IS NOT NULL AND (c.in_at IS NULL OR c.out_at >= c.in_at) THEN c.out_at
           ELSE c.in_at
         END,
         COALESCE(c.in_src, CASE WHEN c.granted THEN 'users.marketing_opt_in' END)
  FROM users u
  CROSS JOIN LATERAL (SELECT to_jsonb(u) AS j) jj
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(people_try_bool(jj.j->>'marketing_consent'),
               people_try_bool(jj.j->'profile_data'->'marketing_consent'->>'granted'),
               people_try_bool(jj.j->>'marketing_opt_in')) AS granted,
      COALESCE(people_try_ts(jj.j->>'marketing_consent_at'),
               people_try_ts(jj.j->>'marketing_opt_in_at'),
               people_try_ts(jj.j->>'consent_recorded_at'),
               people_try_ts(jj.j->>'consent_at'),
               people_try_ts(jj.j->'profile_data'->'marketing_consent'->>'at')) AS in_at,
      NULLIF(COALESCE(jj.j->>'marketing_consent_source',
                      jj.j->>'marketing_opt_in_source',
                      jj.j->>'consent_source',
                      jj.j->'profile_data'->'marketing_consent'->>'source'), '') AS in_src,
      COALESCE(people_try_ts(jj.j->>'marketing_opt_out_at'),
               people_try_ts(jj.j->>'marketing_consent_withdrawn_at'),
               people_try_ts(jj.j->>'consent_withdrawn_at')) AS out_at
  ) c;

  -- contacts: the lead desk's contact records.
  INSERT INTO _people_rows (source_table, source_id, role, phone_e164, email, display_name, name_rank,
                            ref_user_id, first_seen_at, last_activity_at, consent_kind, consent_at, consent_source, excluded)
  SELECT 'contacts', c.id::text,
         CASE
           WHEN c.role_type IN ('listing_owner', 'owner', 'landlord', 'advertiser', 'seller', 'developer') THEN 'owner_advertiser'
           WHEN c.role_type IN ('property_seeker', 'investor', 'buyer', 'renter', 'tenant', 'student') THEN 'home_seeker'
           WHEN c.role_type IN ('agent', 'broker', 'agency') THEN 'agent'
           ELSE 'lead'
         END,
         COALESCE(people_normalize_phone(c.whatsapp, cc), people_normalize_phone(c.phone, cc)),
         people_normalize_email(c.email),
         NULLIF(btrim(c.name), ''),
         3,
         c.user_id,
         c.created_at,
         GREATEST(c.created_at, c.updated_at),
         CASE
           WHEN lower(COALESCE(c.consent_status, '')) IN ('opted_out', 'opt_out', 'withdrawn', 'unsubscribed', 'revoked') THEN 'opt_out'
           WHEN c.marketing_consent IS TRUE THEN 'opt_in'
           WHEN lower(COALESCE(c.consent_status, '')) = 'legitimate_interest' THEN 'legit'
           ELSE NULL
         END,
         CASE
           WHEN c.marketing_consent IS TRUE
             OR lower(COALESCE(c.consent_status, '')) IN ('opted_out', 'opt_out', 'withdrawn', 'unsubscribed', 'revoked')
             THEN c.updated_at
         END,
         CASE
           WHEN lower(COALESCE(c.consent_status, '')) IN ('opted_out', 'opt_out', 'withdrawn', 'unsubscribed', 'revoked') THEN 'contacts.consent_status'
           WHEN c.marketing_consent IS TRUE THEN 'contacts.marketing_consent'
           WHEN lower(COALESCE(c.consent_status, '')) = 'legitimate_interest' THEN 'contacts.consent_status'
         END,
         CASE
           WHEN lower(COALESCE(c.role_type, '')) IN ('admin_test', 'test', 'qa') THEN 'test'
           WHEN COALESCE(c.whatsapp, '') ~* '^(dryrun|sim)[:-]' OR COALESCE(c.phone, '') ~* '^(dryrun|sim)[:-]' THEN 'test'
         END
  FROM contacts c;

  -- leads: keyed through their contact, else their user, else the contact
  -- details typed into that submission.
  INSERT INTO _people_rows (source_table, source_id, role, phone_e164, email, display_name, name_rank,
                            ref_user_id, ref_contact_id, first_seen_at, last_activity_at,
                            assigned_staff_user_id, is_lead, excluded)
  SELECT 'leads', l.id::text,
         CASE
           WHEN l.lead_type IN ('listing_owner', 'list_property_whatsapp', 'list_property', 'advertiser_interest',
                                'marketplace_business_registration')
             OR l.source LIKE 'list_property%' THEN 'owner_advertiser'
           ELSE 'lead'
         END,
         people_normalize_phone(l.metadata->'submitted_contact'->>'phone', cc),
         people_normalize_email(l.metadata->'submitted_contact'->>'email'),
         NULLIF(btrim(l.metadata->'submitted_contact'->>'name'), ''),
         5,
         l.user_id,
         l.contact_id,
         l.created_at,
         GREATEST(l.created_at, l.updated_at, l.last_contacted_at),
         l.assigned_to_user_id,
         1,
         CASE WHEN l.is_test IS TRUE THEN 'test' END
  FROM leads l;

  -- WhatsApp profiles: one row per WhatsApp number (the phone is the key).
  INSERT INTO _people_rows (source_table, source_id, role, phone_e164, display_name, name_rank,
                            first_seen_at, last_activity_at, consent_kind, consent_at, consent_source, excluded)
  SELECT 'whatsapp_user_profiles', w.phone, 'whatsapp_contact',
         people_normalize_phone(w.phone, cc),
         NULLIF(btrim(w.metadata->>'display_name'), ''),
         4,
         w.created_at,
         GREATEST(w.created_at, w.updated_at, w.last_seen_at),
         CASE
           WHEN w.marketing_opt_out_at IS NOT NULL
             AND (w.marketing_opt_in_at IS NULL OR w.marketing_opt_out_at >= w.marketing_opt_in_at) THEN 'opt_out'
           WHEN w.marketing_opt_in IS TRUE AND w.marketing_opt_in_at IS NOT NULL THEN 'opt_in'
           WHEN w.marketing_opt_in IS TRUE THEN 'flag_only'
           ELSE NULL
         END,
         CASE
           WHEN w.marketing_opt_out_at IS NOT NULL
             AND (w.marketing_opt_in_at IS NULL OR w.marketing_opt_out_at >= w.marketing_opt_in_at) THEN w.marketing_opt_out_at
           WHEN w.marketing_opt_in IS TRUE THEN w.marketing_opt_in_at
         END,
         CASE
           WHEN w.marketing_opt_out_at IS NOT NULL
             AND (w.marketing_opt_in_at IS NULL OR w.marketing_opt_out_at >= w.marketing_opt_in_at) THEN 'whatsapp'
           WHEN w.marketing_opt_in IS TRUE THEN COALESCE(NULLIF(w.opt_in_source, ''), 'whatsapp')
         END,
         CASE WHEN w.phone ~* '^(dryrun|sim)[:-]' THEN 'test' END
  FROM whatsapp_user_profiles w;

  -- property seeker profiles: keyed through their user.
  INSERT INTO _people_rows (source_table, source_id, role, display_name, name_rank, ref_user_id,
                            first_seen_at, last_activity_at, consent_kind, consent_at, consent_source)
  SELECT 'property_seeker_profiles', p.id::text, 'home_seeker',
         NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), ''),
         2,
         p.user_id,
         p.created_at,
         GREATEST(p.created_at, p.updated_at),
         CASE WHEN p.marketing_consent IS TRUE THEN 'opt_in' END,
         CASE WHEN p.marketing_consent IS TRUE THEN p.updated_at END,
         CASE WHEN p.marketing_consent IS TRUE THEN 'property_seeker_profiles.marketing_consent' END
  FROM property_seeker_profiles p;

  -- Rows that carry a user or contact take that record's phone and email
  -- when they have none of their own.
  UPDATE _people_rows r
  SET phone_e164 = COALESCE(r.phone_e164, u.phone_e164),
      email = COALESCE(r.email, u.email)
  FROM _people_rows u
  WHERE u.source_table = 'users' AND u.user_id = r.ref_user_id AND r.source_table <> 'users';

  UPDATE _people_rows r
  SET phone_e164 = COALESCE(r.phone_e164, c.phone_e164),
      email = COALESCE(r.email, c.email),
      ref_user_id = COALESCE(r.ref_user_id, c.ref_user_id)
  FROM _people_rows c
  WHERE c.source_table = 'contacts' AND c.source_id = r.ref_contact_id::text AND r.source_table = 'leads';

  UPDATE _people_rows SET excluded = 'no_phone_or_email'
  WHERE excluded IS NULL AND phone_e164 IS NULL AND email IS NULL;

  -- Own key: phone first.
  UPDATE _people_rows SET person_key = 'p:' || phone_e164
  WHERE excluded IS NULL AND phone_e164 IS NOT NULL;

  -- No phone: join the one phone-keyed person with that email, if exactly
  -- one has it; otherwise the email is the key.
  WITH email_owner AS (
    SELECT email, min(person_key) AS person_key
    FROM _people_rows
    WHERE excluded IS NULL AND phone_e164 IS NOT NULL AND email IS NOT NULL
    GROUP BY email
    HAVING count(DISTINCT person_key) = 1
  )
  UPDATE _people_rows r
  SET person_key = COALESCE(o.person_key, 'e:' || r.email)
  FROM (SELECT DISTINCT email FROM _people_rows WHERE excluded IS NULL AND phone_e164 IS NULL AND email IS NOT NULL) e
  LEFT JOIN email_owner o ON o.email = e.email
  WHERE r.excluded IS NULL AND r.phone_e164 IS NULL AND r.email = e.email;

  -- A row that belongs to an account follows the account's key, so a
  -- contact or lead typed with another number still sits with its user.
  UPDATE _people_rows r
  SET person_key = u.person_key
  FROM _people_rows u
  WHERE u.source_table = 'users' AND u.user_id = r.ref_user_id AND u.person_key IS NOT NULL
    AND r.excluded IS NULL AND r.source_table <> 'users' AND r.person_key IS DISTINCT FROM u.person_key;

  UPDATE _people_rows r
  SET person_key = c.person_key
  FROM _people_rows c
  WHERE c.source_table = 'contacts' AND c.source_id = r.ref_contact_id::text AND c.person_key IS NOT NULL
    AND r.source_table = 'leads' AND r.excluded IS NULL AND r.ref_user_id IS NULL
    AND r.person_key IS DISTINCT FROM c.person_key;

  DROP TABLE IF EXISTS _people_new;
  CREATE TEMP TABLE _people_new ON COMMIT DROP AS
  WITH keyed AS (
    SELECT * FROM _people_rows WHERE person_key IS NOT NULL
  ),
  account AS (
    SELECT DISTINCT ON (person_key) person_key, user_id
    FROM keyed WHERE source_table = 'users'
    ORDER BY person_key, last_activity_at DESC NULLS LAST, source_id
  ),
  saves AS (
    SELECT a.person_key, count(*)::int AS n
    FROM account a JOIN saved_properties s ON s.user_id = a.user_id
    GROUP BY a.person_key
  ),
  alerts AS (
    SELECT k.person_key, count(DISTINCT s.id)::int AS n
    FROM saved_searches s
    JOIN LATERAL (
      SELECT a.person_key FROM account a WHERE a.user_id = s.user_id
      UNION
      SELECT 'p:' || people_normalize_phone(s.phone, cc) WHERE s.user_id IS NULL AND s.phone IS NOT NULL
    ) k ON TRUE
    WHERE lower(COALESCE(s.status, 'active')) = 'active'
    GROUP BY k.person_key
  ),
  named AS (
    SELECT DISTINCT ON (person_key) person_key, display_name
    FROM keyed WHERE display_name IS NOT NULL
    ORDER BY person_key, name_rank, last_activity_at DESC NULLS LAST, source_table, source_id
  ),
  emailed AS (
    SELECT DISTINCT ON (person_key) person_key, email
    FROM keyed WHERE email IS NOT NULL
    ORDER BY person_key, name_rank, last_activity_at DESC NULLS LAST, source_table, source_id
  ),
  explicit_consent AS (
    SELECT DISTINCT ON (person_key) person_key, consent_kind, consent_at, consent_source
    FROM keyed WHERE consent_kind IN ('opt_in', 'opt_out')
    ORDER BY person_key, consent_at DESC NULLS LAST, (consent_kind = 'opt_out') DESC, source_table, source_id
  ),
  assigned AS (
    SELECT DISTINCT ON (person_key) person_key, assigned_staff_user_id
    FROM keyed WHERE assigned_staff_user_id IS NOT NULL
    ORDER BY person_key, last_activity_at DESC NULLS LAST, source_table, source_id
  ),
  agg AS (
    SELECT person_key,
           array_agg(DISTINCT role ORDER BY role) FILTER (WHERE role IS NOT NULL) AS roles,
           array_agg(DISTINCT source_table ORDER BY source_table) AS sources,
           count(*)::int AS source_row_count,
           min(first_seen_at) AS first_seen_at,
           max(last_activity_at) AS last_activity_at,
           sum(is_lead)::int AS leads_count,
           bool_or(consent_kind = 'flag_only') AS any_flag,
           bool_or(consent_kind = 'legit') AS any_legit
    FROM keyed
    GROUP BY person_key
  ),
  -- Each distinct consent signal once, with how many rows carry it, in a
  -- fixed order so an unchanged person is never rewritten.
  consent_signals AS (
    SELECT person_key, source_table, consent_kind, consent_at, consent_source, count(*)::int AS n
    FROM keyed WHERE consent_kind IS NOT NULL
    GROUP BY person_key, source_table, consent_kind, consent_at, consent_source
  ),
  consent_details AS (
    SELECT person_key,
           jsonb_agg(jsonb_build_object(
             'source', source_table, 'kind', consent_kind, 'at', consent_at, 'via', consent_source, 'rows', n
           ) ORDER BY consent_at DESC NULLS LAST, source_table, consent_kind, consent_source) AS consent_detail
    FROM consent_signals
    GROUP BY person_key
  )
  SELECT g.person_key,
         CASE WHEN g.person_key LIKE 'p:%' THEN 'phone' ELSE 'email' END AS key_kind,
         CASE WHEN g.person_key LIKE 'p:%' THEN substr(g.person_key, 3) END AS phone_e164,
         em.email,
         nm.display_name,
         COALESCE(g.roles, '{}'::text[]) AS roles,
         g.sources,
         g.source_row_count,
         g.first_seen_at,
         g.last_activity_at,
         COALESCE(sv.n, 0) AS saves_count,
         COALESCE(al.n, 0) AS alerts_count,
         g.leads_count,
         CASE
           WHEN ec.consent_kind = 'opt_out' THEN 'opted_out'
           WHEN ec.consent_kind = 'opt_in' THEN 'consented'
           WHEN g.any_flag THEN 'unverified_flag'
           WHEN g.any_legit THEN 'legitimate_interest'
           ELSE 'none'
         END AS consent_status,
         CASE WHEN ec.consent_kind IS NOT NULL THEN ec.consent_source
              WHEN g.any_flag THEN 'flag without a consent record'
              WHEN g.any_legit THEN 'contacts.consent_status' END AS consent_source,
         ec.consent_at,
         COALESCE(cd.consent_detail, '[]'::jsonb) AS consent_detail,
         asg.assigned_staff_user_id,
         acc.user_id
  FROM agg g
  LEFT JOIN named nm ON nm.person_key = g.person_key
  LEFT JOIN emailed em ON em.person_key = g.person_key
  LEFT JOIN explicit_consent ec ON ec.person_key = g.person_key
  LEFT JOIN assigned asg ON asg.person_key = g.person_key
  LEFT JOIN account acc ON acc.person_key = g.person_key
  LEFT JOIN saves sv ON sv.person_key = g.person_key
  LEFT JOIN alerts al ON al.person_key = g.person_key
  LEFT JOIN consent_details cd ON cd.person_key = g.person_key;

  -- Write only what changed.
  WITH up AS (
    INSERT INTO people AS p (
      person_key, key_kind, phone_e164, email, display_name, roles, sources, source_row_count,
      first_seen_at, last_activity_at, saves_count, alerts_count, leads_count,
      consent_status, consent_source, consent_at, consent_detail, assigned_staff_user_id, user_id
    )
    SELECT person_key, key_kind, phone_e164, email, display_name, roles, sources, source_row_count,
           first_seen_at, last_activity_at, saves_count, alerts_count, leads_count,
           consent_status, consent_source, consent_at, consent_detail, assigned_staff_user_id, user_id
    FROM _people_new
    ON CONFLICT (person_key) DO UPDATE SET
      key_kind = EXCLUDED.key_kind,
      phone_e164 = EXCLUDED.phone_e164,
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      roles = EXCLUDED.roles,
      sources = EXCLUDED.sources,
      source_row_count = EXCLUDED.source_row_count,
      first_seen_at = EXCLUDED.first_seen_at,
      last_activity_at = EXCLUDED.last_activity_at,
      saves_count = EXCLUDED.saves_count,
      alerts_count = EXCLUDED.alerts_count,
      leads_count = EXCLUDED.leads_count,
      consent_status = EXCLUDED.consent_status,
      consent_source = EXCLUDED.consent_source,
      consent_at = EXCLUDED.consent_at,
      consent_detail = EXCLUDED.consent_detail,
      assigned_staff_user_id = EXCLUDED.assigned_staff_user_id,
      user_id = EXCLUDED.user_id,
      updated_at = NOW()
    WHERE (p.key_kind, p.phone_e164, p.email, p.display_name, p.roles, p.sources, p.source_row_count,
           p.first_seen_at, p.last_activity_at, p.saves_count, p.alerts_count, p.leads_count,
           p.consent_status, p.consent_source, p.consent_at, p.consent_detail, p.assigned_staff_user_id, p.user_id)
      IS DISTINCT FROM
          (EXCLUDED.key_kind, EXCLUDED.phone_e164, EXCLUDED.email, EXCLUDED.display_name, EXCLUDED.roles,
           EXCLUDED.sources, EXCLUDED.source_row_count, EXCLUDED.first_seen_at, EXCLUDED.last_activity_at,
           EXCLUDED.saves_count, EXCLUDED.alerts_count, EXCLUDED.leads_count, EXCLUDED.consent_status,
           EXCLUDED.consent_source, EXCLUDED.consent_at, EXCLUDED.consent_detail,
           EXCLUDED.assigned_staff_user_id, EXCLUDED.user_id)
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
  INTO n_inserted, n_updated
  FROM up;

  DELETE FROM people p
  WHERE NOT EXISTS (SELECT 1 FROM _people_new n WHERE n.person_key = p.person_key);
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  INSERT INTO people_links AS l (source_table, source_id, person_id, role, first_seen_at, last_activity_at)
  SELECT r.source_table, r.source_id, p.id, r.role, r.first_seen_at, r.last_activity_at
  FROM _people_rows r
  JOIN people p ON p.person_key = r.person_key
  WHERE r.person_key IS NOT NULL
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    person_id = EXCLUDED.person_id,
    role = EXCLUDED.role,
    first_seen_at = EXCLUDED.first_seen_at,
    last_activity_at = EXCLUDED.last_activity_at,
    linked_at = CASE WHEN l.person_id IS DISTINCT FROM EXCLUDED.person_id THEN NOW() ELSE l.linked_at END
  WHERE (l.person_id, l.role, l.first_seen_at, l.last_activity_at)
    IS DISTINCT FROM (EXCLUDED.person_id, EXCLUDED.role, EXCLUDED.first_seen_at, EXCLUDED.last_activity_at);
  GET DIAGNOSTICS n_links_upserted = ROW_COUNT;

  DELETE FROM people_links l
  WHERE NOT EXISTS (
    SELECT 1 FROM _people_rows r
    WHERE r.person_key IS NOT NULL AND r.source_table = l.source_table AND r.source_id = l.source_id
  );
  GET DIAGNOSTICS n_links_deleted = ROW_COUNT;

  -- The dedupe report: counts only.
  SELECT jsonb_object_agg(source_table, s) INTO by_source
  FROM (
    SELECT source_table, jsonb_build_object(
      'rows', count(*),
      'linked', count(*) FILTER (WHERE person_key IS NOT NULL),
      'test_excluded', count(*) FILTER (WHERE excluded = 'test'),
      'no_phone_or_email', count(*) FILTER (WHERE excluded = 'no_phone_or_email'),
      'people', count(DISTINCT person_key),
      'duplicates_within_source', count(*) FILTER (WHERE person_key IS NOT NULL) - count(DISTINCT person_key)
    ) AS s
    FROM _people_rows GROUP BY source_table
  ) x;

  SELECT jsonb_build_object(
    'people', (SELECT count(*) FROM _people_new),
    'people_keyed_by_phone', (SELECT count(*) FROM _people_new WHERE key_kind = 'phone'),
    'people_keyed_by_email', (SELECT count(*) FROM _people_new WHERE key_kind = 'email'),
    'source_rows', (SELECT count(*) FROM _people_rows),
    'linked_rows', (SELECT count(*) FROM _people_rows WHERE person_key IS NOT NULL),
    'merged_duplicates', (SELECT count(*) FROM _people_rows WHERE person_key IS NOT NULL) - (SELECT count(*) FROM _people_new),
    'people_with_2plus_rows', (SELECT count(*) FROM _people_new WHERE source_row_count > 1),
    'people_in_2plus_sources', (SELECT count(*) FROM _people_new WHERE cardinality(sources) > 1),
    'test_rows_excluded', (SELECT count(*) FROM _people_rows WHERE excluded = 'test'),
    'rows_without_phone_or_email', (SELECT count(*) FROM _people_rows WHERE excluded = 'no_phone_or_email'),
    'rows_joined_by_email', (SELECT count(*) FROM _people_rows WHERE phone_e164 IS NULL AND person_key LIKE 'p:%'),
    'shared_emails_not_merged', (
      SELECT count(*) FROM (
        SELECT email FROM _people_rows WHERE excluded IS NULL AND phone_e164 IS NOT NULL AND email IS NOT NULL
        GROUP BY email HAVING count(DISTINCT person_key) > 1
      ) z
    ),
    'consent', (SELECT jsonb_object_agg(consent_status, n) FROM (SELECT consent_status, count(*) n FROM _people_new GROUP BY 1) z),
    'roles', (SELECT jsonb_object_agg(role, n) FROM (SELECT unnest(roles) role, count(*) n FROM _people_new GROUP BY 1) z),
    'non_default_country', (SELECT count(*) FROM _people_new WHERE key_kind = 'phone' AND phone_e164 NOT LIKE '+' || cc || '%')
  ) INTO totals;

  result := totals || jsonb_build_object(
    'by_source', by_source,
    'written', jsonb_build_object(
      'people_inserted', n_inserted, 'people_updated', n_updated, 'people_deleted', n_deleted,
      'links_upserted', n_links_upserted, 'links_deleted', n_links_deleted
    ),
    'default_country_code', cc,
    'duration_ms', round(extract(epoch FROM clock_timestamp() - started) * 1000)
  );

  UPDATE people_reconcile_runs
  SET finished_at = clock_timestamp(),
      ok = TRUE,
      changed = (n_inserted + n_updated + n_deleted + n_links_upserted + n_links_deleted) > 0,
      stats = result
  WHERE id = run_id;

  -- Keep a month of run history, and always the backfill.
  DELETE FROM people_reconcile_runs
  WHERE finished_at < NOW() - INTERVAL '30 days' AND trigger <> 'migration_188';

  RETURN result || jsonb_build_object('run_id', run_id);
END
$fn$;

-- Backup manifest of the sources (counts and an id checksum, no personal data).
CREATE TABLE IF NOT EXISTS data_change_188_backup (
  id BIGSERIAL PRIMARY KEY,
  row_kind TEXT NOT NULL,
  row_key TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (row_kind, row_key)
);

DO $migration_188$
DECLARE
  stats JSONB;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'migration_188 backfill skipped: app.country_code is not UG (tables and functions are created)';
    RETURN;
  END IF;

  INSERT INTO data_change_188_backup (row_kind, row_key, before_row)
  SELECT 'source_manifest', t.name, t.manifest
  FROM (
    SELECT 'users' AS name, jsonb_build_object('rows', count(*), 'id_md5', md5(COALESCE(string_agg(id::text, ',' ORDER BY id), ''))) AS manifest FROM users
    UNION ALL
    SELECT 'contacts', jsonb_build_object('rows', count(*), 'id_md5', md5(COALESCE(string_agg(id::text, ',' ORDER BY id), ''))) FROM contacts
    UNION ALL
    SELECT 'leads', jsonb_build_object('rows', count(*), 'id_md5', md5(COALESCE(string_agg(id::text, ',' ORDER BY id), ''))) FROM leads
    UNION ALL
    SELECT 'whatsapp_user_profiles', jsonb_build_object('rows', count(*), 'id_md5', md5(COALESCE(string_agg(phone, ',' ORDER BY phone), ''))) FROM whatsapp_user_profiles
    UNION ALL
    SELECT 'property_seeker_profiles', jsonb_build_object('rows', count(*), 'id_md5', md5(COALESCE(string_agg(id::text, ',' ORDER BY id), ''))) FROM property_seeker_profiles
  ) t
  ON CONFLICT (row_kind, row_key) DO NOTHING;

  stats := people_reconcile('migration_188', '256');
  RAISE NOTICE 'migration_188 people backfill: people=%, merged_duplicates=%, consent=%, test_rows_excluded=%, rows_without_phone_or_email=%',
    stats->>'people', stats->>'merged_duplicates', stats->'consent', stats->>'test_rows_excluded', stats->>'rows_without_phone_or_email';
END
$migration_188$;
