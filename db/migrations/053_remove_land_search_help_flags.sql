UPDATE properties
SET
  extra_fields = COALESCE(extra_fields, '{}'::jsonb)
    - 'land_verification_concierge_requested'
    - 'land_verification_help_requested'
    - 'land_verification_help',
  updated_at = NOW()
WHERE COALESCE(extra_fields, '{}'::jsonb) ?| ARRAY[
  'land_verification_concierge_requested',
  'land_verification_help_requested',
  'land_verification_help'
];
