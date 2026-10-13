-- Read-only synthetic SQL equivalence fixture. No application tables are read.
-- Old query captured from bd32bb8672aa22881b47bd9ecb435165f48346b6.
-- New query must match the actual homepage:true source query in the paired test.
WITH fixture_inputs (id,title,description,extra_fields,status,source,listed_via,lister_name,lister_email,inquiry_reference,created_at,updated_at) AS (
 VALUES ('00000000-0000-4000-8000-000000000001', 'Property 1', 'A reviewed property in Uganda.', '{}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-10T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000002', 'Property 2', 'A reviewed property in Uganda.', '{"found_online": true, "source_platform": "TikTok", "source_name": "Example Homes", "source_url": "https://www.tiktok.com/@example/video/7000000000000000001", "image_rights_confirmed": true}', 'live', 'social_search_sourced_listings', 'found_online', '', '', '', '2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000003', 'Property 3', 'A reviewed property in Uganda.', '{"found_online": true, "source_platform": "TikTok", "source_name": "Example Homes", "source_url": "https://www.tiktok.com/@example/video/7000000000000000001"}', 'published', 'social_search_sourced_listings', 'found_online', '', '', '', '2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000004', 'Property 4', 'A reviewed property in Uganda.', '{"found_online": true, "source_platform": "TikTok", "source_name": "Example Homes", "source_url": "https://www.tiktok.com/@example/video/7000000000000000001"}', 'approved', 'social_search_sourced_listings', 'found_online', '', '', '', '2026-10-08T12:00:00Z', '2026-10-10T11:00:00Z'),
 ('00000000-0000-4000-8000-000000000005', 'Property 5', 'A reviewed property in Uganda.', '{}', 'LIVE', '', '', '', '', '', '2026-10-08T12:00:00Z', NULL),
 ('00000000-0000-4000-8000-000000000006', 'Property 6', 'A reviewed property in Uganda.', '{"found_online": true, "source_platform": "TikTok", "source_name": "Example Homes", "source_url": "https://www.tiktok.com/@example/video/7000000000000000001"}', 'approved', 'social_search_sourced_listings', 'found_online', '', '', '', '2026-10-08T12:00:00Z', '2026-10-10T09:00:00Z'),
 ('00000000-0000-4000-8000-000000000007', 'Property 7', 'A reviewed property in Uganda.', '{}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-10T08:00:00Z'),
 ('00000000-0000-4000-8000-000000000008', 'Property 8', 'A reviewed property in Uganda.', '{}', 'published', '', '', '', '', '', '2026-10-08T12:00:00Z', NULL),
 ('00000000-0000-4000-8000-000000000009', 'Property 9', 'A reviewed property in Uganda.', '{}', 'pending', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000010', 'QA TEST - DELETE sample', 'A reviewed property in Uganda.', '{}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000011', 'Property 11', 'REMOVE AFTER QA', '{}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000012', 'Property 12', 'A reviewed property in Uganda.', '{"qa_test_delete": "yes"}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000013', 'Property 13', 'A reviewed property in Uganda.', '{}', 'approved', 'qa_fixture', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000014', 'Property 14', 'A reviewed property in Uganda.', '{}', 'approved', '', 'test_fixture', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000015', 'Property 15', 'A reviewed property in Uganda.', '{}', 'approved', '', '', 'QA Owner', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000016', 'Property 16', 'A reviewed property in Uganda.', '{}', 'approved', '', '', '', 'qa@example.com', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000017', 'Property 17', 'A reviewed property in Uganda.', '{}', 'approved', '', '', '', '', 'QA-FIXTURE', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000018', 'sdgsdgd', 'A reviewed property in Uganda.', '{}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z'),
 ('00000000-0000-4000-8000-000000000019', 'Property 19', 'A reviewed property in Uganda.', '{"non_public_test": true}', 'approved', '', '', '', '', '', '2026-10-08T12:00:00Z', '2026-10-11T12:00:00Z')
), properties AS (
 SELECT id::uuid, 'rent'::text AS listing_type, title, description,
 'Kyanja'::text AS area, 'Kampala'::text AS district,
 750000::numeric AS price, 'mo'::text AS price_period,
 false AS price_on_application, 'rent'::text AS transaction_type,
 1::int AS bedrooms, 1::int AS bathrooms, 'apartment'::text AS property_type,
 extra_fields::jsonb, status, source, listed_via, lister_name,lister_email,inquiry_reference,
 created_at::timestamptz,updated_at::timestamptz
 FROM fixture_inputs
), fixture_images (property_id,url,is_primary,sort_order,slot_key) AS (
 VALUES ('00000000-0000-4000-8000-000000000001', 'https://media.makaug.com/ordinary-primary.jpg', TRUE, 0, 'exterior'),
 ('00000000-0000-4000-8000-000000000001', 'https://media.makaug.com/ordinary-secondary.jpg', FALSE, 1, 'bedroom'),
 ('00000000-0000-4000-8000-000000000002', 'https://p19.tiktokcdn.com/source.jpg', TRUE, 0, 'source_media'),
 ('00000000-0000-4000-8000-000000000002', 'https://media.makaug.com/consented-staff.jpg', FALSE, 1, 'staff_upload'),
 ('00000000-0000-4000-8000-000000000003', 'https://p19.tiktokcdn.com/unconsented-source.jpg', TRUE, 0, 'source_media'),
 ('00000000-0000-4000-8000-000000000003', 'https://media.makaug.com/unconsented-staff.jpg', FALSE, 1, 'staff_upload'),
 ('00000000-0000-4000-8000-000000000004', 'https://media.makaug.com/own-video-still.jpg', TRUE, 0, 'video_key_frame_0'),
 ('00000000-0000-4000-8000-000000000006', 'https://media.makaug.com/unconsented-only.jpg', TRUE, 0, 'staff_upload')
), property_images AS (
 SELECT property_id::uuid,url,is_primary,sort_order,slot_key,
 '2026-10-10T00:00:00Z'::timestamptz AS created_at FROM fixture_images
), old_homepage AS (
-- BEGIN OLD HOMEPAGE
SELECT
       p.id, p.listing_type, p.title, p.description, p.area, p.district,
       p.price, p.price_period, p.price_on_application, p.transaction_type, p.bedrooms, p.bathrooms, p.property_type,
       p.extra_fields->>'canonical_location_id' AS canonical_location_id,
       p.extra_fields->>'city' AS city,
       p.extra_fields->>'neighborhood' AS neighborhood,
       COALESCE(p.extra_fields->>'found_online_candidate', p.extra_fields->>'sourced_inventory_candidate') AS found_online_candidate,
       p.source, p.listed_via,
       jsonb_build_object('price_review', p.extra_fields->'price_review', 'found_online', p.extra_fields->'found_online', 'social_search_candidate', p.extra_fields->'social_search_candidate', 'sourced_inventory_candidate', p.extra_fields->'sourced_inventory_candidate', 'found_online_candidate', p.extra_fields->'found_online_candidate', 'source_badge', p.extra_fields->'source_badge', 'source_batch', p.extra_fields->'source_batch', 'source_platform', p.extra_fields->'source_platform', 'source_url', p.extra_fields->'source_url', 'source_post_url', p.extra_fields->'source_post_url', 'post_url', p.extra_fields->'post_url', 'platform_url', p.extra_fields->'platform_url', 'original_url', p.extra_fields->'original_url', 'source_contact_url', p.extra_fields->'source_contact_url', 'video_url', p.extra_fields->'video_url', 'source_name', p.extra_fields->'source_name', 'source_agent_name', p.extra_fields->'source_agent_name', 'resolved_location_label', p.extra_fields->'resolved_location_label', 'size_raw', p.extra_fields->'size_raw', 'land_title_available', p.extra_fields->'land_title_available', 'landTitleAvailable', p.extra_fields->'landTitleAvailable', 'title_available', p.extra_fields->'title_available', 'land_title_status', p.extra_fields->'land_title_status', 'source_title', p.extra_fields->'source_title', 'source_caption', p.extra_fields->'source_caption', 'source_description', p.extra_fields->'source_description', 'source_text', p.extra_fields->'source_text', 'source_visual_text', p.extra_fields->'source_visual_text', 'video_ocr_text', p.extra_fields->'video_ocr_text', 'frame_ocr_text', p.extra_fields->'frame_ocr_text', 'staff_corrected_fields', p.extra_fields->'staff_corrected_fields', 'king_review_corrected_fields', p.extra_fields->'king_review_corrected_fields', 'king_review_facts_confirmed', p.extra_fields->'king_review_facts_confirmed') AS copy_extra,
       p.created_at, p.updated_at, COUNT(*) OVER() AS seo_total,
       image.url AS primary_image_url,
       staff_img.url AS staff_primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT i.url
       FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) image ON TRUE
     LEFT JOIN LATERAL (
          SELECT si.url
          FROM property_images si
          JOIN properties sp ON sp.id = si.property_id
          WHERE si.property_id = p.id
            AND si.url !~* 'tiktokcdn|byteimg|tiktok\.com'
            AND (
              (
                si.slot_key = 'staff_upload'
                AND (
                  jsonb_typeof(sp.extra_fields->'staff_image_upload') = 'object'
                  OR LOWER(COALESCE(sp.extra_fields->>'image_rights_confirmed', '')) IN ('true', '1', 'yes')
                )
              )
              OR (
                COALESCE(si.slot_key, '') ~* '^(video_key_frame_|video_still_|video_recovery_still_)'
                AND si.url ~* '^https?://media\.makaug\.com/.+'
              )
            )
          ORDER BY (COALESCE(si.slot_key, '') = 'staff_upload') DESC, si.is_primary DESC, si.sort_order ASC, si.created_at ASC
          LIMIT 1
        ) staff_img ON true
     WHERE (LOWER(COALESCE(p.status, '')) IN ('approved', 'live', 'published') AND NOT (
    (COALESCE(p.title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%' OR COALESCE(p.description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%') OR (COALESCE(p.title, '') ILIKE '%QA TEST - DELETE%' OR COALESCE(p.description, '') ILIKE '%QA TEST - DELETE%') OR (COALESCE(p.title, '') ILIKE '%MAKAUG TRAINING%' OR COALESCE(p.description, '') ILIKE '%MAKAUG TRAINING%') OR (COALESCE(p.title, '') ILIKE '%REMOVE AFTER QA%' OR COALESCE(p.description, '') ILIKE '%REMOVE AFTER QA%')
    OR LOWER(TRIM(COALESCE(p.title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    OR COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  ))
       AND TRUE


     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
       LIMIT 6
-- END OLD HOMEPAGE
), new_homepage AS (
-- BEGIN NEW HOMEPAGE
WITH homepage_candidates AS MATERIALIZED (
       SELECT p.id FROM properties p
       WHERE (LOWER(COALESCE(p.status, '')) IN ('approved', 'live', 'published') AND NOT (
    (COALESCE(p.title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%' OR COALESCE(p.description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%') OR (COALESCE(p.title, '') ILIKE '%QA TEST - DELETE%' OR COALESCE(p.description, '') ILIKE '%QA TEST - DELETE%') OR (COALESCE(p.title, '') ILIKE '%MAKAUG TRAINING%' OR COALESCE(p.description, '') ILIKE '%MAKAUG TRAINING%') OR (COALESCE(p.title, '') ILIKE '%REMOVE AFTER QA%' OR COALESCE(p.description, '') ILIKE '%REMOVE AFTER QA%')
    OR LOWER(TRIM(COALESCE(p.title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    OR COALESCE(p.source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(p.lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
    OR COALESCE(p.lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(p.inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(p.extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(p.extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
  ))
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC
       LIMIT 6
     )
SELECT
       p.id, p.listing_type, p.title, p.description, p.area, p.district,
       p.price, p.price_period, p.price_on_application, p.transaction_type, p.bedrooms, p.bathrooms, p.property_type,
       p.extra_fields->>'canonical_location_id' AS canonical_location_id,
       p.extra_fields->>'city' AS city,
       p.extra_fields->>'neighborhood' AS neighborhood,
       COALESCE(p.extra_fields->>'found_online_candidate', p.extra_fields->>'sourced_inventory_candidate') AS found_online_candidate,
       p.source, p.listed_via,
       jsonb_build_object('price_review', p.extra_fields->'price_review', 'found_online', p.extra_fields->'found_online', 'social_search_candidate', p.extra_fields->'social_search_candidate', 'sourced_inventory_candidate', p.extra_fields->'sourced_inventory_candidate', 'found_online_candidate', p.extra_fields->'found_online_candidate', 'source_badge', p.extra_fields->'source_badge', 'source_batch', p.extra_fields->'source_batch', 'source_platform', p.extra_fields->'source_platform', 'source_url', p.extra_fields->'source_url', 'source_post_url', p.extra_fields->'source_post_url', 'post_url', p.extra_fields->'post_url', 'platform_url', p.extra_fields->'platform_url', 'original_url', p.extra_fields->'original_url', 'source_contact_url', p.extra_fields->'source_contact_url', 'video_url', p.extra_fields->'video_url', 'source_name', p.extra_fields->'source_name', 'source_agent_name', p.extra_fields->'source_agent_name', 'resolved_location_label', p.extra_fields->'resolved_location_label', 'size_raw', p.extra_fields->'size_raw', 'land_title_available', p.extra_fields->'land_title_available', 'landTitleAvailable', p.extra_fields->'landTitleAvailable', 'title_available', p.extra_fields->'title_available', 'land_title_status', p.extra_fields->'land_title_status', 'source_title', p.extra_fields->'source_title', 'source_caption', p.extra_fields->'source_caption', 'source_description', p.extra_fields->'source_description', 'source_text', p.extra_fields->'source_text', 'source_visual_text', p.extra_fields->'source_visual_text', 'video_ocr_text', p.extra_fields->'video_ocr_text', 'frame_ocr_text', p.extra_fields->'frame_ocr_text', 'staff_corrected_fields', p.extra_fields->'staff_corrected_fields', 'king_review_corrected_fields', p.extra_fields->'king_review_corrected_fields', 'king_review_facts_confirmed', p.extra_fields->'king_review_facts_confirmed') AS copy_extra,
       p.created_at, p.updated_at,
       image.url AS primary_image_url,
       staff_img.url AS staff_primary_image_url
     FROM properties p
     JOIN homepage_candidates home ON home.id = p.id
     LEFT JOIN LATERAL (
       SELECT i.url
       FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) image ON TRUE
     LEFT JOIN LATERAL (
          SELECT si.url
          FROM property_images si
          JOIN properties sp ON sp.id = si.property_id
          WHERE si.property_id = p.id
            AND si.url !~* 'tiktokcdn|byteimg|tiktok\.com'
            AND (
              (
                si.slot_key = 'staff_upload'
                AND (
                  jsonb_typeof(sp.extra_fields->'staff_image_upload') = 'object'
                  OR LOWER(COALESCE(sp.extra_fields->>'image_rights_confirmed', '')) IN ('true', '1', 'yes')
                )
              )
              OR (
                COALESCE(si.slot_key, '') ~* '^(video_key_frame_|video_still_|video_recovery_still_)'
                AND si.url ~* '^https?://media\.makaug\.com/.+'
              )
            )
          ORDER BY (COALESCE(si.slot_key, '') = 'staff_upload') DESC, si.is_primary DESC, si.sort_order ASC, si.created_at ASC
          LIMIT 1
        ) staff_img ON true

     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC, p.id DESC

-- END NEW HOMEPAGE
), old_projection AS (
 SELECT to_jsonb(p)-'seo_total' AS row FROM old_homepage p
), new_projection AS (
 SELECT to_jsonb(p) AS row FROM new_homepage p
), differences AS (
 (SELECT row FROM old_projection EXCEPT ALL SELECT row FROM new_projection)
 UNION ALL
 (SELECT row FROM new_projection EXCEPT ALL SELECT row FROM old_projection)
)
SELECT
 (SELECT count(*)::int FROM old_homepage) AS old_rows,
 (SELECT count(*)::int FROM new_homepage) AS new_rows,
 (SELECT count(*)::int FROM differences) AS full_public_row_differences,
 (SELECT array_agg(id::text ORDER BY updated_at DESC NULLS LAST,created_at DESC,id DESC) FROM new_homepage) = ARRAY['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007'] AS expected_order,
 (SELECT array_agg(id ORDER BY updated_at DESC NULLS LAST,created_at DESC,id DESC) FROM old_homepage) =
 (SELECT array_agg(id ORDER BY updated_at DESC NULLS LAST,created_at DESC,id DESC) FROM new_homepage) AS order_equal,
 (SELECT bool_and(seo_total=8) FROM old_homepage) AS generic_total_still_exact,
 (SELECT bool_and(NOT(to_jsonb(p)?'seo_total')) FROM new_homepage p) AS homepage_omits_unused_total,
 (SELECT primary_image_url='https://media.makaug.com/ordinary-primary.jpg' FROM new_homepage WHERE id='00000000-0000-4000-8000-000000000001') AS ordinary_primary_preserved,
 (SELECT staff_primary_image_url='https://media.makaug.com/consented-staff.jpg' FROM new_homepage WHERE id='00000000-0000-4000-8000-000000000002') AS consented_staff_photo_preserved,
 (SELECT staff_primary_image_url IS NULL FROM new_homepage WHERE id='00000000-0000-4000-8000-000000000003') AS unconsented_staff_photo_excluded,
 (SELECT staff_primary_image_url='https://media.makaug.com/own-video-still.jpg' FROM new_homepage WHERE id='00000000-0000-4000-8000-000000000004') AS own_video_still_preserved;
