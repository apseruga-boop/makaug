-- Canonical location source-of-truth repair.
--
-- This migration is transactional/idempotent and deliberately preserves the
-- original imported area before any display-field normalisation. Application
-- reads use canonical_location_id; area/district remain canonical materialised
-- labels for legacy admin/export consumers only.

UPDATE properties
SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
  'source_area_raw', COALESCE(NULLIF(extra_fields->>'source_area_raw', ''), NULLIF(TRIM(area), ''))
)
WHERE COALESCE(extra_fields->>'source_area_raw', '') = ''
  AND status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted')
  AND NULLIF(TRIM(COALESCE(area, '')), '') IS NOT NULL;

-- Snapshot only the fields used to decide whether the migration genuinely
-- changed a listing. The review gate at the end compares against this table,
-- so clean rows that only gained source_area_raw remain live.
CREATE TEMP TABLE location_snapshot_115 AS
SELECT
  id,
  status AS previous_status,
  moderation_stage AS previous_moderation_stage,
  moderation_reason AS previous_moderation_reason,
  moderation_notes AS previous_moderation_notes,
  area AS previous_area,
  district AS previous_district,
  extra_fields->>'region' AS previous_region,
  extra_fields->>'canonical_location_id' AS previous_canonical_location_id,
  extra_fields->>'canonical_location_level' AS previous_canonical_location_level,
  extra_fields->>'location_resolution_status' AS previous_resolution_status,
  approved_at AS previous_approved_at,
  reviewed_at AS previous_reviewed_at
FROM properties
WHERE status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted');

CREATE UNIQUE INDEX location_snapshot_115_id_idx ON location_snapshot_115(id);

-- Repair the two known registry defects before the generic canonical pass.
UPDATE properties
SET district = 'Kampala',
    area = 'Kyebando',
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'canonical_location_id', 'kampala:kyebando',
      'canonical_location_level', 'area',
      'region', 'Central',
      'location_resolution_status', 'canonical_registry_repair',
      'location_resolution_confidence', 1
    )
WHERE LOWER(COALESCE(extra_fields->>'canonical_location_id', '')) = 'wakiso:kyebando'
  AND status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted')
  AND (
    district IS DISTINCT FROM 'Kampala'
    OR area IS DISTINCT FROM 'Kyebando'
    OR extra_fields->>'canonical_location_id' IS DISTINCT FROM 'kampala:kyebando'
    OR extra_fields->>'canonical_location_level' IS DISTINCT FROM 'area'
    OR extra_fields->>'region' IS DISTINCT FROM 'Central'
  );

UPDATE properties
SET district = 'Buikwe',
    area = 'Njeru',
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'canonical_location_id', 'buikwe:njeru',
      'canonical_location_level', 'city',
      'region', 'Central',
      'location_resolution_status', 'canonical_registry_repair',
      'location_resolution_confidence', 1
    )
WHERE LOWER(COALESCE(extra_fields->>'canonical_location_id', '')) = 'jinja:njeru'
  AND status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted')
  AND (
    district IS DISTINCT FROM 'Buikwe'
    OR area IS DISTINCT FROM 'Njeru'
    OR extra_fields->>'canonical_location_id' IS DISTINCT FROM 'buikwe:njeru'
    OR extra_fields->>'canonical_location_level' IS DISTINCT FROM 'city'
    OR extra_fields->>'region' IS DISTINCT FROM 'Central'
  );

