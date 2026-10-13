-- Read-only synthetic fixture: no production table rows are accessed.
-- Run through PostgreSQL to compare baseline and optimized panel queries.
WITH conversation_values(phone,status,assigned_to,last_summary,last_message_at,updated_at) AS (
 VALUES
 ('fixture-a','resolved','fixture-staff','Old summary','2026-10-13T12:00:00Z'::timestamptz,'2026-10-13T12:00:00Z'::timestamptz),
 ('fixture-b','open','other-staff',NULL,'2026-10-13T11:00:00Z'::timestamptz,'2026-10-13T11:00:00Z'::timestamptz),
 ('fixture-c','open','other-staff',NULL,NULL::timestamptz,'2026-10-13T13:01:00Z'::timestamptz),
 ('fixture-d','open',NULL,'Summary fallback',NULL::timestamptz,'2026-10-13T09:00:00Z'::timestamptz),
 ('fixture-e','escalated',NULL,NULL,'2026-10-13T08:00:00Z'::timestamptz,'2026-10-13T08:00:00Z'::timestamptz),
 ('fixture-f','needs_human',NULL,NULL,'2026-10-13T07:00:00Z'::timestamptz,'2026-10-13T07:00:00Z'::timestamptz),
 ('fixture-g','ai_active',NULL,NULL,'2026-10-13T06:00:00Z'::timestamptz,'2026-10-13T06:00:00Z'::timestamptz),
 ('fixture-h','awaiting_customer',NULL,NULL,'2026-10-13T05:00:00Z'::timestamptz,'2026-10-13T05:00:00Z'::timestamptz),
 ('fixture-i','open',NULL,NULL,'2026-10-13T04:00:00Z'::timestamptz,'2026-10-13T04:00:00Z'::timestamptz),
 ('fixture-j','resolved','other-staff','Must be excluded','2026-10-13T15:00:00Z'::timestamptz,'2026-10-13T15:00:00Z'::timestamptz),
 ('fixture-k','archived','fixture-staff',NULL,'2026-10-13T03:00:00Z'::timestamptz,'2026-10-13T03:00:00Z'::timestamptz)
),
whatsapp_conversation_state AS (
 SELECT phone,status,'rent'::text AS category,'normal'::text AS priority,assigned_to,last_summary,
        last_message_at,NULL::timestamptz AS last_inbound_at,NULL::timestamptz AS last_outbound_at,
        NULL::timestamptz AS last_ai_reply_at,NULL::timestamptz AS last_human_reply_at,
        '{"fixture":true}'::jsonb AS metadata,updated_at
 FROM conversation_values
),
whatsapp_messages(user_phone,message_type,payload,created_at) AS (
 VALUES
 ('fixture-a','text','{"body":"Older message"}'::jsonb,'2026-10-13T11:00:00Z'::timestamptz),
 ('fixture-a','text','{"effectiveBody":"Effective preview","body":"Unused body","text":"Unused text","reply":"Unused reply"}'::jsonb,'2026-10-13T14:00:00Z'::timestamptz),
 ('fixture-b','text','{"body":"Body preview","text":"Unused text","reply":"Unused reply"}'::jsonb,'2026-10-12T11:00:00Z'::timestamptz),
 ('fixture-c','text','{"text":"Older text"}'::jsonb,'2026-10-13T09:00:00Z'::timestamptz),
 ('fixture-c','text','{"text":"Text preview","reply":"Unused reply"}'::jsonb,'2026-10-13T10:00:00Z'::timestamptz),
 ('fixture-e','text','{"reply":"Reply preview"}'::jsonb,'2026-10-13T08:00:00Z'::timestamptz),
 ('fixture-f','image','{}'::jsonb,'2026-10-13T07:00:00Z'::timestamptz),
 ('fixture-h','text',jsonb_build_object('body',repeat('x',300)),'2026-10-13T05:00:00Z'::timestamptz),
 ('fixture-unrelated','text','{"body":"Unrelated history"}'::jsonb,'2026-10-14T05:00:00Z'::timestamptz)
),
whatsapp_intent_logs(user_phone,detected_intent,language,created_at) AS (
 VALUES
 ('fixture-a','older','en','2026-10-12T01:00:00Z'::timestamptz),
 ('fixture-a','rent','lg','2026-10-13T01:00:00Z'::timestamptz),
 ('fixture-c','older','en','2026-10-12T01:00:00Z'::timestamptz),
 ('fixture-c','sale','sw','2026-10-13T01:00:00Z'::timestamptz),
 ('fixture-e','general',NULL::text,'2026-10-13T01:00:00Z'::timestamptz),
 ('fixture-h','general','ar','2026-10-13T01:00:00Z'::timestamptz),
 ('fixture-unrelated','unrelated','en','2026-10-14T01:00:00Z'::timestamptz)
),
old_rows AS (WITH latest_message AS (
       SELECT DISTINCT ON (m.user_phone)
              m.user_phone,
              m.message_type,
              m.payload,
              m.created_at
       FROM whatsapp_messages m
       ORDER BY m.user_phone, m.created_at DESC
     ),
     latest_intent AS (
       SELECT DISTINCT ON (i.user_phone)
              i.user_phone,
              i.detected_intent,
              i.language,
              i.created_at
       FROM whatsapp_intent_logs i
       ORDER BY i.user_phone, i.created_at DESC
     )
     SELECT c.phone::text AS phone,
            c.status::text AS status,
            c.category::text AS category,
            c.priority::text AS priority,
            c.assigned_to::text AS assigned_to,
            LEFT(COALESCE(
              lm.payload->>'effectiveBody',
              lm.payload->>'body',
              lm.payload->>'text',
              lm.payload->>'reply',
              c.last_summary,
              lm.message_type,
              'WhatsApp conversation'
            ), 240) AS latest_preview,
            li.detected_intent::text AS last_intent,
            COALESCE(li.language, 'en')::text AS preferred_language,
            c.last_message_at,
            c.last_inbound_at,
            c.last_outbound_at,
            c.last_ai_reply_at,
            c.last_human_reply_at,
            c.metadata,
            c.updated_at
     FROM whatsapp_conversation_state c
     LEFT JOIN latest_message lm ON lm.user_phone = c.phone
     LEFT JOIN latest_intent li ON li.user_phone = c.phone
     WHERE c.assigned_to::text = 'fixture-staff'::text
        OR c.status IN ('needs_human','escalated','open','ai_active','awaiting_customer')
     ORDER BY COALESCE(c.last_message_at, lm.created_at, c.updated_at) DESC
     LIMIT 8),
