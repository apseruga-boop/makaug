-- Soft-delete for CRM leads so staff can clear junk or finished leads
-- from the default open list without losing the record. Filters can
-- still show deleted leads. Rollback: DROP the two columns.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_open_not_deleted
  ON leads(lead_status, created_at DESC)
  WHERE deleted_at IS NULL;
