-- Who approved a listing. reviewed_by is the last person to touch the row,
-- which changes again when someone edits or unpublishes it. approved_by stays
-- the staff member who sent it live.
--
-- The backfill uses the latest listing_status_changed event into approved.
-- actor_id is text and users.id is uuid, so the join compares text. A direct
-- uuid = text comparison has no operator and the deploy exits.
-- The updated_at trigger is off for that fill so thousands of live listings
-- are not marked as just edited. A second run matches nothing because
-- approved_by is already set.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);

ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;

UPDATE properties AS p
   SET approved_by = latest.actor_id::uuid
  FROM (
    SELECT DISTINCT ON (e.property_id) e.property_id, e.actor_id
      FROM property_moderation_events e
      JOIN users u ON u.id::text = e.actor_id
     WHERE e.action = 'listing_status_changed'
       AND e.status_to = 'approved'
       AND e.actor_id IS NOT NULL
     ORDER BY e.property_id, e.created_at DESC
  ) latest
 WHERE p.id = latest.property_id
   AND p.approved_by IS NULL
   AND p.status IN ('approved', 'live', 'published', 'sold', 'hidden');

ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
