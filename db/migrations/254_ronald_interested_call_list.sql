-- Put interested-not-joined people on Ronald's Get new agents call list.
--
-- Arthur, 28 Nov 2026 09:25 UK: "Yes, put #890 live, test it, and add the 20
-- to Ronald's call list". The 17 with no follow-up date already include two of
-- the three who said Hi (tiktok.com •••214 and •••032). Wilken •••803 is the
-- third. Unique total is 18, not 20.
--
-- Phone-call only. This writes only call_number_submissions rows, the same
-- table Call again uses. It does not insert into call_sms_log, whatsapp_* or
-- any send queue. Nothing is sent, texted or WhatsApped. Arthur's rule: never
-- WhatsApp anyone who has not messaged us in the last 7 days; these entries
-- are for a phone call only.
--
-- Do-not-contact still wins. A number already on an own list is skipped
-- (unique index ux_call_number_submissions_own): two of the 18 are already
-- on Ronald's Payments list (tiktok.com •••214, also saved as Zad construction
-- limited; and Wilken •••803).
--
-- Numbers are looked up from call_attempts at run time. This file has no full
-- phone numbers (the repo is public). People are identified by the last 3
-- digits and the name on the interested call.
--
-- Rollback: scripts/rollback-254-ronald-interested-call-list.sql

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS migration_254_ronald_call_list_backup (
  last3 TEXT NOT NULL,
  name_key TEXT NOT NULL,
  phone_key TEXT,
  phone TEXT,
  full_name TEXT,
  skipped TEXT,
  existing_submission_id UUID,
  existing_mode TEXT,
  inserted_submission_id UUID,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO migration_254_ronald_call_list_backup (
  last3, name_key, phone_key, phone, full_name, skipped, existing_submission_id, existing_mode
)
WITH want(last3, name_key) AS (
  VALUES
    ('214', 'tiktok.com'),
    ('032', 'tiktok.com'),
    ('803', 'wilken property services ltd'),
    ('040', 'viola'),
    ('554', 'mainstop properties'),
    ('361', 'kedison properties'),
    ('994', 'ark property developers ltd'),
    ('754', 'rock properties'),
    ('195', 'justus'),
    ('313', 'kasiita'),
    ('474', 'tiktok.com'),
    ('898', 'tiktok.com'),
    ('413', 'tiktok.com'),
    ('945', 'tiktok.com'),
    ('291', 'tiktok.com'),
    ('346', 'uganda yaffee properties'),
    ('397', 'whatsapp property seeker'),
    ('572', 'kawe realtors')
),
resolved AS (
  SELECT DISTINCT ON (w.last3, w.name_key)
         w.last3, w.name_key, a.phone_key, a.phone, a.full_name
    FROM want w
    JOIN call_attempts a
      ON a.status = 'done'
     AND a.phone_key IS NOT NULL
     AND a.task_key = 'new_agents'
     AND a.person_key IS DISTINCT FROM 'arthurtest'
     AND a.outcome IN ('interested', 'promised', 'will_list', 'signed_up')
     AND RIGHT(a.phone_key, 3) = w.last3
     AND LOWER(TRIM(a.full_name)) = w.name_key
   ORDER BY w.last3, w.name_key, COALESCE(a.wrapped_at, a.tapped_at) DESC
)
SELECT w.last3,
       w.name_key,
       r.phone_key,
       r.phone,
       r.full_name,
       CASE
         WHEN r.phone_key IS NULL THEN 'not_found'
         WHEN EXISTS (
           SELECT 1 FROM call_blocks b
            WHERE b.phone_key = r.phone_key AND b.removed_at IS NULL
         ) THEN 'do_not_contact'
         WHEN s.id IS NOT NULL THEN 'already_on_own_list'
         ELSE NULL
       END,
       s.id,
       s.mode
  FROM want w
  LEFT JOIN resolved r ON r.last3 = w.last3 AND r.name_key = w.name_key
  LEFT JOIN LATERAL (
    SELECT id, mode FROM call_number_submissions
     WHERE phone_key = r.phone_key AND status = 'own'
     ORDER BY id LIMIT 1
  ) s ON TRUE;

DO $$
DECLARE
  n int;
  missing int;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE phone_key IS NULL)
    INTO n, missing
    FROM migration_254_ronald_call_list_backup;
  IF n <> 18 OR missing <> 0 THEN
    RAISE EXCEPTION 'migration 254: expected 18 resolved people, found % rows, % missing', n, missing;
  END IF;
END $$;

-- The only write besides the backup. Nothing is sent.
WITH ins AS (
  INSERT INTO call_number_submissions (
    person_key, full_name, phone, phone_key, note, status, added_by, mode, how_known
  )
  SELECT 'ronald',
         COALESCE(NULLIF(b.full_name, ''), 'No name'),
         COALESCE(NULLIF(b.phone, ''), b.phone_key),
         b.phone_key,
         'Interested, not joined yet: call again. Phone call only — do not text or WhatsApp.',
         'own',
         'migration 254',
         'new_agents',
         'migration_254_call_list'
    FROM migration_254_ronald_call_list_backup b
   WHERE b.skipped IS NULL
     AND b.phone_key IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM call_number_submissions s
        WHERE s.phone_key = b.phone_key AND s.status = 'own'
     )
  RETURNING id, phone_key
)
UPDATE migration_254_ronald_call_list_backup b
   SET inserted_submission_id = ins.id
  FROM ins
 WHERE ins.phone_key = b.phone_key;
