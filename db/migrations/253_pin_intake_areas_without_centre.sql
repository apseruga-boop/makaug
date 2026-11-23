-- 23 Nov 2026: pin the approved listings that went live with no map pin
-- because their area had no centre point in the catalogue.
--
-- #734 (10 Nov) fills an area-centre pin on found-online and WhatsApp intake,
-- and Approve fills one too (routes/properties.js autoPinForApproval). Both
-- use areaCentreForUnpinnedListing, which returns nothing when the matched
-- catalogue area has no point. Butalangu, Miseebe, Kikandwa (Mityana), Maganjo,
-- Myanzi and the misspelt "Kissasi" (Kisaasi) were all names the catalogue
-- knew, but none had a point, so the fill quietly did nothing and staff
-- approved through the non-blocking "No map pin" warning. The same PR adds
-- those points (utils/ugandaAreaCentroids.js, OSM Nominatim place nodes,
-- cached, no runtime geocoding), the Kissasi alias, and the auto-pin on staff
-- bulk found-online approve, which skipped it.
--
-- A production read on 23 Nov 2026 found 249 approved listings with no pin.
-- 52 name an area that is not just the district; 18 of those now match an
-- area centre and are pinned here (the 6 reported plus Maganjo e7598665,
-- Myanzi 8116113b, Bishozi, Buhimba, Kagoma, Kiteredde, Lukwanga, Mende,
-- Kavule, Kasenge and two Akright City listings whose points were added
-- after they were approved). Left alone: 74fd7985 Nakasajja (no area or
-- district stored), and 4 listings whose stored district is wrong for the
-- place in the title (0ab20a2f Nansana Kawoko, 1fb17553 Wakiso Bulondo
-- Kyapa, c11226ad Kira Kito, fc3edc4a Jinja Misindye).
--
-- Only 18 named rows are written, each only while it is still approved, still
-- has no pin and still names the same area. updated_at is not changed by hand.
-- Nothing is deleted.
--
-- Backup: auto_pin_253_backup (old pin and the extra_fields keys written).
-- Rollback (manual, not run by scripts/migrate.js):
--   UPDATE properties p
--      SET latitude = b.old_latitude, longitude = b.old_longitude,
--          extra_fields = (p.extra_fields - 'location_precision' - 'location_confidence'
--                          - 'geocoding_provider' - 'auto_pinned' - 'auto_pin_note' - 'coords_fix')
--                         || COALESCE(b.old_extra, '{}'::jsonb)
--     FROM auto_pin_253_backup b
--    WHERE p.id = b.property_id AND b.rolled_back_at IS NULL
--      AND p.extra_fields->'coords_fix'->>'batch' = 'auto_pin_20261123_253'
--      AND round(p.latitude::numeric, 6) = round(b.new_latitude, 6)
--      AND round(p.longitude::numeric, 6) = round(b.new_longitude, 6);
--   UPDATE auto_pin_253_backup SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS auto_pin_253_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  old_latitude numeric,
  old_longitude numeric,
  new_latitude numeric NOT NULL,
  new_longitude numeric NOT NULL,
  area text,
  district text,
  old_extra jsonb,
  backed_up_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