-- Resolve high-volume aliases and the coverage added by the definitive fix.
WITH canonical_map(alias_key, canonical_key, canonical_label, canonical_district, canonical_level) AS (
  VALUES
    ('kiira', 'wakiso:kira', 'Kira', 'Wakiso', 'city'),
    ('kiira town', 'wakiso:kira', 'Kira', 'Wakiso', 'city'),
    ('kira town', 'wakiso:kira', 'Kira', 'Wakiso', 'city'),
    ('kira municipality', 'wakiso:kira', 'Kira', 'Wakiso', 'city'),
    ('namasuba', 'wakiso:namasuba', 'Namasuba', 'Wakiso', 'area'),
    ('namasuba ndejje', 'wakiso:namasuba', 'Namasuba', 'Wakiso', 'area'),
    ('ndejje namasuba', 'wakiso:namasuba', 'Namasuba', 'Wakiso', 'area'),
    ('bukotto', 'kampala:bukoto', 'Bukoto', 'Kampala', 'area'),
    ('mmengo', 'kampala:mengo', 'Mengo', 'Kampala', 'area'),
    ('gaba', 'kampala:ggaba', 'Ggaba', 'Kampala', 'area'),
    ('lubaga', 'kampala:rubaga', 'Rubaga', 'Kampala', 'area'),
    ('munyonjo', 'kampala:munyonyo', 'Munyonyo', 'Kampala', 'area'),
    ('kajansi', 'wakiso:kajjansi', 'Kajjansi', 'Wakiso', 'area'),
    ('najjeera', 'wakiso:najjera', 'Najjera', 'Wakiso', 'area'),
    ('bujuuko', 'wakiso:bujjuko', 'Bujjuko', 'Wakiso', 'area'),
    ('kyebando', 'kampala:kyebando', 'Kyebando', 'Kampala', 'area'),
    ('kawempe', 'kampala:kawempe', 'Kawempe', 'Kampala', 'city'),
    ('bwaise', 'kampala:bwaise', 'Bwaise', 'Kampala', 'area'),
    ('kalerwe', 'kampala:kalerwe', 'Kalerwe', 'Kampala', 'area'),
    ('mulago', 'kampala:mulago', 'Mulago', 'Kampala', 'area'),
    ('kanyanya', 'kampala:kanyanya', 'Kanyanya', 'Kampala', 'area'),
    ('mpererwe', 'kampala:mpererwe', 'Mpererwe', 'Kampala', 'area'),
    ('komamboga', 'kampala:komamboga', 'Komamboga', 'Kampala', 'area'),
    ('kamwokya', 'kampala:kamwokya', 'Kamwokya', 'Kampala', 'area'),
    ('nsambya', 'kampala:nsambya', 'Nsambya', 'Kampala', 'area'),
    ('katwe', 'kampala:katwe', 'Katwe', 'Kampala', 'area'),
    ('namirembe', 'kampala:namirembe', 'Namirembe', 'Kampala', 'area'),
    ('kabowa', 'kampala:kabowa', 'Kabowa', 'Kampala', 'area'),
    ('bukesa', 'kampala:bukesa', 'Bukesa', 'Kampala', 'area'),
    ('busega', 'kampala:busega', 'Busega', 'Kampala', 'area'),
    ('matugga', 'wakiso:matugga', 'Matugga', 'Wakiso', 'area'),
    ('maya', 'wakiso:maya', 'Maya', 'Wakiso', 'area'),
    ('garuga', 'wakiso:garuga', 'Garuga', 'Wakiso', 'area'),
    ('buloba', 'wakiso:buloba', 'Buloba', 'Wakiso', 'area'),
    ('nsangi', 'wakiso:nsangi', 'Nsangi', 'Wakiso', 'area'),
    ('zana', 'wakiso:zana', 'Zana', 'Wakiso', 'area'),
    ('kisubi', 'wakiso:kisubi', 'Kisubi', 'Wakiso', 'area'),
    ('nabbingo', 'wakiso:nabbingo', 'Nabbingo', 'Wakiso', 'area'),
    ('kyengera', 'wakiso:kyengera', 'Kyengera', 'Wakiso', 'city'),
    ('njeru', 'buikwe:njeru', 'Njeru', 'Buikwe', 'city'),
    ('lugazi', 'buikwe:lugazi', 'Lugazi', 'Buikwe', 'city'),
    ('najjembe', 'buikwe:najjembe', 'Najjembe', 'Buikwe', 'area')
), normalized AS (
  SELECT
    p.id,
    LOWER(TRIM(REGEXP_REPLACE(COALESCE(p.area, ''), '[^a-zA-Z0-9]+', ' ', 'g'))) AS area_key,
    LOWER(CONCAT_WS(' ', p.area, p.address, p.title, p.description, p.extra_fields->>'resolved_location_label')) AS evidence_text,
    LOWER(COALESCE(p.extra_fields->>'canonical_location_id', '')) AS existing_key
  FROM properties p
  WHERE p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
), resolved AS (
  SELECT n.id, m.*
  FROM normalized n
  JOIN LATERAL (
    SELECT candidate.*
    FROM canonical_map candidate
    WHERE candidate.alias_key = n.area_key
       OR (
         (n.area_key = '' OR n.area_key ~ '(road|rd|street|avenue|highway|bypass|expressway)$')
         AND n.evidence_text ~ ('(^|[^a-z0-9])' || REPLACE(candidate.alias_key, ' ', '[[:space:]]+') || '([^a-z0-9]|$)')
       )
    ORDER BY (candidate.alias_key = n.area_key) DESC, LENGTH(candidate.alias_key) DESC
    LIMIT 1
  ) m ON TRUE
)
UPDATE properties p
SET district = r.canonical_district,
    area = r.canonical_label,
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'canonical_location_id', r.canonical_key,
      'canonical_location_level', r.canonical_level,
      'region', 'Central',
      'location_resolution_status', 'canonical_backfill_115',
      'location_resolution_confidence', CASE WHEN r.alias_key = LOWER(TRIM(REGEXP_REPLACE(COALESCE(p.area, ''), '[^a-zA-Z0-9]+', ' ', 'g'))) THEN 1 ELSE 0.9 END
    )
