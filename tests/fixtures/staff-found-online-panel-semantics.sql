-- Read-only synthetic properties; no production table rows are accessed.
WITH property_values(n,status,moderation_stage,source,listed_via,extra_fields,created_at) AS (
 VALUES
 (1,'pending','pending','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:01:00Z'::timestamptz),
 (2,'pending','pending','manual','staff','{"source_url":"https://example.invalid/2"}'::jsonb,'2026-10-13T01:02:00Z'::timestamptz),
 (3,'pending','pending','manual','staff','{"found_online":false,"found_online_candidate":true}'::jsonb,'2026-10-13T01:03:00Z'::timestamptz),
 (4,'approved','pending','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:04:00Z'::timestamptz),
 (5,'','source_review','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:05:00Z'::timestamptz),
 (6,'pending','pending','qa_import','staff','{"found_online":true}'::jsonb,'2026-10-13T01:06:00Z'::timestamptz),
 (7,'pending','pending','found_online_property_source_v1','staff','{"found_online":true,"source_quality_review":{"suppressed":"YeS"}}'::jsonb,'2026-10-13T01:07:00Z'::timestamptz),
 (8,'pending','pending','manual','found_online','{"found_online":true,"source_quality_suppressed":"TRUE"}'::jsonb,'2026-10-13T01:08:00Z'::timestamptz),
 (9,'pending','pending','manual','staff','{"found_online":true,"is_test":"yes"}'::jsonb,'2026-10-13T01:09:00Z'::timestamptz),
 (10,'pending','pending','manual','staff','{"found_online":true,"broker_submission":true}'::jsonb,'2026-10-13T01:10:00Z'::timestamptz),
 (11,'pending','pending','manual','staff','{}'::jsonb,'2026-10-13T01:11:00Z'::timestamptz),
 (12,'pending','pending','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:12:00Z'::timestamptz),
 (13,'PENDING','pending','manual','staff','{"found_online_candidate":"YeS"}'::jsonb,'2026-10-13T01:13:00Z'::timestamptz),
 (14,'pending','pending','manual','staff','{"source_post_url":"https://example.invalid/14"}'::jsonb,'2026-10-13T01:14:00Z'::timestamptz),
 (15,'pending','pending','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:15:00Z'::timestamptz),
 (16,'pending','pending','manual','staff','{"source_url":"https://example.invalid/16"}'::jsonb,'2026-10-13T01:16:00Z'::timestamptz),
 (17,'pending','pending','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:17:00Z'::timestamptz),
 (18,'pending','pending','manual','staff','{"found_online":true}'::jsonb,NULL::timestamptz),
 (19,'pending','pending','manual','staff','{"source_url":"","source_post_url":"https://example.invalid/19"}'::jsonb,'2026-10-13T01:04:00Z'::timestamptz),
 (20,'pending','pending','manual','staff','{"found_online":true}'::jsonb,'2026-10-13T01:15:00Z'::timestamptz)
),
properties AS (
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid AS id,
        'Fixture property'::text AS title,'Fixture area'::text AS area,'Fixture district'::text AS district,
        status,moderation_stage,source,listed_via,extra_fields,created_at,created_at AS updated_at,
        'fixture@example.invalid'::text AS lister_email,'FIXTURE-'||n::text AS inquiry_reference,
        'Fixture owner'::text AS lister_name
 FROM property_values
),
old_eight AS (SELECT p.id, p.title, p.area, p.district, p.status, p.created_at, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name
       FROM properties p
       WHERE (
    (
      LOWER(COALESCE(p.status, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      OR (
        COALESCE(p.status, '') = ''
        AND LOWER(COALESCE(p.moderation_stage, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      )
    )
    AND NOT (
    COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  )
    AND (
      NOT (
    COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )
      OR p.source = 'found_online_property_source_v1'
      OR p.listed_via = 'found_online'
    )
  ) AND (
    (
      COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') <> ''
    )
    AND NOT (
    LOWER(COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(p.extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
  )
  )
       ORDER BY p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 8),
new_eight AS (WITH found_online_candidates AS MATERIALIZED (
         SELECT p.id, p.created_at
         FROM properties p
         WHERE (
    (
      LOWER(COALESCE(p.status, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      OR (
        COALESCE(p.status, '') = ''
        AND LOWER(COALESCE(p.moderation_stage, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      )
    )
    AND NOT (
    COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  )
    AND (
      NOT (
    COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )
      OR p.source = 'found_online_property_source_v1'
      OR p.listed_via = 'found_online'
    )
  ) AND (
    (
      COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') <> ''
    )
    AND NOT (
    LOWER(COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(p.extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
  )
  )
       ),
       paged_found_online AS MATERIALIZED (
         SELECT p.id
         FROM found_online_candidates p
         ORDER BY p.created_at ASC NULLS LAST, p.id ASC
         LIMIT 8
       )
       SELECT p.id, p.title, p.area, p.district, p.status, p.created_at, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name
       FROM properties p
       JOIN paged_found_online q ON q.id = p.id
       ORDER BY p.created_at ASC NULLS LAST, p.id ASC),
old_all AS (SELECT p.id, p.title, p.area, p.district, p.status, p.created_at, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name
       FROM properties p
       WHERE (
    (
      LOWER(COALESCE(p.status, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      OR (
        COALESCE(p.status, '') = ''
        AND LOWER(COALESCE(p.moderation_stage, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      )
    )
    AND NOT (
    COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  )
    AND (
      NOT (
    COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )
      OR p.source = 'found_online_property_source_v1'
      OR p.listed_via = 'found_online'
    )
  ) AND (
    (
      COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') <> ''
    )
    AND NOT (
    LOWER(COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(p.extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
  )
  )
       ORDER BY p.created_at ASC NULLS LAST, p.id ASC
       LIMIT 20),
new_all AS (WITH found_online_candidates AS MATERIALIZED (
         SELECT p.id, p.created_at
         FROM properties p
         WHERE (
    (
      LOWER(COALESCE(p.status, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      OR (
        COALESCE(p.status, '') = ''
        AND LOWER(COALESCE(p.moderation_stage, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      )
    )
    AND NOT (
    COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  )
    AND (
      NOT (
    COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )
      OR p.source = 'found_online_property_source_v1'
      OR p.listed_via = 'found_online'
    )
  ) AND (
    (
      COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') <> ''
    )
    AND NOT (
    LOWER(COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(p.extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
  )
  )
       ),
       paged_found_online AS MATERIALIZED (
         SELECT p.id
         FROM found_online_candidates p
         ORDER BY p.created_at ASC NULLS LAST, p.id ASC
         LIMIT 20
       )
       SELECT p.id, p.title, p.area, p.district, p.status, p.created_at, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name
       FROM properties p
       JOIN paged_found_online q ON q.id = p.id
       ORDER BY p.created_at ASC NULLS LAST, p.id ASC),
exact_count AS (SELECT COUNT(*)::int AS total FROM properties p WHERE (
    (
      LOWER(COALESCE(p.status, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      OR (
        COALESCE(p.status, '') = ''
        AND LOWER(COALESCE(p.moderation_stage, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'resubmitted', 'in_review', 'under_review', 'needs_review', 'awaiting_review', 'queued', 'source_review', 'source_review_required', 'pending_king_source_review', 'king_review')
      )
    )
    AND NOT (
    COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  )
    AND (
      NOT (
    COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )
      OR p.source = 'found_online_property_source_v1'
      OR p.listed_via = 'found_online'
    )
  ) AND (
    (
      COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url', '') <> ''
    )
    AND NOT (
    LOWER(COALESCE(p.extra_fields->'source_quality_review'->>'suppressed', '')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(p.extra_fields->>'source_quality_suppressed', '')) IN ('true', '1', 'yes')
  )
  )),
differences AS (
 (SELECT * FROM old_eight EXCEPT ALL SELECT * FROM new_eight)
 UNION ALL (SELECT * FROM new_eight EXCEPT ALL SELECT * FROM old_eight)
 UNION ALL (SELECT * FROM old_all EXCEPT ALL SELECT * FROM new_all)
 UNION ALL (SELECT * FROM new_all EXCEPT ALL SELECT * FROM old_all)
)
SELECT
 (SELECT COUNT(*)::int FROM differences) AS old_new_full_row_difference_count,
 (SELECT COUNT(*)::int FROM new_eight) AS limited_rows,
 (SELECT COUNT(*)::int FROM new_all) AS all_reachable_rows,
 (SELECT total FROM exact_count) AS exact_total,
 ARRAY(SELECT right(id::text,12)::int FROM new_eight)=ARRAY[1,2,5,10,12,13,14,15] AS exact_head_order,
 ARRAY(SELECT right(id::text,12)::int FROM new_all)=ARRAY[1,2,5,10,12,13,14,15,20,16,17,18] AS exact_complete_order,
 (SELECT COUNT(*) FROM new_all)=(SELECT total FROM exact_count) AS count_and_reachability_match,
 NOT EXISTS(SELECT 1 FROM new_all WHERE right(id::text,12)::int IN(3,4,6,7,8,9,11,19)) AS all_safety_exclusions_preserved;

