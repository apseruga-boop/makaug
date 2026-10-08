-- expect-rows: >=3
-- Test rows: advertising campaign 8ac6b5da (advertiser "sddadada", invoiced),
-- short-stay payment e66cd9e6, and short-stay listing ST-000001 ("Dave Test").
-- The dry run lists every child row in any table with a foreign key to these
-- three rows, and the file deletes exactly those children, then the three rows.

CREATE TEMP TABLE _g193_targets (tbl text, id uuid, row_ctid text) ON COMMIT DROP;
INSERT INTO _g193_targets (tbl, id, row_ctid)
SELECT 'advertising_campaigns', id, ctid::text FROM advertising_campaigns
 WHERE id = '8ac6b5da-9ef7-4ca2-8256-2d0d25b8ee9b' AND advertiser_name = 'sddadada' AND quoted_amount_ugx = 300000
UNION ALL
SELECT 'st_listing_payment', id, ctid::text FROM st_listing_payment
 WHERE id = 'e66cd9e6-a6f7-47cd-b955-8e3a6df217b0' AND listing_id = '5d5aff31-054f-4f94-abb0-49fa773d1286' AND amount_ugx = 50000
UNION ALL
SELECT 'st_listing', id, ctid::text FROM st_listing
 WHERE id = '5d5aff31-054f-4f94-abb0-49fa773d1286' AND reference = 'ST-000001' AND host_name = 'Dave Test';

CREATE TEMP TABLE _g193_children (child_table text, child_column text, child_ctid text, parent_table text, parent_id uuid) ON COMMIT DROP;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT cl.relname AS child_table, att.attname AS child_column, pcl.relname AS parent_table
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_class pcl ON pcl.oid = con.confrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND pcl.relname IN ('advertising_campaigns', 'st_listing_payment', 'st_listing')
       AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'INSERT INTO _g193_children SELECT %L, %L, c.ctid::text, %L, c.%I FROM %I c JOIN _g193_targets t ON t.tbl = %L AND t.id = c.%I',
      fk.child_table, fk.child_column, fk.parent_table, fk.child_column, fk.child_table, fk.parent_table, fk.child_column
    );
  END LOOP;
END $$;

-- Children found (printed by the dry run). A child row that is itself one of
-- the three targets (the payment under the listing) is deleted once, as a target.
SELECT child_table, child_column, parent_table, parent_id, child_ctid
  FROM _g193_children
 ORDER BY child_table;

DO $$
DECLARE
  child record;
BEGIN
  FOR child IN SELECT c.* FROM _g193_children c
                WHERE NOT EXISTS (SELECT 1 FROM _g193_targets t WHERE t.tbl = c.child_table AND t.row_ctid = c.child_ctid) LOOP
    EXECUTE format('DELETE FROM %I WHERE ctid = %L::tid', child.child_table, child.child_ctid);
  END LOOP;
END $$;

SELECT c.child_table || ':' || c.child_ctid AS changed_id
  FROM _g193_children c
 WHERE NOT EXISTS (SELECT 1 FROM _g193_targets t WHERE t.tbl = c.child_table AND t.row_ctid = c.child_ctid);

DELETE FROM advertising_campaigns WHERE id IN (SELECT id FROM _g193_targets WHERE tbl = 'advertising_campaigns')
RETURNING 'advertising_campaigns:' || id AS changed_id;
DELETE FROM st_listing_payment WHERE id IN (SELECT id FROM _g193_targets WHERE tbl = 'st_listing_payment')
RETURNING 'st_listing_payment:' || id AS changed_id;
DELETE FROM st_listing WHERE id IN (SELECT id FROM _g193_targets WHERE tbl = 'st_listing')
RETURNING 'st_listing:' || id AS changed_id;
