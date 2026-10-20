-- Staff review-queue text search (title, area, source name, phone) now
-- includes live rows. The predicate is a leading-wildcard ILIKE across those
-- columns. The older trigram indexes are on LOWER(TRIM(COALESCE(...))) and
-- only for live rows, so `title ILIKE '%SUDA%'` cannot use them and the
-- planner sequentially scans properties, then counts the same scan again.
--
-- These indexes match the search expressions exactly. CONCURRENTLY keeps
-- reads and writes moving while they build. The migrator runs this file
-- outside a transaction because CREATE INDEX CONCURRENTLY cannot.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_title_trgm
  ON properties USING GIN (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_area_trgm
  ON properties USING GIN (area gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_district_trgm
  ON properties USING GIN (district gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_reference_trgm
  ON properties USING GIN (inquiry_reference gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_phone_trgm
  ON properties USING GIN (lister_phone gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_source_name_trgm
  ON properties USING GIN ((extra_fields->>'source_name') gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_search_source_platform_trgm
  ON properties USING GIN ((extra_fields->>'source_platform') gin_trgm_ops);
