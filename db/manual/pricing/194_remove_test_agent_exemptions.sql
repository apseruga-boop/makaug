-- expect-rows: 3
-- The three test accounts lose their fee exemption. Guarded by name. Sends nothing.
UPDATE agents
   SET fee_exempt = false, fee_exempt_reason = NULL, fee_exempt_until = NULL, updated_at = NOW()
 WHERE (id = '3c9cfc13-7aca-4ae5-9b18-420562b0b174' AND full_name = 'Makaug Training Agent One')
    OR (id = 'c33ee7fc-79da-4382-a21a-0d13cce2d3f4' AND full_name = 'Makaug Training Agent Two')
    OR (id = '67c83674-2220-4247-8794-3bedca0a60eb' AND full_name = 'QA TEST - DELETE Broker')
RETURNING full_name || ' ' || id AS changed_id;
