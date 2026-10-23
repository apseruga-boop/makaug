-- Migration 161. Video caption OCR for WhatsApp imports.
-- Stores the text read from a listing video and the facts parsed from it.
-- It does not change price, location, title, or status. Approval blocking
-- reads this table; the backfill report table is separate and is filled only
-- when the dry-run script is asked to publish a review list.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS property_video_ocr (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  ocr_text TEXT,
  parsed_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  override JSONB,
  resolution JSONB,
  frame_count INTEGER,
  video_count INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS property_video_ocr_open_conflict_idx
  ON property_video_ocr (updated_at DESC)
  WHERE override IS NULL
    AND resolution IS NULL
    AND jsonb_typeof(conflicts) = 'array'
    AND jsonb_array_length(conflicts) > 0;

CREATE TABLE IF NOT EXISTS video_ocr_review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  inquiry_reference TEXT,
  listing_status TEXT,
  video_url TEXT,
  caption_text TEXT,
  ocr_text TEXT,
  caption_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  video_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  listing_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS video_ocr_review_items_report_idx
  ON video_ocr_review_items (created_at DESC);
