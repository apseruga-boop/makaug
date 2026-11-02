-- Verified-by-makaug tick for every agent with complete details
-- (Arthur, 2 Nov 2026). Complete details = approved, not removed, not a
-- social / found-online import, an ID on file (NIN of 10+ letters/digits,
-- a sign-up identity_document_url, or a live staff-uploaded ID front) and a
-- valid phone or WhatsApp (9-15 digits). Same rule as
-- services/agentVerifiedTickService.js.
--
-- Only adds the reviewed marker and stamps contact_phone_verified_at if empty.
-- Never changes status. Agents already ticked are skipped. Fortune is
-- explicitly excluded (record left untouched on request).
-- Rollback: scripts/rollback-198-auto-verified-tick-backfill.sql

CREATE TABLE IF NOT EXISTS migration_198_verified_tick_backup (
  agent_id UUID PRIMARY KEY,
  full_name TEXT,
  verification_reason TEXT,
  contact_phone_verified_at TIMESTAMPTZ,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO migration_198_verified_tick_backup (agent_id, full_name, verification_reason, contact_phone_verified_at)
SELECT a.id, a.full_name, a.verification_reason, a.contact_phone_verified_at
FROM agents a
WHERE LOWER(COALESCE(a.status, '')) = 'approved'
  AND a.removed_at IS NULL
  AND BTRIM(COALESCE(a.full_name, '')) <> 'Fortune'
  AND POSITION('[STAFF_REVIEWED_PRIVATE_ID_PROFILE]' IN COALESCE(a.verification_reason, '')) = 0
  AND COALESCE(a.verification_reason, '') NOT ILIKE '%public social source onboarding%'
  AND COALESCE(a.verification_reason, '') NOT ILIKE '%source profile%'
  AND COALESCE(a.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'
  AND (
    length(regexp_replace(COALESCE(a.nin, ''), '[^A-Za-z0-9]', '', 'g')) >= 10
    OR NULLIF(BTRIM(COALESCE(a.identity_document_url, '')), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM agent_identity_files idf
               WHERE idf.agent_id = a.id AND idf.kind = 'id_front' AND idf.archived_at IS NULL)
  )
  AND regexp_replace(COALESCE(NULLIF(BTRIM(a.phone), ''), a.whatsapp, ''), '\D', '', 'g') ~ '^[0-9]{9,15}$'
ON CONFLICT (agent_id) DO NOTHING;

UPDATE agents a
SET verification_reason = CONCAT_WS(' ', NULLIF(BTRIM(COALESCE(a.verification_reason, '')), ''),
      '[STAFF_REVIEWED_PRIVATE_ID_PROFILE]',
      '[AUTO_VERIFIED_COMPLETE_DETAILS] Verified tick granted automatically: approved, ID and valid phone on file (backfill 198).'),
    contact_phone_verified_at = COALESCE(a.contact_phone_verified_at, NOW()),
    updated_at = NOW()
FROM migration_198_verified_tick_backup b
WHERE b.agent_id = a.id
  AND POSITION('[STAFF_REVIEWED_PRIVATE_ID_PROFILE]' IN COALESCE(a.verification_reason, '')) = 0;

INSERT INTO audit_logs (actor_id, action, details)
SELECT 'migration_198', 'agent_verified_tick_auto_granted',
       jsonb_build_object('agent_id', b.agent_id, 'source', 'backfill_198',
                          'rule', 'approved+not_removed+not_import+id_on_file+valid_phone')
FROM migration_198_verified_tick_backup b;

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM migration_198_verified_tick_backup;
  RAISE NOTICE 'migration 198: verified tick backfilled for % agents', n;
END $$;
