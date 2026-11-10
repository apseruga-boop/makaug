-- Plot and land sales were stored as student accommodation when the
-- caption said "hostel" or "student" inside an estate name or a
-- "suitable for" line. Opening Preview & edit then replaced the
-- creator's title with a generated one such as "Student accommodation
-- in Uganda".
--
-- This puts those listings back to land, and puts a generated title
-- back to the source title. A title or category a staff editor already
-- saved (extra_fields.staff_corrected_fields) is left alone.
-- Nothing is deleted.
--
-- A production read on 10 Nov 2026 matched 9 student listings whose
-- own title is a plot or land sale (2 approved, including
-- MK-20261109-9F68D2) and 432 listings whose stored title is a
-- generated template while the source title is different (336
-- approved). 3 listings are in both sets, so 438 rows change
-- (337 of them approved). The migration counts the same rules again
-- when it runs.
--
-- schema_migrations records the filename. This is 211, after the reject
-- reason (209) and the 180-day hide (210). It runs once under this name.
--
-- Backup: plot_title_restore_211_backup.
-- Rollback: scripts/rollback-211-restore-plot-titles-and-category.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS plot_title_restore_211_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  before_row jsonb NOT NULL,
  restored_category boolean NOT NULL,
  restored_title boolean NOT NULL,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);

DO $restore$
DECLARE
  v_applied timestamptz := clock_timestamp();
  v_has_trigger boolean;
  v_category int;
  v_titles int;
  v_rows int;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'plot_title_211 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM plot_title_restore_211_backup) THEN
    RAISE NOTICE 'plot_title_211 skipped already_recorded';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_properties_updated_at'
      AND tgrelid = 'properties'::regclass
      AND NOT tgisinternal
  ) INTO v_has_trigger;

  CREATE TEMP TABLE plot_title_211_targets ON COMMIT DROP AS
  SELECT
    p.id,
    p.inquiry_reference,
    to_jsonb(p) AS before_row,
    (
      p.listing_type IN ('student', 'students')
      AND evidence.own ~ '(plots?|acres?|decimals?)[[:space:]]+for[[:space:]]+sale|land[[:space:]]+(for|on)[[:space:]]+sale|for[[:space:]]+sale[^.]{0,20}plots?|[0-9]+[[:space:]]*[x×][[:space:]]*[0-9]+[[:space:]]*fts?'
      AND evidence.own !~ 'student[[:space:]]+(accommodation|hostel|room)|hostel[[:space:]]+(room|bed|space)|per[[:space:]]+semester'
      AND NOT (
        jsonb_typeof(COALESCE(p.extra_fields->'staff_corrected_fields', '[]'::jsonb)) = 'array'
        AND p.extra_fields->'staff_corrected_fields' ? 'listing_type'
      )
    ) AS restore_category,
    (
      evidence.generated_title
      AND char_length(evidence.source_title) >= 8
      AND lower(evidence.source_title) <> lower(btrim(p.title))
      AND NOT (
        jsonb_typeof(COALESCE(p.extra_fields->'staff_corrected_fields', '[]'::jsonb)) = 'array'
        AND p.extra_fields->'staff_corrected_fields' ? 'title'
      )
    ) AS restore_title,
    evidence.source_title
  FROM properties p
  CROSS JOIN LATERAL (
    SELECT
      lower(concat_ws(' ',
        CASE
          WHEN p.title ~* '^(student accommodation( in | - )|land( for (sale|rent))? in |plots? for (sale|rent) in |property for (sale|rent) in |commercial property( for (sale|rent))? in |[0-9]+-bed )'
            OR p.title ~* '\((TikTok|YouTube|Instagram|Facebook) [0-9]{4}\)$'
            THEN ''
          ELSE p.title
        END,
        COALESCE(p.extra_fields->>'youtube_source_title', ''),
        COALESCE(p.extra_fields->>'source_title', '')
      )) AS own,
      (
        p.title ~* '^(student accommodation( in | - )|land( for (sale|rent))? in |plots? for (sale|rent) in |property for (sale|rent) in |commercial property( for (sale|rent))? in |[0-9]+-bed )'
        OR p.title ~* '\((TikTok|YouTube|Instagram|Facebook) [0-9]{4}\)$'
      ) AS generated_title,
      btrim(regexp_replace(regexp_replace(regexp_replace(
        COALESCE(NULLIF(btrim(p.extra_fields->>'youtube_source_title'), ''), NULLIF(btrim(p.extra_fields->>'source_title'), '')),
        'https?://\S+', ' ', 'gi'),
        '#[A-Za-z0-9_]+', ' ', 'g'),
        '\s+', ' ', 'g')) AS source_title
  ) evidence
  WHERE COALESCE(p.status, '') <> 'deleted';

  DELETE FROM plot_title_211_targets
  WHERE NOT restore_category AND NOT restore_title;

  SELECT
    COUNT(*) FILTER (WHERE restore_category),
    COUNT(*) FILTER (WHERE restore_title),
    COUNT(*)
  INTO v_category, v_titles, v_rows
  FROM plot_title_211_targets;

  IF v_rows = 0 THEN
    RAISE NOTICE 'plot_title_211 skipped no_matches category % titles %', v_category, v_titles;
    RETURN;
  END IF;

  IF v_has_trigger THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  INSERT INTO plot_title_restore_211_backup (
    property_id, inquiry_reference, before_row, restored_category, restored_title, applied_at
  )
  SELECT id, inquiry_reference, before_row, restore_category, restore_title, v_applied
  FROM plot_title_211_targets;

  UPDATE properties p
  SET listing_type = CASE WHEN t.restore_category THEN 'land' ELSE p.listing_type END,
      transaction_type = CASE
        WHEN t.restore_category AND COALESCE(NULLIF(btrim(p.transaction_type), ''), 'sale') <> 'rent' THEN 'sale'
        ELSE p.transaction_type
      END,
      price_period = CASE
        WHEN t.restore_category AND lower(COALESCE(p.price_period, '')) IN ('semester', 'sem', 'per_semester') THEN 'once'
        ELSE p.price_period
      END,
      property_type = CASE
        WHEN t.restore_category AND (p.property_type IS NULL OR p.property_type ~* 'hostel|student') THEN 'Land'
        ELSE p.property_type
      END,
      title = CASE
        WHEN t.restore_title THEN left(t.source_title, 180)
        ELSE p.title
      END,
      extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object('category_title_restore_211', true),
      updated_at = v_applied
  FROM plot_title_211_targets t
  WHERE p.id = t.id;

  IF v_has_trigger THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;

  RAISE NOTICE 'plot_title_211 category % titles % rows %', v_category, v_titles, v_rows;
END;
$restore$;
