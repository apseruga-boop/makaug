-- Private agent ID documents that staff upload (asked for by Arthur on
-- 26 Oct 2026, for fraud control and police requests). Adds one new table
-- and changes no existing row.
--
-- The file bytes live here, in Postgres, not in the media bucket: nothing
-- in this table has a URL. The only way to read a file is the staff-only
-- route GET /api/admin/agent-manager/id-files/:id, which sends
-- Cache-Control: no-store and X-Robots-Tag: noindex and writes an audit row.
--
--   kind         id_front | id_back | other
--   archived_at  set when a newer file replaces this one (it is kept)
--
-- One live front and one live back per agent; "other" can have several.
-- Rollback: scripts/rollback-190-agent-identity-files.sql (keeps the files).

CREATE TABLE IF NOT EXISTS agent_identity_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('id_front', 'id_back', 'other')),
  label TEXT,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  metadata_stripped BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by TEXT,
  uploaded_by_label TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archived_reason TEXT,
  replaced_by UUID
);

CREATE INDEX IF NOT EXISTS agent_identity_files_agent_idx
  ON agent_identity_files (agent_id, uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS agent_identity_files_one_live_side
  ON agent_identity_files (agent_id, kind)
  WHERE archived_at IS NULL AND kind IN ('id_front', 'id_back');
