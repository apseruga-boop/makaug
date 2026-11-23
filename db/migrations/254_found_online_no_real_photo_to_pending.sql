-- 23 Nov 2026: found-online listings approved with no real photo of the
-- property go back to pending (hidden from the site, not deleted).
--
-- Found-online rents were approved on 19-20 Nov with nothing but the poster's
-- TikTok video (e.g. MK-20261119-C9D9BE Kyaliwajjala, MK-20261119-4910CC
-- Bukoto). The same PR adds an approval block for found-online listings
-- with no real photo, which a moderator can override (found_online_real_photo).
-- A "real photo" is one on media.makaug.com that is not taken from the source
-- post: YouTube thumbnails (ytimg), TikTok covers, X video thumbs (twimg),
-- our own copies of them (source-previews/, staff-video-cover/, the harvest
-- cover frame, video stills), evidence cards, stock and data: images don't count.
--
-- Scope, read on prod on 23 Nov 2026 (read-only SELECT):
--   approved found-online listings                     4,175
--   ... with no real photo by the rule above           4,078
--   ... of those approved on or after 19 Nov 2026         41  <- moved here
--   ... of those with no image at all (any date)         113
-- Moving all 4,078 would take nearly every found-online listing off the
-- site, so this moves only the 19 Nov+ batch Arthur reported. To widen it,
-- change the approved_at bound below (Arthur decides).
--
-- Each listing goes to status 'pending', moderation_stage 'pending_review',
-- so it appears in the staff review queue again. approved_at is kept.
-- Nobody is sent anything.
--
-- Backup: found_online_no_photo_254_backup.
-- Rollback (manual, not run by scripts/migrate.js):
--   UPDATE properties p
--      SET status = b.old_status, moderation_stage = b.old_moderation_stage,
--          extra_fields = p.extra_fields - 'held_no_real_photo_254'
--     FROM found_online_no_photo_254_backup b
--    WHERE p.id = b.property_id AND b.rolled_back_at IS NULL
--      AND p.status = 'pending' AND p.extra_fields ? 'held_no_real_photo_254';
--   UPDATE found_online_no_photo_254_backup SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS found_online_no_photo_254_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text,
  old_status text,
  old_moderation_stage text,
  approved_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

INSERT INTO found_online_no_photo_254_backup (property_id, inquiry_reference, old_status, old_moderation_stage, approved_at)
SELECT p.id, p.inquiry_reference, p.status, p.moderation_stage, p.approved_at
  FROM properties p
 WHERE p.status = 'approved'
   AND (p.source = 'found_online_property_source_v1' OR p.listed_via = 'found_online')
   AND p.approved_at >= TIMESTAMPTZ '2026-11-19 00:00:00+03'
   AND NOT EXISTS (
     SELECT 1 FROM property_images i
      WHERE i.property_id = p.id
        AND i.url ~* '^https?://media\.makaug\.com/.+'
        AND i.url !~* '/(source-previews|staff-video-cover)/|ytimg|youtube|youtu\.be|tiktok|twimg|byteimg|photo-1560518883-ce09059eeffa|image[ _-]*pending'
        AND COALESCE(i.slot_key, '') !~* '^(source_evidence|harvest_cover_frame|video_key_frame_|video_still_|video_recovery_still_)'
        AND COALESCE(i.room_label, '') !~* 'image[ _-]*pending'
   )
ON CONFLICT (property_id) DO NOTHING;

UPDATE properties p
   SET status = 'pending',
       moderation_stage = 'pending_review',
       extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
         'held_no_real_photo_254', jsonb_build_object(
           'at', NOW(),
           'by', 'migration_254',
           'reason', 'Found online with no real photo of the property (only the video, its cover or thumbnails). Add a photo or override found_online_real_photo to approve again.'))
  FROM found_online_no_photo_254_backup b
 WHERE p.id = b.property_id AND b.rolled_back_at IS NULL
   AND p.status = 'approved';
