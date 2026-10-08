-- expect-rows: 1
-- ONLY IF ARTHUR CONFIRMS: the agent-subscription pay link MKRXBPJ9Y5 for a
-- fee-exempt agent, only while it is still open.
UPDATE pay_links
   SET status = 'cancelled', updated_at = NOW()
 WHERE id = '75d75ee9-c42b-4d1c-b00f-def58679b78d'
   AND code = 'MKRXBPJ9Y5'
   AND amount_ugx = 50000
   AND purpose = 'agent_subscription'
   AND status = 'open'
RETURNING code AS changed_id;
