ALTER TABLE marketplace_drip_state
  ALTER COLUMN monthly_request_cap SET DEFAULT 2000;

UPDATE marketplace_drip_state
   SET monthly_request_cap = 2000,
       updated_at = NOW()
 WHERE drip_key = 'marketplace_national_v1'
   AND monthly_request_cap < 2000;

COMMENT ON COLUMN marketplace_drip_state.monthly_request_cap IS
  'Hard monthly source-request ceiling. Marketplace scale-up default is 2,000 requests; the drip pauses when reached.';