CREATE TEMP TABLE pin_253 (id uuid PRIMARY KEY, lat numeric, lng numeric, area text, to_name text, to_key text) ON COMMIT DROP;
INSERT INTO pin_253 (id, lat, lng, area, to_name, to_key) VALUES
    ('022d0acf-74d0-4e83-b946-84af5577e108'::uuid, -0.0254::numeric, 30.6159::numeric, 'Bishozi', 'Bishozi, Kazo', 'kazo:bishozi'),
    ('05ee3bed-5502-41b0-a6a5-b5c92d19ff9e'::uuid, 0.3952::numeric, 32.5429::numeric, 'Maganjo', 'Maganjo, Wakiso', 'wakiso:maganjo'),
    ('13a3a362-1c9b-4f1e-97f9-55aaf7e635a7'::uuid, 0.364::numeric, 32.589::numeric, 'Kissasi', 'Kisaasi, Kampala', 'kampala:kisaasi'),
    ('1cb2e4d0-48f0-44a7-b09a-9e926136080c'::uuid, 0.8256::numeric, 32.2447::numeric, 'Butalangu', 'Butalangu, Nakaseke', 'nakaseke:butalangu'),
    ('27b1f5fd-47a8-498e-8f86-6b0f7d881a7e'::uuid, 0.179::numeric, 32.541::numeric, 'Akright City', 'Akright City, Wakiso', 'wakiso:akright city'),
    ('328ac6ef-f79e-499b-8059-84b1427e6b63'::uuid, 0.4018::numeric, 32.5434::numeric, 'Kagoma', 'Kagoma, Wakiso', 'wakiso:kagoma'),
    ('51996940-f6e4-4159-aabd-578cc79b90d5'::uuid, 0.6127::numeric, 31.9909::numeric, 'Kiteredde', 'Kiteredde, Mityana', 'mityana:kiteredde'),
    ('5ba466ad-f387-4f9e-be4d-05f9497c38ef'::uuid, 0.3614::numeric, 32.4281::numeric, 'Lukwanga', 'Lukwanga, Wakiso', 'wakiso:lukwanga'),
    ('7569f5b5-882f-4d45-bf5b-37ff07e0adcd'::uuid, 0.259::numeric, 32.5073::numeric, 'Kasenge', 'Kasenge, Wakiso', 'wakiso:kasenge'),
    ('8116113b-9c38-4261-9832-51110af5bdd7'::uuid, 0.4422::numeric, 31.8997::numeric, 'Myanzi', 'Myanzi, Kassanda', 'kassanda:myanzi'),
    ('84462554-2352-463d-af75-cce08623daa1'::uuid, 0.2912::numeric, 32.573::numeric, 'Kavule', 'Kavule, Kampala', 'kampala:kavule'),
    ('8690fe0b-d2e2-481b-81b2-741b0a553710'::uuid, 0.474::numeric, 32.454::numeric, 'Mende', 'Mende, Wakiso', 'wakiso:mende'),
    ('869be006-75c7-4e23-96d9-9fa1ffb20b03'::uuid, 0.6372::numeric, 32.0961::numeric, 'Kikandwa', 'Kikandwa, Mityana', 'mityana:kikandwa'),
    ('89ab7b1e-1007-44df-8848-64b4060e4861'::uuid, 0.4421::numeric, 32.0004::numeric, 'Miseebe', 'Miseebe, Mityana', 'mityana:miseebe'),
    ('a783de4e-e37b-49a4-a05a-2c1ffb657265'::uuid, 0.4422::numeric, 31.8997::numeric, 'Myanzi', 'Myanzi, Kassanda', 'kassanda:myanzi'),
    ('b5543789-d5f3-460d-93c3-702d682e87cf'::uuid, 1.3472::numeric, 31.308::numeric, 'Buhimba', 'Buhimba, Kikuube', 'kikuube:buhimba'),
    ('e7598665-3d0a-43fb-93a2-fd4cebc7f175'::uuid, 0.3952::numeric, 32.5429::numeric, 'Maganjo', 'Maganjo, Wakiso', 'wakiso:maganjo'),
    ('fc382c0c-a372-4396-9d79-dd1e3167a43c'::uuid, 0.179::numeric, 32.541::numeric, 'Akright City', 'Akright City, Wakiso', 'wakiso:akright city');

INSERT INTO auto_pin_253_backup (property_id, inquiry_reference, old_latitude, old_longitude, new_latitude, new_longitude, area, district, old_extra)
SELECT p.id, p.inquiry_reference, p.latitude, p.longitude, t.lat, t.lng, p.area, p.district,
       jsonb_strip_nulls(jsonb_build_object(
         'location_precision', p.extra_fields->'location_precision',
         'location_confidence', p.extra_fields->'location_confidence',
         'geocoding_provider', p.extra_fields->'geocoding_provider',
         'auto_pinned', p.extra_fields->'auto_pinned',
         'auto_pin_note', p.extra_fields->'auto_pin_note',
         'coords_fix', p.extra_fields->'coords_fix'))
  FROM properties p JOIN pin_253 t ON t.id = p.id
 WHERE p.status = 'approved' AND p.latitude IS NULL AND p.longitude IS NULL
   AND lower(btrim(COALESCE(p.area, ''))) = lower(t.area)
ON CONFLICT (property_id) DO NOTHING;

UPDATE properties p
   SET latitude = t.lat,
       longitude = t.lng,
       extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
         'location_precision', 'area',
         'location_confidence', '0.4',
         'geocoding_provider', 'area_centre_auto_pin',
         'auto_pinned', true,
         'auto_pin_note', 'Auto-pinned at the area centre: the lister gave no pin. Approximate, not the exact address.',
         'coords_fix', jsonb_build_object(
           'action', 'auto_pin', 'reason', 'missing_pin', 'at', NOW(), 'by', 'migration_253',
           'batch', 'auto_pin_20261123_253', 'to', t.to_name, 'to_key', t.to_key,
           'to_point', jsonb_build_object('lat', t.lat, 'lng', t.lng),
           'previous', jsonb_build_object('latitude', NULL, 'longitude', NULL, 'coords_fix', p.extra_fields->'coords_fix')))
  FROM pin_253 t, auto_pin_253_backup b
 WHERE p.id = t.id AND b.property_id = t.id AND b.rolled_back_at IS NULL
   AND p.status = 'approved' AND p.latitude IS NULL AND p.longitude IS NULL
   AND lower(btrim(COALESCE(p.area, ''))) = lower(t.area);
