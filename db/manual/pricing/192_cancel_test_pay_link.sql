-- expect-rows: 1
-- The 1,000 test pay link MKTVTTN34R, only while it is still open.
UPDATE pay_links
   SET status = 'cancelled', updated_at = NOW()
 WHERE id = '26bed21c-07f8-4b93-9811-d0a4d2b281ac'
   AND code = 'MKTVTTN34R'
   AND amount_ugx = 1000
   AND purpose = 'other'
   AND status = 'open'
RETURNING code AS changed_id;
