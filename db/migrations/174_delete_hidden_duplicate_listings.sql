-- Permanently remove duplicate listings that migrations 169, 170, and 172
-- unpublished (status = hidden, moderation_stage = hidden).
--
-- 173 is reserved for another change. This file is 174.
--
-- The set is every action "unpublish" pair in
-- db/migrations/169_correct_mislabelled_listings_and_duplicates.sql.
-- 170 retried the rows 169 did not update, and 172 retried the rows 170
-- skipped because the stored title did not equal the public API title.
-- Counted by which migration actually hid the row:
--   34 hidden by 169 (not in 170's unpublish list)
--   10 hidden by 170 (in 170's unpublish list, not in 172's)
--    5 hidden by 172: 15ca0488, c7c9e859, d1cf79a4, c9ab858d, 42f256d4
--   49 in total. The five are the ones 170's title guard skipped.
-- Each object records that origin. kept_id is the same id 169, 170, and 172
-- stored for that duplicate.
--
-- Not in this set, and refused if a later edit adds them: Kazi Honest
-- 31846e1b-167a-472b-b197-b16d48bed01b and Kimuli Brian
-- 7316f714-29eb-46fe-8bb2-2752108eed61. Migration 170 marks both "skip".
-- They are the same Najjera house with two live prices. Both stay.
--
-- A row is deleted only when it is still hidden on both status and
-- moderation_stage, and its keeper still exists, is a different id, and is
-- public (approved, live, or published). Anything else is left in place and
-- logged with RAISE NOTICE. A second run finds the deleted ids missing and
-- logs skipped missing. The deleted count is 0. No guard failure is deleted.
--
-- Backup and delete run in this one DO block, so they commit or roll back
-- together. scripts/migrate.js also wraps the file in a transaction.
-- Before a delete, the full properties row is copied to
-- deleted_duplicates_backup_174_properties. Every row in any table with a
-- foreign key to properties.id is copied to
-- deleted_duplicates_backup_174_<table>. Tables with no primary key, and
-- multi-column foreign keys to properties, abort the migration so a dependent
-- row is never dropped without a backup.
--
-- Enquiries and bookings are repointed to the keeper, not deleted.
-- property_inquiries would otherwise be removed by ON DELETE CASCADE, and
-- viewing_bookings, agent_booking_requests, agent_booking_staff_flags, leads,
-- callback_requests, and rental_applications would otherwise keep the row but
-- lose the listing (ON DELETE SET NULL). The keeper is the same property, so
-- the customer request belongs on the listing that stays public. The backup
-- still has the original foreign key. Rollback points it back.
-- Photos, video OCR, moderation history, price history, viewing config, and
-- favourites stay with the duplicate. saved_properties and saved_listings are
-- unique per user and listing, so moving a favourite onto the keeper collides
-- when the user already saved the live copy. Those rows are backed up and
-- deleted. Advertising links, email logs, notification links, and
-- whatsapp_message_logs are not rewritten here and are not repointed. If one
-- of those tables has a foreign key, the generic path backs the row up and
-- sets the listing column to null, which is what ON DELETE SET NULL already
-- does. This migration does not change WhatsApp application code.
--
-- Child rows that restrict or cascade are deleted from the leaves inward
-- before the properties row, after the backup insert.
--
-- Idempotent. Guards log one NOTICE per payload id. The last NOTICE is
-- duplicate_delete_174 deleted_count <n>.
-- Manual rollback: scripts/rollback-174-duplicate-deletes.sql
-- That file is not a migration and does not run on deploy.
-- Uganda only (app.country_code = UG).

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

DO $do_174$
DECLARE
  specs jsonb := $duplicate_delete_174$
[
  {
    "id": "0d36b15c-c22e-4e54-a2f6-59bd71faee4c",
    "kept_id": "6baf0035-d2cd-4c97-9925-ba7765f2e382",
    "origin": "169"
  },
  {
    "id": "0df40bd8-98df-48ca-8855-a4b8cf186ef7",
    "kept_id": "daf5a251-6370-4f0e-bdc0-5ecbbf62f751",
    "origin": "169"
  },
  {
    "id": "262c8c54-0ed5-4705-9b76-7fe7b0ee4d27",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "origin": "169"
  },
  {
    "id": "29b7270b-fadf-4438-9031-29296a2430da",
    "kept_id": "81607d0b-02d5-4280-a35e-454bffdc025f",
    "origin": "169"
  },
  {
    "id": "2a7e026a-4584-487f-b925-9f498dd4618a",
    "kept_id": "33b090bb-d4d0-49ca-8c55-3cee4c2c8a8f",
    "origin": "169"
  },
  {
    "id": "2ffcedfc-4c5f-4798-aa43-74bdc48cbbd2",
    "kept_id": "33517389-9a12-41cd-82dc-95cd600c476a",
    "origin": "169"
  },
  {
    "id": "3265908c-d4c3-40f6-aca8-4287b01431f4",
    "kept_id": "24768f13-91f5-4e51-9a8c-2f0fb66826bf",
    "origin": "169"
  },
  {
    "id": "484ddf79-7ea0-47a6-b32c-7207b8ada2cb",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "origin": "169"
  },
  {
    "id": "54090374-ad9a-44d1-92d7-6d5f639b8392",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "origin": "169"
  },
  {
    "id": "57344404-9f57-4030-8bb4-485e606da27e",
    "kept_id": "723bb908-a360-47db-ae4a-b6e893693a6b",
    "origin": "169"
  },
  {
    "id": "62e2050c-979c-4a2a-8b98-f148fdb61f51",
    "kept_id": "c31a706f-9549-482d-bba4-6bea2c7128ce",
    "origin": "169"
  },
  {
    "id": "6655cf6f-a918-4b5e-bd21-ef979c06a4e0",
    "kept_id": "1938ad2b-7a81-4bd2-bc7f-e4359b1bf222",
    "origin": "169"
  },
  {
    "id": "6a230e07-3bc6-4afa-88e0-5e4e8f9e3d97",
    "kept_id": "38a8f8f2-80f1-4929-9311-fcb70df13472",
    "origin": "169"
  },
  {
    "id": "6ce2039d-7048-42e0-812a-62eb1fd9da7b",
    "kept_id": "d23dc139-1aa0-4a23-aa8a-bda63fbea3c5",
    "origin": "169"
  },
  {
    "id": "701dddd0-dcea-40a6-9067-cd51a321fc2c",
    "kept_id": "daf5a251-6370-4f0e-bdc0-5ecbbf62f751",
    "origin": "169"
  },
  {
    "id": "7031c11d-a2c3-4a05-95af-6c833c1446c7",
    "kept_id": "153e752f-6440-4674-8a91-d3b278706dcd",
    "origin": "169"
  },
  {
    "id": "797fa062-d50d-4cd2-951c-11021438919a",
    "kept_id": "febb7e47-dfa1-47a7-bb94-b6037d0dd931",
    "origin": "169"
  },
  {
    "id": "8870b5bc-529e-499e-97b2-fe501a47f5a3",
    "kept_id": "55dbe736-6d19-4048-82c6-31ba499e1883",
    "origin": "169"
  },
  {
    "id": "8c28abbd-42bb-4af7-a5a1-6a3142691337",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "origin": "169"
  },
  {
    "id": "927d17fb-df88-476a-a3c5-4bf787bcae38",
    "kept_id": "dab6cbc2-eeef-4200-85b3-ae3e1873e2ec",
    "origin": "169"
  },
  {
    "id": "93aae4c0-a705-43e2-9032-63cd4b6d513a",
    "kept_id": "e91eadcb-e927-47a1-9825-49882a8abf5c",
    "origin": "169"
  },
  {
    "id": "943d3558-269a-4434-8ab5-0a7bbac46a2c",
    "kept_id": "dc719955-16a3-4a43-9d92-d7e1c0a90982",
    "origin": "169"
  },
  {
    "id": "97b9ed7d-01a1-41bc-ae7e-8624111199e2",
    "kept_id": "5a265b07-987a-4858-aff6-c6f81d63cfa4",
    "origin": "169"
  },
  {
    "id": "a46791fb-1a8d-49bc-a618-8f2849594977",
    "kept_id": "57ce2518-e72f-47f3-b141-0b17ea5bb8d2",
    "origin": "169"
  },
  {
    "id": "a63c4ca6-ebf3-4203-8ca7-ddb6525f9bd2",
    "kept_id": "9347ff9c-4409-49ab-871a-b029989c163a",
    "origin": "169"
  },
  {
    "id": "afeabc62-c609-4c81-9494-ae30f037af19",
    "kept_id": "8e268168-b3b5-411a-9311-efbdc392fdfc",
    "origin": "169"
  },
  {
    "id": "b2635f95-c6d1-427e-bade-3e7fdff32cc0",
    "kept_id": "92ffad95-1877-4933-b4d1-265de1802898",
    "origin": "169"
  },
  {
    "id": "be596c36-d9ef-4127-bf52-6a7b05829a9c",
    "kept_id": "a4f03d01-a05e-4131-afd6-9b312218bb12",
    "origin": "169"
  },
  {
    "id": "cbb0307b-2b82-4553-ab7e-65ab9d3d64fb",
    "kept_id": "f1912049-31a0-4f95-92bf-071653dddb39",
    "origin": "169"
  },
  {
    "id": "d3750ae4-8295-420d-b149-7506c71d46a3",
    "kept_id": "a4f03d01-a05e-4131-afd6-9b312218bb12",
    "origin": "169"
  },
  {
    "id": "d843c96a-3e39-405b-bd93-a30df7a013ba",
    "kept_id": "a5f779fa-1173-48fd-bd8d-02ce5db8eefc",
    "origin": "169"
  },
  {
    "id": "e5090ae2-e30a-4dcc-bc34-7e55af84a2fb",
    "kept_id": "6b778c5c-1dfc-4d87-a0bd-fb19cddbc5b3",
    "origin": "169"
  },
  {
    "id": "e6832dca-3d6b-4805-a31c-5832d7e79a90",
    "kept_id": "c3c94a60-f3d4-4d10-8fb8-9b50d5c61cd0",
    "origin": "169"
  },
  {
    "id": "f06aa4c9-4497-40bd-9690-4ff06123e660",
    "kept_id": "82b7baa8-bf38-4ac7-ab80-251710e17042",
    "origin": "169"
  },
  {
    "id": "0e55db22-33bc-41fd-9374-ba8739a403c3",
    "kept_id": "453483f5-c69f-4953-9085-38c49ab81123",
    "origin": "170"
  },
  {
    "id": "18448dce-f5b9-4231-bbc2-117426aa327e",
    "kept_id": "4ede4399-9ab9-41a3-a90d-18c75e294bf5",
    "origin": "170"
  },
  {
    "id": "50ce7080-6e74-454d-9deb-7686f08081af",
    "kept_id": "496006a9-d203-437c-a722-d99fe7d8df03",
    "origin": "170"
  },
  {
    "id": "5649cd32-4d34-4fff-ba2a-d0c6d97c0e3b",
    "kept_id": "8a94e5a2-9255-447e-97cd-9ec96f00a37a",
    "origin": "170"
  },
  {
    "id": "776cba37-0e45-49a4-b067-63819214ec7d",
    "kept_id": "f3bb5de0-b2c9-4502-9a06-d46bbaef0fcd",
    "origin": "170"
  },
  {
    "id": "7ed73e15-3da5-4211-94a9-a7b9d9b751e8",
    "kept_id": "413be7b0-aa54-4bd2-9308-da70ee50e3ae",
    "origin": "170"
  },
  {
    "id": "a37eb75e-0ce0-458a-b6a0-09dd5927fc22",
    "kept_id": "80d16eb6-6ae7-4a6a-9555-19a622b7b4bd",
    "origin": "170"
  },
  {
    "id": "ae6076d3-7a20-456f-9860-cd66c0118407",
    "kept_id": "203ae750-b64e-4dac-995b-b977c4448a2c",
    "origin": "170"
  },
  {
    "id": "c7cca0e9-d3df-4bdb-9399-236d489ccc18",
    "kept_id": "6fcccfe1-cec3-412f-ab9a-3275c568cffd",
    "origin": "170"
  },
  {
    "id": "ed7f1715-91f2-43ce-8384-11c8e3865490",
    "kept_id": "6fcccfe1-cec3-412f-ab9a-3275c568cffd",
    "origin": "170"
  },
  {
    "id": "15ca0488-2702-4a93-8dd8-c30225d65c8d",
    "kept_id": "250495cb-ddef-4499-a6d8-b977c2287193",
    "origin": "172"
  },
  {
    "id": "42f256d4-24f7-4adb-82a0-7875caef88fc",
    "kept_id": "df969b6a-ff97-4ba8-ab3c-c70c8b184465",
    "origin": "172"
  },
  {
    "id": "c7c9e859-2c2a-429a-b565-3a27c4cc3d55",
    "kept_id": "250495cb-ddef-4499-a6d8-b977c2287193",
    "origin": "172"
  },
  {
    "id": "c9ab858d-dcb5-4f05-bf62-86daa29b0721",
    "kept_id": "a8931632-68e9-4b59-8238-c88695145847",
    "origin": "172"
  },
  {
    "id": "d1cf79a4-f7b7-4c86-b538-0e25423a5da2",
    "kept_id": "46ba9de6-087d-4c38-bc85-b3f3e7155b5d",
    "origin": "172"
  }
]
$duplicate_delete_174$::jsonb;
  protected_ids uuid[] := ARRAY[
    '31846e1b-167a-472b-b197-b16d48bed01b'::uuid,
    '7316f714-29eb-46fe-8bb2-2752108eed61'::uuid
  ];
  rec record;
  fk record;
  dependent_row record;
  spec jsonb;
  p properties%ROWTYPE;
  keeper properties%ROWTYPE;
  spec_id uuid;
  keeper_id uuid;
  backup_name text;
  deleted_count integer := 0;
  deleted_n integer := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'duplicate_delete_174 skipped country_not_ug';
    RAISE NOTICE 'duplicate_delete_174 deleted_count 0';
    RETURN;
  END IF;

  IF jsonb_typeof(specs) IS DISTINCT FROM 'array' OR jsonb_array_length(specs) <> 49 THEN
    RAISE EXCEPTION 'duplicate_delete_174 expected 49 duplicates, found %', COALESCE(jsonb_array_length(specs), 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(specs) AS item(spec)
    GROUP BY item.spec->>'id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_delete_174 payload has a repeated id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(specs) AS item(spec)
    WHERE COALESCE(item.spec->>'kept_id', '') = ''
      OR item.spec->>'kept_id' = item.spec->>'id'
  ) THEN
    RAISE EXCEPTION 'duplicate_delete_174 payload keeper is missing or is the duplicate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(specs) AS item(spec)
    WHERE (item.spec->>'id')::uuid = ANY(protected_ids)
      OR (item.spec->>'kept_id')::uuid = ANY(protected_ids)
  ) THEN
    RAISE EXCEPTION 'duplicate_delete_174 payload includes a protected Najjera listing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace dn ON dn.oid = dst.relnamespace
    WHERE con.contype = 'f'
      AND dn.nspname = 'public'
      AND dst.relname = 'properties'
      AND (
        array_length(con.conkey, 1) IS DISTINCT FROM 1
        OR array_length(con.confkey, 1) IS DISTINCT FROM 1
      )
  ) THEN
    RAISE EXCEPTION 'duplicate_delete_174 refuses a multi-column foreign key to properties';
  END IF;

  DROP TABLE IF EXISTS pg_temp.duplicate_delete_174_fks;
  CREATE TEMP TABLE duplicate_delete_174_fks (
    schema_name text NOT NULL,
    table_name text NOT NULL,
    column_name text NOT NULL,
    delete_action "char" NOT NULL,
    disposition text NOT NULL,
    delete_rank integer NOT NULL DEFAULT 0,
    pk_expr text NOT NULL,
    PRIMARY KEY (schema_name, table_name, column_name)
  ) ON COMMIT DROP;

  INSERT INTO duplicate_delete_174_fks (
    schema_name, table_name, column_name, delete_action, disposition, delete_rank, pk_expr
  )
  SELECT
    n.nspname,
    src.relname,
    att.attname,
    con.confdeltype,
    CASE
      WHEN (src.relname, att.attname) IN (
        ('property_inquiries', 'property_id'),
        ('viewing_bookings', 'listing_id'),
        ('agent_booking_requests', 'listing_id'),
        ('agent_booking_staff_flags', 'listing_id'),
        ('leads', 'listing_id'),
        ('callback_requests', 'listing_id'),
        ('rental_applications', 'listing_id')
      ) THEN 'repoint'
      WHEN con.confdeltype = 'n' THEN 'set_null'
      ELSE 'cascade_delete'
    END,
    0,
    pk.pk_expr
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = src.relnamespace
  JOIN pg_class dst ON dst.oid = con.confrelid
  JOIN pg_namespace dn ON dn.oid = dst.relnamespace
  JOIN pg_attribute att
    ON att.attrelid = src.oid
   AND att.attnum = con.conkey[1]
   AND NOT att.attisdropped
  JOIN pg_attribute destatt
    ON destatt.attrelid = dst.oid
   AND destatt.attnum = con.confkey[1]
   AND NOT destatt.attisdropped
  JOIN LATERAL (
    SELECT string_agg(format('%L, t.%I', pkatt.attname, pkatt.attname), ', ' ORDER BY k.ord) AS pk_expr
    FROM pg_index i
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute pkatt
      ON pkatt.attrelid = src.oid
     AND pkatt.attnum = k.attnum
     AND NOT pkatt.attisdropped
    WHERE i.indrelid = src.oid
      AND i.indisprimary
      AND k.attnum > 0
  ) pk ON TRUE
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND dn.nspname = 'public'
    AND dst.relname = 'properties'
    AND destatt.attname = 'id'
    AND array_length(con.conkey, 1) = 1
    AND array_length(con.confkey, 1) = 1
    AND src.relkind = 'r'
    AND pk.pk_expr IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace dn ON dn.oid = dst.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND dn.nspname = 'public'
      AND dst.relname = 'properties'
      AND src.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1
        FROM duplicate_delete_174_fks f
        WHERE f.schema_name = n.nspname
          AND f.table_name = src.relname
          AND f.column_name = (
            SELECT a.attname
            FROM pg_attribute a
            WHERE a.attrelid = src.oid
              AND a.attnum = con.conkey[1]
          )
      )
  ) THEN
    RAISE EXCEPTION 'duplicate_delete_174 foreign key to properties has no primary key';
  END IF;

  WITH RECURSIVE edges AS (
    SELECT DISTINCT referencing_table.relname AS child_name, referenced_table.relname AS parent_name
    FROM pg_constraint con
    JOIN pg_class referencing_table ON referencing_table.oid = con.conrelid
    JOIN pg_namespace cn ON cn.oid = referencing_table.relnamespace
    JOIN pg_class referenced_table ON referenced_table.oid = con.confrelid
    JOIN pg_namespace pn ON pn.oid = referenced_table.relnamespace
    WHERE con.contype = 'f'
      AND cn.nspname = 'public'
      AND pn.nspname = 'public'
      AND referencing_table.relname <> referenced_table.relname
      AND referencing_table.relname IN (
        SELECT table_name FROM duplicate_delete_174_fks WHERE disposition = 'cascade_delete'
      )
      AND referenced_table.relname IN (
        SELECT table_name FROM duplicate_delete_174_fks WHERE disposition = 'cascade_delete'
      )
  ),
  walk AS (
    SELECT table_name COLLATE "C" AS table_name, 0 AS depth
    FROM duplicate_delete_174_fks
    WHERE disposition = 'cascade_delete'
    UNION ALL
    SELECT edges.child_name::text COLLATE "C", walk.depth + 1
    FROM walk
    JOIN edges ON edges.parent_name COLLATE "C" = walk.table_name
    WHERE walk.depth < 8
  )
  UPDATE duplicate_delete_174_fks AS f
  SET delete_rank = ranked.max_depth
  FROM (
    SELECT table_name, MAX(depth) AS max_depth
    FROM walk
    GROUP BY table_name
  ) AS ranked
  WHERE f.table_name = ranked.table_name
    AND f.disposition = 'cascade_delete';

  CREATE TABLE IF NOT EXISTS deleted_duplicates_backup_174_properties (
    property_id UUID PRIMARY KEY,
    kept_property_id UUID NOT NULL,
    origin TEXT NOT NULL,
    before_row JSONB NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  FOR fk IN
    SELECT DISTINCT schema_name, table_name
    FROM duplicate_delete_174_fks
    ORDER BY schema_name, table_name
  LOOP
    backup_name := 'deleted_duplicates_backup_174_' || fk.table_name;
    IF length(backup_name) > 63 THEN
      RAISE EXCEPTION 'duplicate_delete_174 backup name too long for %', fk.table_name;
    END IF;
    EXECUTE format($create_backup$
      CREATE TABLE IF NOT EXISTS %I (
        backup_id BIGSERIAL PRIMARY KEY,
        property_id UUID NOT NULL,
        kept_property_id UUID NOT NULL,
        source_schema TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_column TEXT NOT NULL,
        source_pk JSONB NOT NULL,
        before_row JSONB NOT NULL,
        disposition TEXT NOT NULL,
        delete_rank INTEGER NOT NULL DEFAULT 0,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (property_id, source_column, source_pk)
      )
    $create_backup$, backup_name);
  END LOOP;

  FOR rec IN
    SELECT item.spec
    FROM jsonb_array_elements(specs) AS item(spec)
    ORDER BY item.spec->>'id'
  LOOP
    spec := rec.spec;
    spec_id := (spec->>'id')::uuid;
    keeper_id := NULLIF(spec->>'kept_id', '')::uuid;

    IF spec_id = ANY(protected_ids) OR keeper_id = ANY(protected_ids) THEN
      RAISE NOTICE 'duplicate_delete_174 % skipped protected_najjera', spec_id;
      CONTINUE;
    END IF;

    SELECT * INTO p
    FROM properties
    WHERE id = spec_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE NOTICE 'duplicate_delete_174 % skipped missing', spec_id;
      CONTINUE;
    END IF;

    IF lower(btrim(coalesce(p.status, ''))) IS DISTINCT FROM 'hidden'
      OR lower(btrim(coalesce(p.moderation_stage, ''))) IS DISTINCT FROM 'hidden' THEN
      RAISE NOTICE 'duplicate_delete_174 % skipped not_hidden', spec_id;
      CONTINUE;
    END IF;

    IF keeper_id IS NULL OR keeper_id = p.id THEN
      RAISE NOTICE 'duplicate_delete_174 % skipped keeper_missing', spec_id;
      CONTINUE;
    END IF;

    SELECT * INTO keeper
    FROM properties
    WHERE id = keeper_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE NOTICE 'duplicate_delete_174 % skipped keeper_missing', spec_id;
      CONTINUE;
    END IF;

    IF keeper.id = p.id
      OR lower(btrim(coalesce(keeper.status, ''))) NOT IN ('approved', 'live', 'published') THEN
      RAISE NOTICE 'duplicate_delete_174 % skipped keeper_not_public', spec_id;
      CONTINUE;
    END IF;

    INSERT INTO deleted_duplicates_backup_174_properties (
      property_id, kept_property_id, origin, before_row
    )
    VALUES (p.id, keeper.id, COALESCE(spec->>'origin', ''), to_jsonb(p))
    ON CONFLICT (property_id) DO UPDATE
    SET kept_property_id = EXCLUDED.kept_property_id,
        origin = EXCLUDED.origin,
        before_row = EXCLUDED.before_row,
        backed_up_at = NOW();

    FOR fk IN
      SELECT *
      FROM duplicate_delete_174_fks
      ORDER BY schema_name, table_name, column_name
    LOOP
      backup_name := 'deleted_duplicates_backup_174_' || fk.table_name;
      FOR dependent_row IN EXECUTE format(
        'SELECT to_jsonb(t) AS before_row, jsonb_build_object(%s) AS source_pk FROM %I.%I AS t WHERE t.%I = $1',
        fk.pk_expr, fk.schema_name, fk.table_name, fk.column_name
      ) USING p.id
      LOOP
        EXECUTE format($insert_backup$
          INSERT INTO %I (
            property_id, kept_property_id, source_schema, source_table, source_column,
            source_pk, before_row, disposition, delete_rank
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (property_id, source_column, source_pk) DO UPDATE
          SET kept_property_id = EXCLUDED.kept_property_id,
              before_row = EXCLUDED.before_row,
              disposition = EXCLUDED.disposition,
              delete_rank = EXCLUDED.delete_rank,
              backed_up_at = NOW()
        $insert_backup$, backup_name)
        USING p.id, keeper.id, fk.schema_name, fk.table_name, fk.column_name,
              dependent_row.source_pk, dependent_row.before_row, fk.disposition, fk.delete_rank;
      END LOOP;
    END LOOP;

    FOR fk IN
      SELECT *
      FROM duplicate_delete_174_fks
      WHERE disposition = 'repoint'
      ORDER BY schema_name, table_name, column_name
    LOOP
      EXECUTE format(
        'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
        fk.schema_name, fk.table_name, fk.column_name, fk.column_name
      ) USING keeper.id, p.id;
    END LOOP;

    FOR fk IN
      SELECT *
      FROM duplicate_delete_174_fks
      WHERE disposition = 'set_null'
      ORDER BY schema_name, table_name, column_name
    LOOP
      EXECUTE format(
        'UPDATE %I.%I SET %I = NULL WHERE %I = $1',
        fk.schema_name, fk.table_name, fk.column_name, fk.column_name
      ) USING p.id;
    END LOOP;

    FOR fk IN
      SELECT *
      FROM duplicate_delete_174_fks
      WHERE disposition = 'cascade_delete'
      ORDER BY delete_rank DESC, schema_name, table_name, column_name
    LOOP
      EXECUTE format(
        'DELETE FROM %I.%I WHERE %I = $1',
        fk.schema_name, fk.table_name, fk.column_name
      ) USING p.id;
    END LOOP;

    DELETE FROM properties WHERE id = p.id;
    GET DIAGNOSTICS deleted_n = ROW_COUNT;
    IF deleted_n <> 1 THEN
      RAISE EXCEPTION 'duplicate_delete_174 deleted % rows for %', deleted_n, p.id;
    END IF;

    deleted_count := deleted_count + 1;
    RAISE NOTICE 'duplicate_delete_174 % deleted', p.id;
  END LOOP;

  RAISE NOTICE 'duplicate_delete_174 deleted_count %', deleted_count;
END
$do_174$;
