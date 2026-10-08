-- expect-rows: 14
-- The 14 real fee-exempt agents keep the exemption until 1 Feb 2027; billing
-- starts by itself on that date. Needs migration 190 deployed; run after 194.
-- Sends nothing (notices stay held until exempt_end_notices_enabled is on).
UPDATE agents
   SET fee_exempt_until = '2027-02-01'::date, updated_at = NOW()
 WHERE fee_exempt
   AND fee_exempt_until IS NULL
   AND id NOT IN ('3c9cfc13-7aca-4ae5-9b18-420562b0b174', 'c33ee7fc-79da-4382-a21a-0d13cce2d3f4', '67c83674-2220-4247-8794-3bedca0a60eb')
RETURNING full_name || ' ' || id AS changed_id;
