-- Team hub (Arthur, 21 Nov 2026, ops 3c part 1): King's messages to the whole
-- team or to one person (targets go to one person only), the Rules, T&Cs and
-- Working hours pages, and the how-to video slots. In-app only: nothing here
-- sends a WhatsApp, SMS or email. New tables only: nothing existing changes.
-- Rollback: scripts/rollback-249-team-hub.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS team_messages (
  id BIGSERIAL PRIMARY KEY,
  audience TEXT NOT NULL CHECK (audience IN ('team', 'person')),
  to_user_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'target')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'King',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  CHECK ((audience = 'team' AND to_user_id IS NULL) OR (audience = 'person' AND to_user_id IS NOT NULL)),
  CHECK (kind <> 'target' OR audience = 'person')
);
CREATE INDEX IF NOT EXISTS team_messages_recent ON team_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS team_messages_to ON team_messages (to_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_message_reads (
  message_id BIGINT NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_pages (
  key TEXT PRIMARY KEY CHECK (key IN ('rules', 'terms', 'hours')),
  body TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO team_pages (key, body, updated_by) VALUES
  ('rules', E'We never send WhatsApp messages or videos. Use a text (SMS) or a call.\nNever write down or share a person''s full phone number.\nStaff never remove an agent: use Request removal with a reason, and King decides.\nRecord the outcome of every call before the next one.\nDo not call a number marked do not contact.\nPrices: agents pay UGX 50,000 a month, owners UGX 20,000. There is no free trial. Payment is by MoMo merchant code 27248497.', 'starter'),
  ('terms', '', 'starter'),
  ('hours', '', 'starter')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS team_videos (
  id BIGSERIAL PRIMARY KEY,
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);
INSERT INTO team_videos (position, title, updated_by)
SELECT v.position, v.title, 'starter' FROM (VALUES
  (1, 'Making a call on the calling screen'),
  (2, 'Recording the outcome of a call'),
  (3, 'Texting a pay link and checking MoMo'),
  (4, 'Reviewing a found-online listing'),
  (5, 'Reviewing an agent''s listing'),
  (6, 'Working the lead queue')
) AS v(position, title)
WHERE NOT EXISTS (SELECT 1 FROM team_videos);