FROM resolved r
WHERE p.id = r.id
  AND p.status IN ('approved', 'pending')
  AND p.status NOT IN ('rejected', 'deleted')
  AND (
    p.district IS DISTINCT FROM r.canonical_district
    OR p.area IS DISTINCT FROM r.canonical_label
    OR p.extra_fields->>'canonical_location_id' IS DISTINCT FROM r.canonical_key
    OR p.extra_fields->>'canonical_location_level' IS DISTINCT FROM r.canonical_level
    OR p.extra_fields->>'region' IS DISTINCT FROM 'Central'
  );

-- Materialise canonical labels/districts for every already-resolved record.
-- Raw source text remains available only in source_area_raw.
WITH canonicalized AS (
  SELECT
    id,
    LOWER(extra_fields->>'canonical_location_id') AS canonical_key,
    LOWER(SPLIT_PART(extra_fields->>'canonical_location_id', ':', 1)) AS district_key,
    LOWER(SPLIT_PART(extra_fields->>'canonical_location_id', ':', 2)) AS location_key,
    LOWER(COALESCE(extra_fields->>'canonical_location_level', '')) AS canonical_level
  FROM properties
  WHERE COALESCE(extra_fields->>'canonical_location_id', '') LIKE '%:%'
    AND status IN ('approved', 'pending')
    AND status NOT IN ('rejected', 'deleted')
), labels AS (
  SELECT
    id,
    canonical_level,
    CASE district_key
      WHEN 'madi okollo' THEN 'Madi-Okollo'
      WHEN 'kabarole' THEN 'Kabarole'
      WHEN 'luwero' THEN 'Luwero'
      ELSE INITCAP(district_key)
    END AS canonical_district,
    CASE
      WHEN district_key IN ('kampala', 'wakiso', 'mukono', 'luwero', 'buikwe', 'mpigi', 'mityana', 'kayunga', 'masaka', 'rakai') THEN 'Central'
      WHEN district_key IN ('jinja', 'mbale', 'kamuli', 'iganga', 'busia', 'tororo', 'soroti') THEN 'Eastern'
      WHEN district_key IN ('gulu', 'lira', 'arua') THEN 'Northern'
      WHEN district_key IN ('mbarara', 'kabarole', 'hoima', 'masindi', 'kabale', 'kasese', 'bushenyi', 'ntungamo', 'rukungiri', 'sheema') THEN 'Western'
      ELSE NULL
    END AS canonical_region,
    CASE location_key
      WHEN 'ggaba' THEN 'Ggaba'
      WHEN 'kisaasi' THEN 'Kisaasi'
      WHEN 'kikuubo' THEN 'Kikuubo'
      WHEN 'kyaliwajjala' THEN 'Kyaliwajjala'
      WHEN 'njeru' THEN 'Njeru'
      WHEN 'kira mulawa' THEN 'Kira-Mulawa'
      WHEN 'kira nsasa' THEN 'Kira-Nsasa'
      ELSE INITCAP(location_key)
    END AS canonical_area
  FROM canonicalized
)
UPDATE properties p
SET district = l.canonical_district,
    area = CASE WHEN l.canonical_level IN ('district', 'region') THEN '' ELSE l.canonical_area END,
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'region', COALESCE(l.canonical_region, p.extra_fields->>'region'),
      'location_resolution_status', 'canonical_materialized_115',
      'location_resolution_confidence', 1
    )
