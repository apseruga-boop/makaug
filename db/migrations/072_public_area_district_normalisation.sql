-- Keep public search filters aligned with the location label users actually see.
-- Some sourced rows had a correct area but a stale/conflicting district from caption text.

WITH public_area_district(area_name, district_name) AS (
  VALUES
    ('akright', 'Wakiso'),
    ('banda', 'Kampala'),
    ('bugolobi', 'Kampala'),
    ('bukasa', 'Kampala'),
    ('bukoto', 'Kampala'),
    ('buwate', 'Wakiso'),
    ('bwebajja', 'Wakiso'),
    ('bwebajja akright', 'Wakiso'),
    ('bweyogerere', 'Wakiso'),
    ('gaba', 'Kampala'),
    ('gayaza', 'Wakiso'),
    ('kajjansi', 'Wakiso'),
    ('kasangati', 'Wakiso'),
    ('katosi', 'Mukono'),
    ('kibuli', 'Kampala'),
    ('kira', 'Wakiso'),
    ('kisaasi', 'Kampala'),
    ('kisasi', 'Kampala'),
    ('kitende', 'Wakiso'),
    ('kiwatule', 'Kampala'),
    ('kololo', 'Kampala'),
    ('komamboga', 'Kampala'),
    ('kyanja', 'Kampala'),
    ('kyebando', 'Kampala'),
    ('kyaliwajjala', 'Wakiso'),
    ('lubaga', 'Kampala'),
    ('lugogo', 'Kampala'),
    ('makindye', 'Kampala'),
    ('mengo', 'Kampala'),
    ('muyenga', 'Kampala'),
    ('munyonyo', 'Kampala'),
    ('mutungo', 'Kampala'),
    ('najjera', 'Wakiso'),
    ('najjeera', 'Wakiso'),
    ('nakawa', 'Kampala'),
    ('namugongo', 'Wakiso'),
    ('nansana', 'Wakiso'),
    ('nateete', 'Kampala'),
    ('ndeeba', 'Kampala'),
    ('ntinda', 'Kampala'),
    ('seguku', 'Wakiso'),
    ('seeta', 'Mukono')
)
UPDATE properties p
SET
  district = public_area_district.district_name,
  updated_at = NOW(),
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
    || jsonb_build_object(
      'public_location_district_normalised', true,
      'public_location_district_normalised_at', NOW()::text,
      'public_location_previous_district', p.district
    )
FROM public_area_district
WHERE LOWER(TRIM(COALESCE(p.area, ''))) = public_area_district.area_name
  AND COALESCE(NULLIF(TRIM(p.district), ''), '') IS DISTINCT FROM public_area_district.district_name
  AND LOWER(COALESCE(p.status, '')) IN ('approved', 'live', 'published');

ANALYZE properties;
