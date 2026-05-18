UPDATE properties
SET
  description = replace(
    description,
    ' Verify exact plot number, access road, title particulars, boundary marks, and availability with Bakaima before public approval.',
    ''
  ),
  updated_at = NOW()
WHERE extra_fields->>'source_batch' = 'bakaima_authorised_land_20260518'
  AND description LIKE '%Verify exact plot number, access road, title particulars, boundary marks, and availability with Bakaima before public approval.%';