FROM labels l
WHERE p.id = l.id
  AND p.status IN ('approved', 'pending')
  AND p.status NOT IN ('rejected', 'deleted')
  AND (
    p.district IS DISTINCT FROM l.canonical_district
    OR p.area IS DISTINCT FROM CASE WHEN l.canonical_level IN ('district', 'region') THEN '' ELSE l.canonical_area END
    OR (l.canonical_region IS NOT NULL AND p.extra_fields->>'region' IS DISTINCT FROM l.canonical_region)
  );

-- Anything still unresolved is kept at honest district-only granularity. Only
-- inventory-covered districts receive canonical keys; unknown district text
-- stays unmatched instead of becoming a fabricated canonical location.
WITH inventory_districts(alias_key, canonical_district, canonical_key) AS (
  VALUES
    ('kampala', 'Kampala', 'kampala:kampala'),
    ('wakiso', 'Wakiso', 'wakiso:wakiso'),
    ('mukono', 'Mukono', 'mukono:mukono'),
    ('jinja', 'Jinja', 'jinja:jinja'),
    ('mbarara', 'Mbarara', 'mbarara:mbarara'),
    ('gulu', 'Gulu', 'gulu:gulu'),
    ('mbale', 'Mbale', 'mbale:mbale'),
    ('lira', 'Lira', 'lira:lira'),
    ('arua', 'Arua', 'arua:arua'),
    ('luwero', 'Luwero', 'luwero:luwero'),
    ('luweero', 'Luwero', 'luwero:luwero'),
    ('kabarole', 'Kabarole', 'kabarole:kabarole'),
    ('fort portal', 'Kabarole', 'kabarole:kabarole'),
    ('hoima', 'Hoima', 'hoima:hoima'),
    ('masindi', 'Masindi', 'masindi:masindi'),
    ('masaka', 'Masaka', 'masaka:masaka'),
    ('kabale', 'Kabale', 'kabale:kabale'),
    ('buikwe', 'Buikwe', 'buikwe:buikwe'),
    ('mpigi', 'Mpigi', 'mpigi:mpigi'),
    ('mityana', 'Mityana', 'mityana:mityana'),
    ('kayunga', 'Kayunga', 'kayunga:kayunga'),
    ('kamuli', 'Kamuli', 'kamuli:kamuli'),
    ('iganga', 'Iganga', 'iganga:iganga'),
    ('busia', 'Busia', 'busia:busia'),
    ('tororo', 'Tororo', 'tororo:tororo'),
    ('soroti', 'Soroti', 'soroti:soroti'),
    ('kasese', 'Kasese', 'kasese:kasese'),
    ('bushenyi', 'Bushenyi', 'bushenyi:bushenyi'),
    ('ntungamo', 'Ntungamo', 'ntungamo:ntungamo'),
    ('rukungiri', 'Rukungiri', 'rukungiri:rukungiri'),
    ('sheema', 'Sheema', 'sheema:sheema'),
    ('rakai', 'Rakai', 'rakai:rakai')
), unresolved AS (
  SELECT
    id,
    LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM(COALESCE(district, '')), '[[:space:]]+(district|city|municipality)$', '', 'i'),
      '[^a-zA-Z0-9]+',
      ' ',
      'g'
    )) AS district_key
  FROM properties
  WHERE status IN ('approved', 'pending')
    AND status NOT IN ('rejected', 'deleted')
    AND (
      COALESCE(extra_fields->>'canonical_location_id', '') = ''
      OR COALESCE(extra_fields->>'canonical_location_level', '') = ''
    )
), matched AS (
  SELECT
    u.id,
    d.canonical_district,
    d.canonical_key,
    CASE
      WHEN d.canonical_district IN ('Kampala', 'Wakiso', 'Mukono', 'Luwero', 'Buikwe', 'Mpigi', 'Mityana', 'Kayunga', 'Masaka', 'Rakai') THEN 'Central'
      WHEN d.canonical_district IN ('Jinja', 'Mbale', 'Kamuli', 'Iganga', 'Busia', 'Tororo', 'Soroti') THEN 'Eastern'
      WHEN d.canonical_district IN ('Gulu', 'Lira', 'Arua') THEN 'Northern'
      WHEN d.canonical_district IN ('Mbarara', 'Kabarole', 'Hoima', 'Masindi', 'Kabale', 'Kasese', 'Bushenyi', 'Ntungamo', 'Rukungiri', 'Sheema') THEN 'Western'
      ELSE NULL
    END AS canonical_region
  FROM unresolved u
  JOIN inventory_districts d ON d.alias_key = u.district_key
)
UPDATE properties p
SET district = m.canonical_district,
    area = '',
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'canonical_location_id', m.canonical_key,
      'canonical_location_level', 'district',
      'region', m.canonical_region,
      'location_resolution_status', 'district_only_needs_review',
      'location_resolution_confidence', 0.5
    )
