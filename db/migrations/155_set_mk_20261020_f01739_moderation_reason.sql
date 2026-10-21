-- Set the rejection reason the admin "Reject with reason" flow stores in
-- properties.moderation_reason, for inquiry reference MK-20261020-F01739 only.
-- IS DISTINCT FROM makes a second run match nothing, so the updated_at
-- trigger does not rewrite the row again. No other column is assigned.

UPDATE properties
   SET moderation_reason = 'No specific location in source; taken down pending location from agent'
 WHERE inquiry_reference = 'MK-20261020-F01739'
   AND moderation_reason IS DISTINCT FROM 'No specific location in source; taken down pending location from agent';
