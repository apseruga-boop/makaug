-- Public project-map sources consistently place AMRA around this point in the
-- Umm Al Quwain coastal development zone. Treat it as an area marker rather
-- than a verified entrance pin until the developer confirms the exact site.
UPDATE off_plan_developments
SET latitude = 25.5777300,
    longitude = 55.5651400,
    extra_fields = extra_fields || jsonb_build_object(
      'map_precision', 'area_centroid',
      'map_marker_source', 'public_project_map_consensus_2026_09_10',
      'map_marker_note', 'Approximate AMRA area marker; confirm the exact project entrance before relying on travel distances.',
      'map_marker_source_urls', jsonb_build_array(
        'https://dubainary.com/off-plan/citi-developers-amra-residences/floor-plans',
        'https://www.benhams.ae/off-plan-properties/umm-al-quwain/amra-residences-umm-al-quwain-city-533222/',
        'https://smartbroker.ae/projects/citi-developers-amra-residences-al-rawdah'
      )
    ),
    updated_at = NOW()
WHERE country_code = 'AE' AND slug = 'amra-umm-al-quwain';