FROM matched m
WHERE p.id = m.id
  AND p.status IN ('approved', 'pending')
  AND p.status NOT IN ('rejected', 'deleted');

WITH inventory_districts(alias_key) AS (
  VALUES
    ('kampala'), ('wakiso'), ('mukono'), ('jinja'), ('mbarara'), ('gulu'), ('mbale'), ('lira'), ('arua'),
    ('luwero'), ('luweero'), ('kabarole'), ('fort portal'), ('hoima'), ('masindi'), ('masaka'), ('kabale'),
    ('buikwe'), ('mpigi'), ('mityana'), ('kayunga'), ('kamuli'), ('iganga'), ('busia'), ('tororo'), ('soroti'),
    ('kasese'), ('bushenyi'), ('ntungamo'), ('rukungiri'), ('sheema'), ('rakai')
), unmatched AS (
  SELECT p.id
  FROM properties p
  WHERE p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
    AND (
      COALESCE(p.extra_fields->>'canonical_location_id', '') = ''
      OR COALESCE(p.extra_fields->>'canonical_location_level', '') = ''
    )
    AND NOT EXISTS (
      SELECT 1
      FROM inventory_districts d
      WHERE d.alias_key = LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(TRIM(COALESCE(p.district, '')), '[[:space:]]+(district|city|municipality)$', '', 'i'),
        '[^a-zA-Z0-9]+',
        ' ',
        'g'
      ))
    )
)
UPDATE properties p
SET area = '',
    extra_fields = (
      COALESCE(p.extra_fields, '{}'::jsonb)
      - 'canonical_location_id'
      - 'canonical_location_level'
      - 'region'
    ) || jsonb_build_object(
      'location_resolution_status', 'unmatched_needs_review',
      'location_resolution_confidence', 0
    )
FROM unmatched u
WHERE p.id = u.id
  AND p.status IN ('approved', 'pending')
  AND p.status NOT IN ('rejected', 'deleted');

