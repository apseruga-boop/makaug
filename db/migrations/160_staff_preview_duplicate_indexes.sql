-- Staff listing preview was cancelling with statement timeout (57014).
-- EXPLAIN on production showed DUPLICATE_CANDIDATES_SQL as a sequential scan
-- of properties: an OR between `source url ILIKE '%post id%'` and a phone-suffix
-- expression cannot use the existing btree indexes. The phone branch and the
-- source-url branch are now separate (UNION ALL), and each has an index that
-- matches its predicate exactly.
--
-- CONCURRENTLY keeps reads and writes moving while the indexes build. The
-- migrator runs this file outside a transaction because CREATE INDEX
-- CONCURRENTLY cannot run inside one.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_preview_phone_suffix_area
  ON properties (
    (RIGHT(regexp_replace(COALESCE(lister_phone, ''), '\D', '', 'g'), 9)),
    (LOWER(COALESCE(area, '')))
  )
  WHERE COALESCE(lister_phone, '') <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_preview_source_url_trgm
  ON properties USING GIN (
    (COALESCE(
      extra_fields->>'source_url',
      extra_fields->>'source_post_url',
      extra_fields->>'tiktok_url',
      extra_fields->>'youtube_url',
      extra_fields->>'video_url',
      ''
    )) gin_trgm_ops
  )
  WHERE COALESCE(
    extra_fields->>'source_url',
    extra_fields->>'source_post_url',
    extra_fields->>'tiktok_url',
    extra_fields->>'youtube_url',
    extra_fields->>'video_url',
    ''
  ) <> '';