candidate_rows AS (WITH candidate_conversations AS MATERIALIZED (
       SELECT c.phone, c.status, c.category, c.priority, c.assigned_to,
              c.last_summary, c.last_message_at, c.last_inbound_at, c.last_outbound_at,
              c.last_ai_reply_at, c.last_human_reply_at, c.metadata, c.updated_at,
              COALESCE(c.last_message_at, (
                SELECT m.created_at
                FROM whatsapp_messages m
                WHERE m.user_phone = c.phone
                ORDER BY m.created_at DESC
                LIMIT 1
              ), c.updated_at) AS panel_sort_at
       FROM whatsapp_conversation_state c
       WHERE c.assigned_to::text = 'fixture-staff'::text
          OR c.status IN ('needs_human','escalated','open','ai_active','awaiting_customer')
       ORDER BY panel_sort_at DESC
       LIMIT 8
     )
     SELECT c.phone::text AS phone,
            c.status::text AS status,
            c.category::text AS category,
            c.priority::text AS priority,
            c.assigned_to::text AS assigned_to,
            LEFT(COALESCE(
              lm.payload->>'effectiveBody',
              lm.payload->>'body',
              lm.payload->>'text',
              lm.payload->>'reply',
              c.last_summary,
              lm.message_type,
              'WhatsApp conversation'
            ), 240) AS latest_preview,
            li.detected_intent::text AS last_intent,
            COALESCE(li.language, 'en')::text AS preferred_language,
            c.last_message_at,
            c.last_inbound_at,
            c.last_outbound_at,
            c.last_ai_reply_at,
            c.last_human_reply_at,
            c.metadata,
            c.updated_at
     FROM candidate_conversations c
     LEFT JOIN LATERAL (
       SELECT m.message_type, m.payload
       FROM whatsapp_messages m
       WHERE m.user_phone = c.phone
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON TRUE
     LEFT JOIN LATERAL (
       SELECT i.detected_intent, i.language
       FROM whatsapp_intent_logs i
       WHERE i.user_phone = c.phone
       ORDER BY i.created_at DESC
       LIMIT 1
     ) li ON TRUE
     ORDER BY c.panel_sort_at DESC),
old_all AS (WITH latest_message AS (
       SELECT DISTINCT ON (m.user_phone)
              m.user_phone,
              m.message_type,
              m.payload,
              m.created_at
       FROM whatsapp_messages m
       ORDER BY m.user_phone, m.created_at DESC
     ),
     latest_intent AS (
       SELECT DISTINCT ON (i.user_phone)
              i.user_phone,
              i.detected_intent,
              i.language,
              i.created_at
       FROM whatsapp_intent_logs i
       ORDER BY i.user_phone, i.created_at DESC
     )
     SELECT c.phone::text AS phone,
            c.status::text AS status,
            c.category::text AS category,
            c.priority::text AS priority,
            c.assigned_to::text AS assigned_to,
            LEFT(COALESCE(
              lm.payload->>'effectiveBody',
              lm.payload->>'body',
              lm.payload->>'text',
              lm.payload->>'reply',
              c.last_summary,
              lm.message_type,
              'WhatsApp conversation'
            ), 240) AS latest_preview,
            li.detected_intent::text AS last_intent,
            COALESCE(li.language, 'en')::text AS preferred_language,
            c.last_message_at,
            c.last_inbound_at,
            c.last_outbound_at,
            c.last_ai_reply_at,
            c.last_human_reply_at,
            c.metadata,
            c.updated_at
     FROM whatsapp_conversation_state c
     LEFT JOIN latest_message lm ON lm.user_phone = c.phone
     LEFT JOIN latest_intent li ON li.user_phone = c.phone
     WHERE c.assigned_to::text = 'fixture-staff'::text
        OR c.status IN ('needs_human','escalated','open','ai_active','awaiting_customer')
     ORDER BY COALESCE(c.last_message_at, lm.created_at, c.updated_at) DESC
     LIMIT 20),
candidate_all AS (WITH candidate_conversations AS MATERIALIZED (
       SELECT c.phone, c.status, c.category, c.priority, c.assigned_to,
              c.last_summary, c.last_message_at, c.last_inbound_at, c.last_outbound_at,
              c.last_ai_reply_at, c.last_human_reply_at, c.metadata, c.updated_at,
              COALESCE(c.last_message_at, (
                SELECT m.created_at
                FROM whatsapp_messages m
                WHERE m.user_phone = c.phone
                ORDER BY m.created_at DESC
                LIMIT 1
              ), c.updated_at) AS panel_sort_at
       FROM whatsapp_conversation_state c
       WHERE c.assigned_to::text = 'fixture-staff'::text
          OR c.status IN ('needs_human','escalated','open','ai_active','awaiting_customer')
       ORDER BY panel_sort_at DESC
       LIMIT 20
     )
     SELECT c.phone::text AS phone,
            c.status::text AS status,
            c.category::text AS category,
            c.priority::text AS priority,
            c.assigned_to::text AS assigned_to,
            LEFT(COALESCE(
              lm.payload->>'effectiveBody',
              lm.payload->>'body',
              lm.payload->>'text',
              lm.payload->>'reply',
              c.last_summary,
              lm.message_type,
              'WhatsApp conversation'
            ), 240) AS latest_preview,
            li.detected_intent::text AS last_intent,
            COALESCE(li.language, 'en')::text AS preferred_language,
            c.last_message_at,
            c.last_inbound_at,
            c.last_outbound_at,
            c.last_ai_reply_at,
            c.last_human_reply_at,
            c.metadata,
            c.updated_at
     FROM candidate_conversations c
     LEFT JOIN LATERAL (
       SELECT m.message_type, m.payload
       FROM whatsapp_messages m
       WHERE m.user_phone = c.phone
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON TRUE
     LEFT JOIN LATERAL (
       SELECT i.detected_intent, i.language
       FROM whatsapp_intent_logs i
       WHERE i.user_phone = c.phone
       ORDER BY i.created_at DESC
       LIMIT 1
     ) li ON TRUE
     ORDER BY c.panel_sort_at DESC),
differences AS (
 (SELECT * FROM old_rows EXCEPT ALL SELECT * FROM candidate_rows)
 UNION ALL (SELECT * FROM candidate_rows EXCEPT ALL SELECT * FROM old_rows)
 UNION ALL (SELECT * FROM old_all EXCEPT ALL SELECT * FROM candidate_all)
 UNION ALL (SELECT * FROM candidate_all EXCEPT ALL SELECT * FROM old_all)
),
expected(phone,preview,intent,language) AS (
 VALUES ('fixture-a','Effective preview','rent','lg'),('fixture-b','Body preview',NULL,'en'),
 ('fixture-c','Text preview','sale','sw'),('fixture-d','Summary fallback',NULL,'en'),
 ('fixture-e','Reply preview','general','en'),('fixture-f','image',NULL,'en'),
 ('fixture-g','WhatsApp conversation',NULL,'en'),('fixture-h',repeat('x',240),'general','ar')
)
SELECT
 (SELECT COUNT(*)::int FROM differences) AS old_new_difference_rows,
 (SELECT COUNT(*)::int FROM candidate_rows) AS returned_rows,
 ARRAY(SELECT phone FROM candidate_rows) = ARRAY['fixture-a','fixture-b','fixture-c','fixture-d','fixture-e','fixture-f','fixture-g','fixture-h'] AS exact_order_matches,
 NOT EXISTS (
  SELECT 1 FROM expected e LEFT JOIN candidate_rows c ON c.phone=e.phone
  WHERE c.phone IS NULL OR c.latest_preview IS DISTINCT FROM e.preview
  OR c.last_intent IS DISTINCT FROM e.intent OR c.preferred_language IS DISTINCT FROM e.language
 ) AS preview_intent_fallbacks_match,
 (SELECT COUNT(*) FROM candidate_all)=10 AS expanded_limit_matches,
 EXISTS(SELECT 1 FROM candidate_all WHERE phone='fixture-k' AND status='archived') AS closed_assigned_staff_included,
 NOT EXISTS(SELECT 1 FROM candidate_all WHERE phone='fixture-j') AS closed_other_staff_excluded;