-- Arthur's B0 gate: any listing whose location assignment changed, or which
-- was newly classified as unmatched, leaves public inventory and returns to
-- human source review. The proposed canonical assignment and the complete
-- before-state stay visible to moderators in extra_fields.
WITH affected AS (
  SELECT
    p.id,
    s.previous_status,
    s.previous_moderation_stage,
    s.previous_moderation_reason,
    s.previous_moderation_notes,
    s.previous_area,
    s.previous_district,
    s.previous_region,
    s.previous_canonical_location_id,
    s.previous_canonical_location_level,
    s.previous_resolution_status,
    s.previous_approved_at,
    s.previous_reviewed_at,
    p.area AS proposed_area,
    p.district AS proposed_district,
    p.extra_fields->>'region' AS proposed_region,
    p.extra_fields->>'canonical_location_id' AS proposed_canonical_location_id,
    p.extra_fields->>'canonical_location_level' AS proposed_canonical_location_level,
    p.extra_fields->>'location_resolution_status' AS proposed_resolution_status
  FROM properties p
  JOIN location_snapshot_115 s ON s.id = p.id
  WHERE p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
    AND (
      p.area IS DISTINCT FROM s.previous_area
      OR p.district IS DISTINCT FROM s.previous_district
      OR p.extra_fields->>'region' IS DISTINCT FROM s.previous_region
      OR p.extra_fields->>'canonical_location_id' IS DISTINCT FROM s.previous_canonical_location_id
      OR p.extra_fields->>'canonical_location_level' IS DISTINCT FROM s.previous_canonical_location_level
      OR p.extra_fields->>'location_resolution_status' IS DISTINCT FROM s.previous_resolution_status
    )
), review_queue AS (
  SELECT
    a.*,
    CONCAT(
      'Location auto-reclassified from "',
      COALESCE(NULLIF(CONCAT_WS(', ', NULLIF(a.previous_area, ''), NULLIF(a.previous_district, ''), NULLIF(a.previous_region, '')), ''), '[unmatched]'),
      '" to "',
      COALESCE(NULLIF(CONCAT_WS(', ', NULLIF(a.proposed_area, ''), NULLIF(a.proposed_district, ''), NULLIF(a.proposed_region, '')), ''), '[unmatched]'),
      '" (', COALESCE(NULLIF(a.proposed_canonical_location_id, ''), 'unmatched'),
      '); confirm before re-publish.'
    ) AS review_note
  FROM affected a
), queued AS (
  UPDATE properties p
  SET status = CASE WHEN p.status = 'approved' THEN 'pending' ELSE p.status END,
      moderation_stage = CASE WHEN p.status = 'approved' THEN 'source_review' ELSE p.moderation_stage END,
      moderation_reason = CASE
        WHEN p.status = 'approved' THEN 'Location auto-reclassified; confirm canonical location before re-publish.'
        ELSE p.moderation_reason
      END,
      moderation_notes = CASE
        WHEN POSITION(q.review_note IN COALESCE(p.moderation_notes, '')) > 0 THEN p.moderation_notes
        ELSE CONCAT_WS(E'\n', NULLIF(p.moderation_notes, ''), q.review_note)
      END,
      reviewed_at = CASE WHEN p.status = 'approved' THEN NULL ELSE p.reviewed_at END,
      reviewed_by = CASE WHEN p.status = 'approved' THEN NULL ELSE p.reviewed_by END,
      approved_at = CASE WHEN p.status = 'approved' THEN NULL ELSE p.approved_at END,
      extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
        'location_review_required', true,
        'location_review_marker', 'canonical-location-source-review-115',
        'location_review_queued_at', NOW()::text,
        'location_review_note', q.review_note,
        'location_review_previous_status', q.previous_status,
        'location_review_previous_moderation_stage', q.previous_moderation_stage,
        'location_review_previous_moderation_reason', q.previous_moderation_reason,
        'location_review_previous_area', q.previous_area,
        'location_review_previous_district', q.previous_district,
        'location_review_previous_region', q.previous_region,
        'location_review_previous_canonical_location_id', q.previous_canonical_location_id,
        'location_review_previous_canonical_location_level', q.previous_canonical_location_level,
        'location_review_previous_approved_at', q.previous_approved_at,
        'location_review_previous_reviewed_at', q.previous_reviewed_at,
        'location_review_proposed_area', q.proposed_area,
        'location_review_proposed_district', q.proposed_district,
        'location_review_proposed_region', q.proposed_region,
        'location_review_proposed_canonical_location_id', q.proposed_canonical_location_id,
        'location_review_proposed_canonical_location_level', q.proposed_canonical_location_level,
        'location_review_proposed_resolution_status', q.proposed_resolution_status
      ),
      updated_at = NOW()
  FROM review_queue q
  WHERE p.id = q.id
    AND p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
    AND COALESCE(p.extra_fields->>'location_review_queued_at', '') = ''
  RETURNING p.id, q.previous_status, q.review_note
)
INSERT INTO property_moderation_events (
  property_id,
  actor_id,
  action,
  status_from,
  status_to,
  reason,
  notes,
  delivery
)
SELECT
  q.id,
  'migration-115',
  'location_auto_reclassified_source_review',
  q.previous_status,
  'pending',
  'Location auto-reclassified; human confirmation required.',
  q.review_note,
  jsonb_build_object('marker', 'canonical-location-source-review-115', 'automatic_publish', false)
FROM queued q
WHERE q.previous_status = 'approved';

DROP TABLE location_snapshot_115;

CREATE INDEX IF NOT EXISTS idx_properties_canonical_location_level_public
  ON properties (
    (extra_fields->>'canonical_location_level'),
    (extra_fields->>'canonical_location_id'),
    listing_type,
    status,
    created_at DESC
  )
  WHERE COALESCE(extra_fields->>'canonical_location_id', '') <> ''
    AND COALESCE(status, '') <> 'deleted';
