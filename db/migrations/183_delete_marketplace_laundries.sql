-- Delete every laundry / dry-cleaning business from the marketplace.
-- Arthur, 25 Oct 2026: "get rid of the laundries ... don't just hide it, get rid of it."
-- The marketplace is for people building, buying or looking after property;
-- a laundry is not a property service.
--
-- Reviewed list (25 Oct live data and the pre-181 snapshot of 1,429 businesses):
--   live     0633da18-02dc-455e-ae3a-825aca62ea8b  LA'BOS LAUNDRY AND CLEANING SERVICES (owner-registered)
--   hidden   0003209c-3b09-4543-beb0-da73160c72b1  Bomboka Vintage Dry Cleaners, Laundry, Fumigation, ...  (hidden by 181)
--   hidden   daadbc0b-82eb-41d6-b262-9a74660653f9  Elohim Laundry And Dry Cleaners                          (hidden by 181)
--   hidden   562375e8-b766-4a75-b3dd-bbe99f093617  Holaz Laundry Cleaning Services, Mbale                   (hidden by 181)
--   hidden   ffe92b48-6613-4759-a32b-ae293f287da7  La'Bos Laundry & Cleaning Services                       (hidden by 181)
--   hidden   8409d9f6-e7ad-42a7-b99b-c1c7e0942db5  Washy Cleaning Services Ltd (Washy Drycleaners)          (hidden by 181)
--   hidden   d0f24e74-089a-4db4-8fc5-947cee775dcc  SwiftKlean Laundry and Cleaning Services                 (hidden by 181)
--   hidden   5ed71dfe-d8a8-4e11-beb1-9d1483b3b47c  Dunwell Dry Cleaners                                     (hidden by 181)
--   hidden   12f61b89-8968-413f-ba9c-6cb235cd549f  Gango's Laundry, Dry Cleaner & General Cleaning Services (hidden by 181)
-- Any other row, in any status, whose name says laundry / laundromat / dry
-- clean(er) is deleted too and named in a NOTICE.
--
-- Kept on purpose: building and home cleaning firms ("... Cleaning Services",
-- "... Cleaners", fumigation, housekeeping). They clean property, so they stay.
-- Borderline names reviewed and kept: Phimar Cleaners mbarara, clear choice
-- cleaners services gulu, Smile Fumigators and Cleaner's limited, Trained
-- Housemaids and Home Cleaners Uganda.
--
-- Backup before delete:
--   marketplace_laundry_delete_183_backup      one row per business (to_jsonb of the whole row)
--   marketplace_laundry_delete_183_dependents  every row in any table with a foreign key to
--                                              marketplace_businesses that points at a deleted
--                                              business (reviews, leads, payments, events, claims,
--                                              edit tokens, waitlist, owner notifications, ...)
-- ON DELETE CASCADE children are deleted with the business; ON DELETE SET NULL
-- children (leads, events, waitlist) stay and lose the link, as Postgres does.
-- Manual rollback: scripts/rollback-183-delete-marketplace-laundries.sql
-- (not a migration, never runs on deploy).
-- Idempotent: a second run finds nothing to delete. Uganda only.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS marketplace_laundry_delete_183_backup (
  business_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,
  match_reason TEXT NOT NULL,
  before_row JSONB NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS marketplace_laundry_delete_183_dependents (
  backup_id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL,
  source_table TEXT NOT NULL,
  source_column TEXT NOT NULL,
  on_delete TEXT NOT NULL,
  source_pk JSONB NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  UNIQUE (source_table, source_column, source_pk)
);

DO $do_183$
DECLARE
  reviewed_ids UUID[] := ARRAY[
    '0633da18-02dc-455e-ae3a-825aca62ea8b',
    '0003209c-3b09-4543-beb0-da73160c72b1',
    'daadbc0b-82eb-41d6-b262-9a74660653f9',
    '562375e8-b766-4a75-b3dd-bbe99f093617',
    'ffe92b48-6613-4759-a32b-ae293f287da7',
    '8409d9f6-e7ad-42a7-b99b-c1c7e0942db5',
    'd0f24e74-089a-4db4-8fc5-947cee775dcc',
    '5ed71dfe-d8a8-4e11-beb1-9d1483b3b47c',
    '12f61b89-8968-413f-ba9c-6cb235cd549f'
  ]::uuid[];
  -- laundry, laundries, laundromat, launderette, dry clean, dry-cleaner(s), drycleaners
  laundry_pattern TEXT := '(laund(ry|ries|romat|erette)|dry[[:space:]-]*clean)';
  target RECORD;
  fk RECORD;
  dep RECORD;
  n_reviewed_live INTEGER := 0;
  n_reviewed_hidden INTEGER := 0;
  n_extra INTEGER := 0;
  n_deleted INTEGER := 0;
  n_dependents INTEGER := 0;
  n_skipped INTEGER := 0;
  deleted_n INTEGER;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'marketplace_laundry_delete_183 skipped: app.country_code is not UG';
    RETURN;
  END IF;

  -- Every single-column foreign key that points at marketplace_businesses(id).
  CREATE TEMP TABLE laundry_183_fks ON COMMIT DROP AS
  SELECT n.nspname AS schema_name,
         c.relname AS table_name,
         a.attname AS column_name,
         con.confdeltype AS on_delete,
         (
           SELECT string_agg(format('%L, t.%I', pa.attname, pa.attname), ', ' ORDER BY pa.attnum)
           FROM pg_index i
           JOIN pg_attribute pa ON pa.attrelid = i.indrelid AND pa.attnum = ANY(i.indkey)
           WHERE i.indrelid = c.oid AND i.indisprimary
         ) AS pk_expr
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND con.confrelid = 'marketplace_businesses'::regclass
    AND array_length(con.conkey, 1) = 1;

  IF EXISTS (SELECT 1 FROM laundry_183_fks WHERE pk_expr IS NULL) THEN
    RAISE EXCEPTION 'marketplace_laundry_delete_183: table % has no primary key, cannot back it up',
      (SELECT string_agg(table_name, ', ') FROM laundry_183_fks WHERE pk_expr IS NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM laundry_183_fks WHERE on_delete NOT IN ('c', 'n')) THEN
    RAISE EXCEPTION 'marketplace_laundry_delete_183: unexpected ON DELETE rule on %',
      (SELECT string_agg(table_name, ', ') FROM laundry_183_fks WHERE on_delete NOT IN ('c', 'n'));
  END IF;

  FOR target IN
    SELECT b.*,
           CASE WHEN b.id = ANY(reviewed_ids) THEN 'reviewed_list' ELSE 'name_keyword' END AS match_reason
    FROM marketplace_businesses b
    WHERE b.id = ANY(reviewed_ids)
       OR b.name ~* laundry_pattern
    ORDER BY b.name, b.id
    FOR UPDATE OF b
  LOOP
    -- A reviewed id is deleted only while its name still says laundry / dry clean.
    IF target.name !~* laundry_pattern THEN
      n_skipped := n_skipped + 1;
      RAISE NOTICE 'marketplace_laundry_delete_183 % skipped name_changed (%)', target.id, target.name;
      CONTINUE;
    END IF;

    INSERT INTO marketplace_laundry_delete_183_backup (business_id, name, status, match_reason, before_row)
    SELECT b.id, b.name, b.status, target.match_reason, to_jsonb(b)
    FROM marketplace_businesses b WHERE b.id = target.id
    ON CONFLICT (business_id) DO UPDATE
      SET name = EXCLUDED.name,
          status = EXCLUDED.status,
          match_reason = EXCLUDED.match_reason,
          before_row = EXCLUDED.before_row,
          deleted_at = NOW(),
          restored_at = NULL;

    FOR fk IN SELECT * FROM laundry_183_fks ORDER BY table_name, column_name LOOP
      FOR dep IN EXECUTE format(
        'SELECT to_jsonb(t) AS before_row, jsonb_build_object(%s) AS source_pk FROM %I.%I AS t WHERE t.%I = $1',
        fk.pk_expr, fk.schema_name, fk.table_name, fk.column_name
      ) USING target.id
      LOOP
        INSERT INTO marketplace_laundry_delete_183_dependents
          (business_id, source_table, source_column, on_delete, source_pk, before_row)
        VALUES (target.id, fk.table_name, fk.column_name,
                CASE fk.on_delete WHEN 'c' THEN 'cascade' ELSE 'set_null' END,
                dep.source_pk, dep.before_row)
        ON CONFLICT (source_table, source_column, source_pk) DO UPDATE
          SET business_id = EXCLUDED.business_id,
              on_delete = EXCLUDED.on_delete,
              before_row = EXCLUDED.before_row,
              backed_up_at = NOW(),
              restored_at = NULL;
        n_dependents := n_dependents + 1;
      END LOOP;
    END LOOP;

    DELETE FROM marketplace_businesses WHERE id = target.id;
    GET DIAGNOSTICS deleted_n = ROW_COUNT;
    IF deleted_n <> 1 THEN
      RAISE EXCEPTION 'marketplace_laundry_delete_183 deleted % rows for %', deleted_n, target.id;
    END IF;

    n_deleted := n_deleted + 1;
    IF target.match_reason = 'name_keyword' THEN
      n_extra := n_extra + 1;
    ELSIF target.status = 'live' THEN
      n_reviewed_live := n_reviewed_live + 1;
    ELSE
      n_reviewed_hidden := n_reviewed_hidden + 1;
    END IF;
    RAISE NOTICE 'marketplace_laundry_delete_183 deleted % [%, %] %', target.id, target.status, target.match_reason, target.name;
  END LOOP;

  RAISE NOTICE 'marketplace_laundry_delete_183 deleted=% reviewed_live=% reviewed_hidden=% extra_by_name=% dependents_backed_up=% skipped=%',
    n_deleted, n_reviewed_live, n_reviewed_hidden, n_extra, n_dependents, n_skipped;
END
$do_183$;
