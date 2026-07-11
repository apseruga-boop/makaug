UPDATE properties
SET listing_type = 'students',
    students_welcome = TRUE,
    nearest_university = COALESCE(
      NULLIF(nearest_university, ''),
      NULLIF(extra_fields->>'nearest_university', ''),
      NULLIF(extra_fields->>'student_campus', ''),
      NULLIF(extra_fields->>'student_university', '')
    ),
    extra_fields = COALESCE(extra_fields, '{}'::jsonb)
      || jsonb_build_object(
        'student_supply_backfill', TRUE,
        'student_supply_backfill_version', 'student-supply-gate-20260711'
      ),
    updated_at = NOW()
WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
  AND LOWER(COALESCE(listing_type, '')) NOT IN ('students', 'student')
  AND CONCAT_WS(' ',
    COALESCE(title, ''),
    COALESCE(description, ''),
    COALESCE(area, ''),
    COALESCE(address, ''),
    COALESCE(extra_fields->>'source_title', ''),
    COALESCE(extra_fields->>'source_caption', ''),
    COALESCE(extra_fields->>'source_description', '')
  ) ~* '(student|hostel|campus|self[[:space:]-]*contained|single[[:space:]]+room|double[[:space:]]+room|bedsitter|bed[[:space:]]*sitter|roommate|per[[:space:]]+semester|non[[:space:]-]*residential|residential[[:space:]]+hostel|rooms?[[:space:]]+near[[:space:]]+campus)';
