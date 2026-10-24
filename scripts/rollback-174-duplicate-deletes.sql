-- Manual rollback for db/migrations/174_delete_hidden_duplicate_listings.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
--
-- It puts each backed-up properties row back, then puts dependent rows back.
-- cascade_delete rows are inserted from the leaf rank upward (parents first).
-- repoint rows are pointed back at the duplicate only while they still point
-- at the keeper. set_null rows are pointed back only while the listing column
-- is still null. A later staff edit of that foreign key is left alone.
-- A property id that already exists is not overwritten. The backup tables
-- are kept.
-- Uganda only (app.country_code = UG).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

DO $rollback_174$
DECLARE
  property_backup record;
  tbl record;
  queued record;
  pk_match text;
  restored_count integer := 0;
  inserted_n integer := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'rollback_174 skipped country_not_ug';
    RAISE NOTICE 'rollback_174 restored_count 0';
    RETURN;
  END IF;

  IF to_regclass('public.deleted_duplicates_backup_174_properties') IS NULL THEN
    RAISE NOTICE 'rollback_174 skipped backup_missing';
    RAISE NOTICE 'rollback_174 restored_count 0';
    RETURN;
  END IF;

  FOR property_backup IN
    SELECT property_id, before_row
    FROM deleted_duplicates_backup_174_properties
    ORDER BY property_id
  LOOP
    INSERT INTO properties
    SELECT restored.*
    FROM jsonb_populate_record(NULL::properties, property_backup.before_row) AS restored
    WHERE NOT EXISTS (
      SELECT 1
      FROM properties existing
      WHERE existing.id = property_backup.property_id
    );
    GET DIAGNOSTICS inserted_n = ROW_COUNT;
    IF inserted_n = 1 THEN
      restored_count := restored_count + 1;
      RAISE NOTICE 'rollback_174 % restored', property_backup.property_id;
    ELSIF EXISTS (SELECT 1 FROM properties WHERE id = property_backup.property_id) THEN
      RAISE NOTICE 'rollback_174 % property_already_present', property_backup.property_id;
    ELSE
      RAISE EXCEPTION 'rollback_174 could not restore property %', property_backup.property_id;
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS pg_temp.rollback_174_queue;
  CREATE TEMP TABLE rollback_174_queue (
    backup_table text NOT NULL,
    backup_id bigint NOT NULL,
    property_id uuid NOT NULL,
    kept_property_id uuid NOT NULL,
    source_schema text NOT NULL,
    source_table text NOT NULL,
    source_column text NOT NULL,
    source_pk jsonb NOT NULL,
    before_row jsonb NOT NULL,
    disposition text NOT NULL,
    delete_rank integer NOT NULL,
    PRIMARY KEY (backup_table, backup_id)
  ) ON COMMIT DROP;

  FOR tbl IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'deleted_duplicates_backup_174\_%' ESCAPE '\'
      AND c.relname <> 'deleted_duplicates_backup_174_properties'
    ORDER BY c.relname
  LOOP
    EXECUTE format($queue$
      INSERT INTO rollback_174_queue (
        backup_table, backup_id, property_id, kept_property_id, source_schema,
        source_table, source_column, source_pk, before_row, disposition, delete_rank
      )
      SELECT %L, backup_id, property_id, kept_property_id, source_schema,
             source_table, source_column, source_pk, before_row, disposition, delete_rank
      FROM %I
    $queue$, tbl.table_name, tbl.table_name);
  END LOOP;

  FOR queued IN
    SELECT *
    FROM rollback_174_queue
    WHERE disposition = 'cascade_delete'
    ORDER BY delete_rank ASC, source_table, backup_id
  LOOP
    IF to_regclass(format('%I.%I', queued.source_schema, queued.source_table)) IS NULL THEN
      RAISE EXCEPTION 'rollback_174 source table % is missing', queued.source_table;
    END IF;
    SELECT string_agg(
      format('existing.%I IS NOT DISTINCT FROM restored.%I', pkatt.attname, pkatt.attname),
      ' AND ' ORDER BY k.ord
    )
    INTO pk_match
    FROM pg_class src
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_index i ON i.indrelid = src.oid AND i.indisprimary
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute pkatt
      ON pkatt.attrelid = src.oid
     AND pkatt.attnum = k.attnum
     AND NOT pkatt.attisdropped
    WHERE n.nspname = queued.source_schema
      AND src.relname = queued.source_table
      AND k.attnum > 0;
    IF pk_match IS NULL THEN
      RAISE EXCEPTION 'rollback_174 % has no primary key', queued.source_table;
    END IF;
    EXECUTE format(
      'INSERT INTO %I.%I SELECT restored.* FROM jsonb_populate_record(NULL::%I.%I, $1) AS restored WHERE NOT EXISTS (SELECT 1 FROM %I.%I AS existing WHERE %s)',
      queued.source_schema, queued.source_table,
      queued.source_schema, queued.source_table,
      queued.source_schema, queued.source_table,
      pk_match
    ) USING queued.before_row;
  END LOOP;

  FOR queued IN
    SELECT *
    FROM rollback_174_queue
    WHERE disposition = 'repoint'
    ORDER BY source_table, backup_id
  LOOP
    IF to_regclass(format('%I.%I', queued.source_schema, queued.source_table)) IS NULL THEN
      RAISE EXCEPTION 'rollback_174 source table % is missing', queued.source_table;
    END IF;
    SELECT string_agg(
      format('target.%I IS NOT DISTINCT FROM restored.%I', pkatt.attname, pkatt.attname),
      ' AND ' ORDER BY k.ord
    )
    INTO pk_match
    FROM pg_class src
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_index i ON i.indrelid = src.oid AND i.indisprimary
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute pkatt
      ON pkatt.attrelid = src.oid
     AND pkatt.attnum = k.attnum
     AND NOT pkatt.attisdropped
    WHERE n.nspname = queued.source_schema
      AND src.relname = queued.source_table
      AND k.attnum > 0;
    IF pk_match IS NULL THEN
      RAISE EXCEPTION 'rollback_174 % has no primary key', queued.source_table;
    END IF;
    EXECUTE format(
      'UPDATE %I.%I AS target SET %I = $1 FROM jsonb_populate_record(NULL::%I.%I, $3) AS restored WHERE %s AND target.%I IS NOT DISTINCT FROM $2',
      queued.source_schema, queued.source_table, queued.source_column,
      queued.source_schema, queued.source_table,
      pk_match, queued.source_column
    ) USING queued.property_id, queued.kept_property_id, queued.before_row;
  END LOOP;

  FOR queued IN
    SELECT *
    FROM rollback_174_queue
    WHERE disposition = 'set_null'
    ORDER BY source_table, backup_id
  LOOP
    IF to_regclass(format('%I.%I', queued.source_schema, queued.source_table)) IS NULL THEN
      RAISE EXCEPTION 'rollback_174 source table % is missing', queued.source_table;
    END IF;
    SELECT string_agg(
      format('target.%I IS NOT DISTINCT FROM restored.%I', pkatt.attname, pkatt.attname),
      ' AND ' ORDER BY k.ord
    )
    INTO pk_match
    FROM pg_class src
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_index i ON i.indrelid = src.oid AND i.indisprimary
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute pkatt
      ON pkatt.attrelid = src.oid
     AND pkatt.attnum = k.attnum
     AND NOT pkatt.attisdropped
    WHERE n.nspname = queued.source_schema
      AND src.relname = queued.source_table
      AND k.attnum > 0;
    IF pk_match IS NULL THEN
      RAISE EXCEPTION 'rollback_174 % has no primary key', queued.source_table;
    END IF;
    EXECUTE format(
      'UPDATE %I.%I AS target SET %I = $1 FROM jsonb_populate_record(NULL::%I.%I, $2) AS restored WHERE %s AND target.%I IS NULL',
      queued.source_schema, queued.source_table, queued.source_column,
      queued.source_schema, queued.source_table,
      pk_match, queued.source_column
    ) USING queued.property_id, queued.before_row;
  END LOOP;

  RAISE NOTICE 'rollback_174 restored_count %', restored_count;
END
$rollback_174$;
