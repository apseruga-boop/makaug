-- Canonical Uganda agent phones, and one merge.
--
-- Quick auctioneers (MKA-AG-3822248) and Quickway Auctioneers
-- (MKA-AG-5282286) are the same person. The first profile was opened by
-- staff listing reassignment with the phone stored as +256…. About nine
-- hours later WhatsApp employee intake (Agent 007) stored the same line
-- as a local 0… number. The intake match compared the whole digit string,
-- so the two shapes did not meet and a second approved profile was created.
--
-- This migration:
--   1. Backs up both rows and the ids that move.
--   2. Merges MKA-AG-3822248 into MKA-AG-5282286 only.
--      Listings, payments, ID files, notes and moderation history move.
--      The richer field wins. The survivor's phone is stored as +256….
--      The old agent number resolves to the survivor.
--   3. Does not merge any other duplicate pair.
--   4. Does not send a message.
--   5. From then on, a new or edited agent phone is stored as +256… and a
--      second profile with the same line is rejected.
--
-- Rollback: scripts/rollback-207-canonical-agent-phone-and-quick-auctioneers-merge.sql

CREATE OR REPLACE FUNCTION makaug_canonical_ug_phone(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  d := regexp_replace(COALESCE(value, ''), '\D', '', 'g');
  IF d ~ '^0[0-9]{9}$' THEN
    RETURN '+256' || substring(d FROM 2);
  ELSIF d ~ '^256[0-9]{9}$' THEN
    RETURN '+' || d;
  ELSIF d ~ '^7[0-9]{8}$' THEN
    RETURN '+256' || d;
  END IF;
  RETURN NULLIF(btrim(COALESCE(value, '')), '');
END;
$$;

CREATE TABLE IF NOT EXISTS agent_number_aliases (
  alias TEXT PRIMARY KEY,
  agent_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_number_aliases_agent_idx ON agent_number_aliases (agent_id);

CREATE TABLE IF NOT EXISTS migration_207_agent_phone_merge_backup (
  agent_number TEXT PRIMARY KEY,
  agent_id UUID NOT NULL,
  role TEXT NOT NULL,
  agent JSONB NOT NULL,
  property_ids UUID[] NOT NULL DEFAULT '{}',
  broker_property_ids UUID[] NOT NULL DEFAULT '{}',
  revenue_ids UUID[] NOT NULL DEFAULT '{}',
  identity_file_ids UUID[] NOT NULL DEFAULT '{}',
  lead_ids UUID[] NOT NULL DEFAULT '{}',
  booking_ids UUID[] NOT NULL DEFAULT '{}',
  report_ids UUID[] NOT NULL DEFAULT '{}',
  pay_link_ids UUID[] NOT NULL DEFAULT '{}',
  claim_ids UUID[] NOT NULL DEFAULT '{}',
  prospect_ids UUID[] NOT NULL DEFAULT '{}',
  referral_ids UUID[] NOT NULL DEFAULT '{}',
  checkin_ids UUID[] NOT NULL DEFAULT '{}',
  audit_ids UUID[] NOT NULL DEFAULT '{}',
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  source_id uuid;
  target_id uuid;
  source_row jsonb;
  target_row jsonb;
BEGIN
  SELECT id, to_jsonb(agents.*) INTO source_id, source_row
    FROM agents WHERE makaug_agent_number = 'MKA-AG-3822248';
  SELECT id, to_jsonb(agents.*) INTO target_id, target_row
    FROM agents WHERE makaug_agent_number = 'MKA-AG-5282286';

  IF source_id IS NULL OR target_id IS NULL THEN
    RAISE NOTICE 'Quick auctioneers merge skipped; one or both agent numbers are not in this database';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM agent_number_aliases WHERE alias = 'MKA-AG-3822248') THEN
    RAISE NOTICE 'Quick auctioneers merge already applied';
    RETURN;
  END IF;

  INSERT INTO migration_207_agent_phone_merge_backup (agent_number, agent_id, role, agent)
  VALUES ('MKA-AG-3822248', source_id, 'source', source_row)
  ON CONFLICT (agent_number) DO NOTHING;
  INSERT INTO migration_207_agent_phone_merge_backup (agent_number, agent_id, role, agent)
  VALUES ('MKA-AG-5282286', target_id, 'target', target_row)
  ON CONFLICT (agent_number) DO NOTHING;

  IF to_regclass('public.properties') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET property_ids = COALESCE((SELECT array_agg(id) FROM properties WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE migration_207_agent_phone_merge_backup
       SET broker_property_ids = COALESCE((
         SELECT array_agg(id) FROM properties
          WHERE COALESCE(extra_fields, '{}'::jsonb)->>'broker_agent_id' = source_id::text
       ), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE properties
       SET agent_id = target_id,
           lister_name = COALESCE(NULLIF(lister_name, ''), (SELECT full_name FROM agents WHERE id = target_id)),
           extra_fields = COALESCE(extra_fields, '{}'::jsonb)
             || jsonb_build_object('merged_from_agent_id', source_id::text, 'merged_from_agent_number', 'MKA-AG-3822248'),
           updated_at = NOW()
     WHERE agent_id = source_id;
    UPDATE properties
       SET extra_fields = jsonb_set(COALESCE(extra_fields, '{}'::jsonb), '{broker_agent_id}', to_jsonb(target_id::text), true)
         || jsonb_build_object('merged_from_agent_id', source_id::text, 'merged_from_agent_number', 'MKA-AG-3822248'),
           updated_at = NOW()
     WHERE COALESCE(extra_fields, '{}'::jsonb)->>'broker_agent_id' = source_id::text;
  END IF;

  IF to_regclass('public.revenue_entries') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET revenue_ids = COALESCE((SELECT array_agg(id) FROM revenue_entries WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE revenue_entries SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.agent_identity_files') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET identity_file_ids = COALESCE((SELECT array_agg(id) FROM agent_identity_files WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    -- One live front and one live back. The survivor already has the ID, so
    -- a live file on the duplicate is archived before it moves.
    UPDATE agent_identity_files f
       SET archived_at = COALESCE(f.archived_at, NOW()),
           archived_reason = COALESCE(f.archived_reason, 'Archived while merging duplicate agent MKA-AG-3822248')
     WHERE f.agent_id = source_id
       AND f.archived_at IS NULL
       AND f.kind IN ('id_front', 'id_back')
       AND EXISTS (
         SELECT 1 FROM agent_identity_files t
          WHERE t.agent_id = target_id AND t.kind = f.kind AND t.archived_at IS NULL
       );
    UPDATE agent_identity_files SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.leads') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET lead_ids = COALESCE((SELECT array_agg(id) FROM leads WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE leads SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.agent_booking_requests') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET booking_ids = COALESCE((SELECT array_agg(id) FROM agent_booking_requests WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE agent_booking_requests SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.agent_weekly_reports') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET report_ids = COALESCE((SELECT array_agg(id) FROM agent_weekly_reports WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    DELETE FROM agent_weekly_reports s
     USING agent_weekly_reports t
     WHERE s.agent_id = source_id AND t.agent_id = target_id AND s.week_start = t.week_start;
    UPDATE agent_weekly_reports SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.pay_links') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET pay_link_ids = COALESCE((SELECT array_agg(id) FROM pay_links WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE pay_links SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.payment_claims') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET claim_ids = COALESCE((SELECT array_agg(id) FROM payment_claims WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE payment_claims SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.agent_prospects') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET prospect_ids = COALESCE((SELECT array_agg(id) FROM agent_prospects WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE agent_prospects SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.demand_lead_referrals') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET referral_ids = COALESCE((SELECT array_agg(id) FROM demand_lead_referrals WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE demand_lead_referrals SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.listing_availability_checkins') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET checkin_ids = COALESCE((SELECT array_agg(id) FROM listing_availability_checkins WHERE agent_id = source_id), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE listing_availability_checkins SET agent_id = target_id WHERE agent_id = source_id;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    UPDATE migration_207_agent_phone_merge_backup
       SET audit_ids = COALESCE((
         SELECT array_agg(id) FROM audit_logs
          WHERE details->>'agent_id' = source_id::text
             OR details->>'source_agent_id' = source_id::text
       ), '{}')
     WHERE agent_number = 'MKA-AG-3822248';
    UPDATE audit_logs
       SET details = jsonb_set(details, '{agent_id}', to_jsonb(target_id::text), true)
         || jsonb_build_object('merged_from_agent_id', source_id::text, 'merged_from_agent_number', 'MKA-AG-3822248')
     WHERE details->>'agent_id' = source_id::text;
    UPDATE audit_logs
       SET details = jsonb_set(details, '{source_agent_id}', to_jsonb(target_id::text), true)
     WHERE details->>'source_agent_id' = source_id::text;
  END IF;

  IF to_regclass('public.off_plan_developments') IS NOT NULL THEN
    UPDATE off_plan_developments SET source_agent_id = target_id WHERE source_agent_id = source_id;
  END IF;

  IF to_regclass('public.agent_viewing_defaults') IS NOT NULL THEN
    UPDATE agent_viewing_defaults SET agent_id = target_id
     WHERE agent_id = source_id
       AND NOT EXISTS (SELECT 1 FROM agent_viewing_defaults WHERE agent_id = target_id);
    DELETE FROM agent_viewing_defaults WHERE agent_id = source_id;
  END IF;

  -- Keep the longer company, bio and identity. Do not blank a field the
  -- survivor already has. Phone is the canonical +256 form of the survivor's
  -- line (the duplicate's local number is the same line).
  UPDATE agents t
     SET email = COALESCE(NULLIF(btrim(t.email), ''), s.email),
         nin = COALESCE(NULLIF(btrim(t.nin), ''), s.nin),
         greeting_name = COALESCE(NULLIF(btrim(t.greeting_name), ''), s.greeting_name),
         bio = CASE WHEN length(COALESCE(t.bio, '')) >= length(COALESCE(s.bio, '')) THEN t.bio ELSE s.bio END,
         company_name = CASE
           WHEN length(COALESCE(t.company_name, '')) >= length(COALESCE(s.company_name, '')) THEN t.company_name
           ELSE s.company_name END,
         identity_document_url = COALESCE(NULLIF(btrim(t.identity_document_url), ''), s.identity_document_url),
         identity_document_name = COALESCE(NULLIF(btrim(t.identity_document_name), ''), s.identity_document_name),
         identity_document_type = COALESCE(NULLIF(btrim(t.identity_document_type), ''), s.identity_document_type),
         phone = makaug_canonical_ug_phone(COALESCE(NULLIF(btrim(t.phone), ''), s.phone)),
         whatsapp = makaug_canonical_ug_phone(COALESCE(NULLIF(btrim(t.whatsapp), ''), NULLIF(btrim(t.phone), ''), s.whatsapp, s.phone)),
         verification_reason = CONCAT_WS(E'\n',
           NULLIF(t.verification_reason, ''),
           NULLIF(s.verification_reason, ''),
           '[MERGED_DUPLICATE] MKA-AG-3822248 was merged into this profile on 2026-11-10. Listings, payments, notes, ID files and moderation history were moved. No message was sent.'),
         updated_at = NOW()
    FROM agents s
   WHERE t.id = target_id AND s.id = source_id;

  UPDATE agents
     SET phone = NULL,
         whatsapp = NULL,
         status = 'suspended',
         removed_at = COALESCE(removed_at, NOW()),
         removed_reason = 'Merged into Quickway Auctioneers (MKA-AG-5282286). Same phone, second profile.',
         removed_by = 'migration_207',
         removal_snapshot = jsonb_build_object('merged_into', target_id::text, 'merged_into_number', 'MKA-AG-5282286'),
         updated_at = NOW()
   WHERE id = source_id;

  INSERT INTO agent_number_aliases (alias, agent_id)
  VALUES ('MKA-AG-3822248', target_id)
  ON CONFLICT (alias) DO UPDATE SET agent_id = EXCLUDED.agent_id;
END $$;

CREATE OR REPLACE FUNCTION agents_block_duplicate_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  key9 text;
  existing_id uuid;
  existing_number text;
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := COALESCE(makaug_canonical_ug_phone(NEW.phone), NULLIF(btrim(NEW.phone), ''));
  END IF;
  IF NEW.whatsapp IS NOT NULL THEN
    NEW.whatsapp := COALESCE(makaug_canonical_ug_phone(NEW.whatsapp), NULLIF(btrim(NEW.whatsapp), ''));
  END IF;
  key9 := RIGHT(regexp_replace(COALESCE(NULLIF(btrim(NEW.phone), ''), NEW.whatsapp, ''), '\D', '', 'g'), 9);
  IF COALESCE(length(key9), 0) < 9 THEN
    RETURN NEW;
  END IF;
  SELECT id, makaug_agent_number
    INTO existing_id, existing_number
    FROM agents
   WHERE (TG_OP = 'INSERT' OR id IS DISTINCT FROM NEW.id)
     AND (
       RIGHT(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 9) = key9
       OR RIGHT(regexp_replace(COALESCE(whatsapp, ''), '\D', '', 'g'), 9) = key9
     )
   ORDER BY (removed_at IS NULL) DESC, (LOWER(COALESCE(status, '')) = 'approved') DESC, created_at ASC
   LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'agent_phone_taken:%:%', COALESCE(existing_number, ''), existing_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agents_block_duplicate_phone ON agents;
CREATE TRIGGER agents_block_duplicate_phone
  BEFORE INSERT OR UPDATE OF phone, whatsapp ON agents
  FOR EACH ROW
  EXECUTE FUNCTION agents_block_duplicate_phone();
