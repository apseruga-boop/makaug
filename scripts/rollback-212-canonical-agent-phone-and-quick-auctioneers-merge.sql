-- Undo the MKA-AG-3822248 → MKA-AG-5282286 merge.
-- Restores both agent rows and moves listings, payments, ID files, leads
-- and the other backed-up links back. Does not send a message.
-- The phone-normalising trigger stays, so a later insert of the same line
-- is still refused. It is switched off only while the old phone is put back.
--
-- Safe to run only after db/migrations/212_canonical_agent_phone_and_quick_auctioneers_merge.sql.

BEGIN;

ALTER TABLE agents DISABLE TRIGGER agents_block_duplicate_phone;

UPDATE agents a
   SET full_name = b.agent->>'full_name',
       company_name = b.agent->>'company_name',
       phone = b.agent->>'phone',
       whatsapp = b.agent->>'whatsapp',
       email = b.agent->>'email',
       nin = b.agent->>'nin',
       greeting_name = b.agent->>'greeting_name',
       bio = b.agent->>'bio',
       identity_document_url = b.agent->>'identity_document_url',
       identity_document_name = b.agent->>'identity_document_name',
       identity_document_type = b.agent->>'identity_document_type',
       verification_reason = b.agent->>'verification_reason',
       status = COALESCE(b.agent->>'status', a.status),
       removed_at = NULLIF(b.agent->>'removed_at', '')::timestamptz,
       removed_reason = b.agent->>'removed_reason',
       removed_by = b.agent->>'removed_by',
       removal_snapshot = CASE WHEN b.agent->'removal_snapshot' = 'null'::jsonb THEN NULL ELSE b.agent->'removal_snapshot' END,
       updated_at = NOW()
  FROM migration_212_agent_phone_merge_backup b
 WHERE b.agent_id = a.id;

UPDATE properties p
   SET agent_id = b.agent_id, updated_at = NOW()
  FROM migration_212_agent_phone_merge_backup b
 WHERE b.role = 'source' AND p.id = ANY(b.property_ids);

UPDATE properties p
   SET extra_fields = jsonb_set(COALESCE(p.extra_fields, '{}'::jsonb), '{broker_agent_id}', to_jsonb(b.agent_id::text), true),
       updated_at = NOW()
  FROM migration_212_agent_phone_merge_backup b
 WHERE b.role = 'source' AND p.id = ANY(b.broker_property_ids);

UPDATE revenue_entries r SET agent_id = b.agent_id
  FROM migration_212_agent_phone_merge_backup b
 WHERE b.role = 'source' AND r.id = ANY(b.revenue_ids);

UPDATE agent_identity_files f SET agent_id = b.agent_id
  FROM migration_212_agent_phone_merge_backup b
 WHERE b.role = 'source' AND f.id = ANY(b.identity_file_ids);

DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    UPDATE leads l SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND l.id = ANY(b.lead_ids);
  END IF;
  IF to_regclass('public.agent_booking_requests') IS NOT NULL THEN
    UPDATE agent_booking_requests r SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND r.id = ANY(b.booking_ids);
  END IF;
  IF to_regclass('public.agent_weekly_reports') IS NOT NULL THEN
    UPDATE agent_weekly_reports r SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND r.id = ANY(b.report_ids);
  END IF;
  IF to_regclass('public.pay_links') IS NOT NULL THEN
    UPDATE pay_links p SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND p.id = ANY(b.pay_link_ids);
  END IF;
  IF to_regclass('public.payment_claims') IS NOT NULL THEN
    UPDATE payment_claims c SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND c.id = ANY(b.claim_ids);
  END IF;
  IF to_regclass('public.agent_prospects') IS NOT NULL THEN
    UPDATE agent_prospects p SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND p.id = ANY(b.prospect_ids);
  END IF;
  IF to_regclass('public.demand_lead_referrals') IS NOT NULL THEN
    UPDATE demand_lead_referrals r SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND r.id = ANY(b.referral_ids);
  END IF;
  IF to_regclass('public.listing_availability_checkins') IS NOT NULL THEN
    UPDATE listing_availability_checkins c SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND c.id = ANY(b.checkin_ids);
    INSERT INTO listing_availability_checkins
    SELECT restored.*
      FROM migration_212_agent_phone_merge_backup b
      CROSS JOIN LATERAL jsonb_populate_recordset(
        NULL::listing_availability_checkins,
        COALESCE(b.dropped_rows->'listing_availability_checkins', '[]'::jsonb)
      ) AS restored
     WHERE b.role = 'source';
  END IF;
  IF to_regclass('public.agent_weekly_reports') IS NOT NULL THEN
    INSERT INTO agent_weekly_reports
    SELECT restored.*
      FROM migration_212_agent_phone_merge_backup b
      CROSS JOIN LATERAL jsonb_populate_recordset(
        NULL::agent_weekly_reports,
        COALESCE(b.dropped_rows->'agent_weekly_reports', '[]'::jsonb)
      ) AS restored
     WHERE b.role = 'source';
  END IF;
  IF to_regclass('public.agent_identity_files') IS NOT NULL THEN
    INSERT INTO agent_identity_files
    SELECT restored.*
      FROM migration_212_agent_phone_merge_backup b
      CROSS JOIN LATERAL jsonb_populate_recordset(
        NULL::agent_identity_files,
        COALESCE(b.dropped_rows->'agent_identity_files', '[]'::jsonb)
      ) AS restored
     WHERE b.role = 'source';
  END IF;
  IF to_regclass('public.agent_viewing_defaults') IS NOT NULL THEN
    UPDATE agent_viewing_defaults d
       SET agent_id = b.agent_id
      FROM migration_212_agent_phone_merge_backup b
     WHERE b.role = 'source' AND b.viewing_defaults_moved AND d.agent_id = (
       SELECT agent_id FROM migration_212_agent_phone_merge_backup WHERE role = 'target'
     );
    INSERT INTO agent_viewing_defaults
    SELECT restored.*
      FROM migration_212_agent_phone_merge_backup b
      CROSS JOIN LATERAL jsonb_populate_recordset(
        NULL::agent_viewing_defaults,
        COALESCE(b.dropped_rows->'agent_viewing_defaults', '[]'::jsonb)
      ) AS restored
     WHERE b.role = 'source';
  END IF;
END $$;

DELETE FROM agent_number_aliases WHERE alias = 'MKA-AG-3822248';

ALTER TABLE agents ENABLE TRIGGER agents_block_duplicate_phone;

COMMIT;
