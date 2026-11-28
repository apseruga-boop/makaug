-- TikTok cover pictures (Arthur, 28 Nov 2026): TikTok listings had no picture
-- because TikTok's own cover links expire. The cover job
-- (services/tiktokCoverScheduler.js) now saves our own copy on the media host
-- as one extra property_images row per listing (slot video_still_tiktok_cover).
-- This table is the backup: one row per cover saved, naming the picture row it
-- added and any rows it made non-primary, so the whole backfill can be undone.
-- New table only: nothing existing changes, no listing is touched here.
-- Rollback: scripts/rollback-253-tiktok-covers.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS tiktok_cover_log (
  id BIGSERIAL PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  image_id UUID NOT NULL,
  cover_url TEXT NOT NULL,
  source_video_url TEXT,
  source_kind TEXT,
  demoted_image_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS tiktok_cover_log_one_live_per_listing
  ON tiktok_cover_log (property_id) WHERE rolled_back_at IS NULL;
