-- Manual rollback for db/migrations/183_delete_marketplace_laundries.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
-- Run it inside one transaction (psql --single-transaction) with
-- app.country_code set to UG, e.g. SET app.country_code = 'UG'.
--
-- 1. Every open row in marketplace_laundry_delete_183_backup is inserted back
--    into marketplace_businesses exactly as it was (same id, slug, status ...).
--    An id that exists again is left alone.
-- 2. ON DELETE CASCADE children (reviews, payments, claims, edit tokens, owner
--    notifications ...) are inserted back; claims before edit tokens.
--    A primary key that exists again is left alone.
-- 3. ON DELETE SET NULL children (leads, events, waitlist) are pointed back at
--    the business, only while their link is still empty.
-- Backup rows are stamped restored_at so 183 could be applied again. The
-- backup tables are kept.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

DO $rollback_183$
DECLARE
  dep RECORD;
  pk_match TEXT;
  n_business INTEGER := 0;
  n_children INTEGER := 0;
  n_relinked INTEGER := 0;
  n INTEGER;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_183 skipped: app.country_code is not UG';
    RETURN;
  END IF;
  IF to_regclass('public.marketplace_laundry_delete_183_backup') IS NULL THEN
    RAISE NOTICE 'rollback_183 skipped: backup table missing';
    RETURN;
  END IF;

  INSERT INTO marketplace_businesses
  SELECT restored.*
  FROM marketplace_laundry_delete_183_backup k
  CROSS JOIN LATERAL jsonb_populate_record(NULL::marketplace_businesses, k.before_row) AS restored
  WHERE k.restored_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM marketplace_businesses b WHERE b.id = k.business_id);
  GET DIAGNOSTICS n_business = ROW_COUNT;

  FOR dep IN
    SELECT d.*
    FROM marketplace_laundry_delete_183_dependents d
    JOIN marketplace_laundry_delete_183_backup k ON k.business_id = d.business_id AND k.restored_at IS NULL
    WHERE d.restored_at IS NULL
    ORDER BY CASE d.on_delete WHEN 'cascade' THEN 0 ELSE 1 END,
             CASE d.source_table
               WHEN 'marketplace_claims' THEN 0
               WHEN 'marketplace_edit_tokens' THEN 2
               ELSE 1
             END,
             d.source_table, d.backup_id
  LOOP
    SELECT string_agg(format('t.%I = (%L::jsonb ->> %L)::%s', key, dep.source_pk::text, key,
                             format_type(a.atttypid, a.atttypmod)), ' AND ')
      INTO pk_match
    FROM jsonb_object_keys(dep.source_pk) AS key
    JOIN pg_attribute a ON a.attrelid = to_regclass(quote_ident(dep.source_table)) AND a.attname = key;

    IF dep.on_delete = 'cascade' THEN
      EXECUTE format(
        'INSERT INTO %1$I SELECT r.* FROM jsonb_populate_record(NULL::%1$I, $1) AS r
          WHERE NOT EXISTS (SELECT 1 FROM %1$I AS t WHERE %2$s)',
        dep.source_table, pk_match
      ) USING dep.before_row;
      GET DIAGNOSTICS n = ROW_COUNT;
      n_children := n_children + n;
    ELSE
      EXECUTE format(
        'UPDATE %1$I AS t SET %2$I = $1 WHERE %3$s AND t.%2$I IS NULL',
        dep.source_table, dep.source_column, pk_match
      ) USING dep.business_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      n_relinked := n_relinked + n;
    END IF;
    UPDATE marketplace_laundry_delete_183_dependents SET restored_at = NOW() WHERE backup_id = dep.backup_id;
  END LOOP;

  UPDATE marketplace_laundry_delete_183_backup SET restored_at = NOW() WHERE restored_at IS NULL;

  RAISE NOTICE 'rollback_183 businesses_restored=% children_restored=% links_restored=%',
    n_business, n_children, n_relinked;
END
$rollback_183$;
