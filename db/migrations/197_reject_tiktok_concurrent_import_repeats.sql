-- Reject the 34 repeat rows from the overlapping TikTok import of 1 Nov 2026
-- (two identical staff jobs, 08:13:07 and 08:13:41 UTC). Each repeat is
-- the later copy of one TikTok video; its original stays pending for human
-- review and is not touched. Only a pair that is still exactly as found
-- (both pending, same canonical TikTok URL, repeat created after original,
-- source found_online_property_source_v1) is changed. Before-rows are kept
-- in listing_correction_197_backup. Manual rollback:
-- scripts/rollback-197-tiktok-repeat-duplicates.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS listing_correction_197_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  duplicate_of_id uuid NOT NULL,
  duplicate_of_reference text NOT NULL,
  before_row jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $reject$
DECLARE
  pair record;
  r properties%ROWTYPE;
  o properties%ROWTYPE;
  reason_text text;
  applied int := 0;
  skipped int := 0;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_197 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM listing_correction_197_backup) THEN
    RAISE NOTICE 'listing_correction_197 skipped already_recorded';
    RETURN;
  END IF;
  FOR pair IN SELECT * FROM (VALUES
    ('MK-20261101-18BF4D', 'MK-20261101-CBE874', 'https://www.tiktok.com/@bobotherealtor/video/7702170422917352725'),
    ('MK-20261101-1F8E30', 'MK-20261101-789D03', 'https://www.tiktok.com/@ugandayaffeeproperties/video/7702370266042748167'),
    ('MK-20261101-20B2E7', 'MK-20261101-357DDA', 'https://www.tiktok.com/@dreamlinkhouses/video/7701209450366913812'),
    ('MK-20261101-21D503', 'MK-20261101-EFA726', 'https://www.tiktok.com/@propertyagent256/video/7701180858589252870'),
    ('MK-20261101-2F9E9F', 'MK-20261101-69832F', 'https://www.tiktok.com/@doublegpropertyconnectug/video/7698651944969145607'),
    ('MK-20261101-306B96', 'MK-20261101-6A702E', 'https://www.tiktok.com/@ugandayaffeeproperties/video/7701285853322071314'),
    ('MK-20261101-338ED0', 'MK-20261101-292EC8', 'https://www.tiktok.com/@ugandayaffeeproperties/video/7702395669662682386'),
    ('MK-20261101-49EDB6', 'MK-20261101-1916D7', 'https://www.tiktok.com/@williamwills409/video/7701316780639161618'),
    ('MK-20261101-5054B5', 'MK-20261101-7C643A', 'https://www.tiktok.com/@rawlings2026/video/7702318209973718292'),
    ('MK-20261101-625B7F', 'MK-20261101-13AFAA', 'https://www.tiktok.com/@atwyne.ug/video/7702391961940020488'),
    ('MK-20261101-65678F', 'MK-20261101-9CEEA8', 'https://www.tiktok.com/@realtor_kampala/video/7698277530503056660'),
    ('MK-20261101-693730', 'MK-20261101-69FAD9', 'https://www.tiktok.com/@richard_seruwagi/video/7701761841558457620'),
    ('MK-20261101-6EAF3F', 'MK-20261101-B96882', 'https://www.tiktok.com/@mrsmatovu/video/7702367381825309958'),
    ('MK-20261101-722594', 'MK-20261101-3CD8D8', 'https://www.tiktok.com/@pheobenamuli/video/7698755128735599893'),
    ('MK-20261101-72CF8E', 'MK-20261101-D5023F', 'https://www.tiktok.com/@plot.at.1m/video/7702562090669608199'),
    ('MK-20261101-799DDB', 'MK-20261101-4D8170', 'https://www.tiktok.com/@centuryproperty2/video/7702762586026118418'),
    ('MK-20261101-84313A', 'MK-20261101-8DE79E', 'https://www.tiktok.com/@vimanpropertyservices/video/7700614405272243464'),
    ('MK-20261101-879608', 'MK-20261101-3D2F74', 'https://www.tiktok.com/@propertiesinuganda/video/7701372838011292946'),
    ('MK-20261101-9E7C8C', 'MK-20261101-48AB8C', 'https://www.tiktok.com/@adsguruug/video/7702696382926179602'),
    ('MK-20261101-A1BAAB', 'MK-20261101-D2364D', 'https://www.tiktok.com/@propertiesinuganda/video/7697190306428554512'),
    ('MK-20261101-A6AE51', 'MK-20261101-088CBB', 'https://www.tiktok.com/@rawlings2026/video/7703026151924567316'),
    ('MK-20261101-A87419', 'MK-20261101-0C9BEE', 'https://www.tiktok.com/@adsguruug/video/7701920866300415240'),
    ('MK-20261101-B7D3A6', 'MK-20261101-A25D66', 'https://www.tiktok.com/@atwyne.ug/video/7696257518070271250'),
    ('MK-20261101-C38A12', 'MK-20261101-A7DF3E', 'https://www.tiktok.com/@williamwills409/video/7698129876632505618'),
    ('MK-20261101-C64739', 'MK-20261101-B4A053', 'https://www.tiktok.com/@symopropertiesug/video/7698777589288160532'),
    ('MK-20261101-C9F1E3', 'MK-20261101-9A6B44', 'https://www.tiktok.com/@orman.properties/video/7700642079046634773'),
    ('MK-20261101-CB8E6B', 'MK-20261101-70A07E', 'https://www.tiktok.com/@ugandayaffeeproperties/video/7702486516039175442'),
    ('MK-20261101-CF3833', 'MK-20261101-F8565F', 'https://www.tiktok.com/@comfortpropertyconsulta/video/7701942779622083858'),
    ('MK-20261101-D0FFEE', 'MK-20261101-DCBE7F', 'https://www.tiktok.com/@adsguruug/video/7702317777201286408'),
    ('MK-20261101-D1151A', 'MK-20261101-313F18', 'https://www.tiktok.com/@.2century/video/7702337307579256116'),
    ('MK-20261101-D9F234', 'MK-20261101-333A8B', 'https://www.tiktok.com/@propertiesinuganda/video/7701266620408270098'),
    ('MK-20261101-DDDE99', 'MK-20261101-E5CA40', 'https://www.tiktok.com/@dreamlinkhouses/video/7696378835188731157'),
    ('MK-20261101-DE4714', 'MK-20261101-CB098C', 'https://www.tiktok.com/@ugandayaffeeproperties/video/7702366826268855570'),
    ('MK-20261101-FE42B6', 'MK-20261101-E52531', 'https://www.tiktok.com/@williamwills409/video/7688089831917784328')
  ) AS v(repeat_ref, original_ref, canonical_url) ORDER BY 1 LOOP
    SELECT * INTO r FROM properties WHERE inquiry_reference = pair.repeat_ref FOR UPDATE;
    SELECT * INTO o FROM properties WHERE inquiry_reference = pair.original_ref;
    IF r.id IS NULL OR o.id IS NULL OR r.id = o.id
       OR r.status IS DISTINCT FROM 'pending' OR o.status IS DISTINCT FROM 'pending'
       OR r.source IS DISTINCT FROM 'found_online_property_source_v1'
       OR o.source IS DISTINCT FROM 'found_online_property_source_v1'
       OR COALESCE(r.extra_fields->>'canonical_source_url', '') <> pair.canonical_url
       OR COALESCE(o.extra_fields->>'canonical_source_url', '') <> pair.canonical_url
       OR r.created_at <= o.created_at THEN
      skipped := skipped + 1;
      RAISE NOTICE 'listing_correction_197 skipped % guard', pair.repeat_ref;
      CONTINUE;
    END IF;
    reason_text := 'Duplicate of ' || o.inquiry_reference || ': same TikTok video imported twice by overlapping staff imports on 1 Nov 2026.';
    INSERT INTO listing_correction_197_backup (property_id, inquiry_reference, duplicate_of_id, duplicate_of_reference, before_row)
      VALUES (r.id, r.inquiry_reference, o.id, o.inquiry_reference, to_jsonb(r));
    UPDATE properties SET status = 'rejected', moderation_stage = 'rejected',
      moderation_reason = reason_text, reviewed_at = NOW(),
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'moderation_reason', reason_text,
        'duplicate_of', o.id::text,
        'duplicate_of_reference', o.inquiry_reference,
        'listing_correction_197', jsonb_build_object('applied_at', NOW(), 'fix', 'reject_concurrent_import_repeat')),
      updated_at = NOW()
     WHERE id = r.id;
    INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
      VALUES (r.id, 'migration_197', 'reject', r.status, 'rejected', 'duplicate', reason_text, '{"migration":"197"}'::jsonb);
    applied := applied + 1;
  END LOOP;
  RAISE NOTICE 'listing_correction_197 applied % skipped %', applied, skipped;
END;
$reject$;
