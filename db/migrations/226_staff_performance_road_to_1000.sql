-- Staff Performance and Road to 1000 (15 Nov 2026)
--
-- Arthur, 15 Nov 2026: 1,000 paying agents by 31 Dec 2026, tracked from
-- Monday 16 Nov. Every person has a daily target of joining films, a missed
-- target is carried to the next day, and we must be able to see what came
-- back from each film (replies, calls, sign-ups, payments), not just the send.
--
-- Additive only. Three new tables; nothing existing is changed or backfilled.
--   staff_performance_campaigns  the goal, the dates, the assumed paid rate
--   staff_performance_targets    each person's daily target, with history, so
--                                a change never rewrites a past day's target
--   outreach_events              one row per thing that happened to a send:
--                                a call started, an outcome tapped, a send
--                                blocked, a WhatsApp reply. Append-only; it is
--                                also the audit of who logged what and when.
--   outreach_list_numbers        each person's own stream of numbers to send
--                                to. Every number pasted is kept for good,
--                                including the ones refused as a duplicate,
--                                an existing agent or do-not-contact.
--                                A number can be accepted for one person only.
--
-- Rollback: DROP TABLE outreach_list_numbers, outreach_events, staff_performance_targets,
-- staff_performance_campaigns; (no other table refers to them).

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS staff_performance_campaigns (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal_paying_agents INTEGER NOT NULL CHECK (goal_paying_agents > 0),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  -- Share of sign-ups expected to pay, used until enough sign-ups have paid
  -- for the measured rate to mean something. Editable by King.
  assumed_paid_rate NUMERIC(5,4) NOT NULL DEFAULT 0.5 CHECK (assumed_paid_rate > 0 AND assumed_paid_rate <= 1),
  -- Leaderboard points per step (Arthur, 15 Nov 16:09). Editable by King.
  points JSONB NOT NULL DEFAULT '{"send":1,"reply":3,"signed_up":10,"paid":25}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);

INSERT INTO staff_performance_campaigns (key, name, goal_paying_agents, starts_on, ends_on, assumed_paid_rate, updated_by)
VALUES ('road_to_1000', 'Road to 1000', 1000, DATE '2026-11-16', DATE '2026-12-31', 0.5, 'migration 226')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_performance_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key TEXT NOT NULL REFERENCES staff_performance_campaigns(key) ON DELETE CASCADE,
  person_key TEXT NOT NULL CHECK (person_key ~ '^[a-z0-9]{1,40}$'),
  person_name TEXT NOT NULL,
  daily_target INTEGER NOT NULL CHECK (daily_target >= 0 AND daily_target <= 5000),
  effective_from DATE NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_key, person_key, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_staff_performance_targets_person
  ON staff_performance_targets (campaign_key, person_key, effective_from DESC);

-- The proposed starting targets (King changes them in the tab).
INSERT INTO staff_performance_targets (campaign_key, person_key, person_name, daily_target, effective_from, set_by)
VALUES
  ('road_to_1000', 'ronald', 'Ronald', 250, DATE '2026-11-16', 'migration 226 (proposal)'),
  ('road_to_1000', 'sharon', 'Sharon', 100, DATE '2026-11-16', 'migration 226 (proposal)'),
  ('road_to_1000', 'arthur', 'Arthur', 60, DATE '2026-11-16', 'migration 226 (proposal)')
ON CONFLICT (campaign_key, person_key, effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS outreach_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES agent_prospects(id) ON DELETE SET NULL,
  -- Last nine digits only, like agent_prospects.phone_key. Never a full number.
  phone_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('call_started', 'outcome', 'blocked', 'replied')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'no_answer', 'replied', 'interested', 'signed_up', 'paid', 'not_interested', 'wrong_number'
  )),
  block_code TEXT,
  note TEXT,
  follow_up_on DATE,
  -- Who did it (Arthur / Ronald / Sharon …) as chosen on the desk, and the
  -- account that was signed in when they did (staff accounts are shared).
  person_key TEXT,
  actor_account TEXT,
  actor_user_id TEXT,
  source TEXT NOT NULL DEFAULT 'desk',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_events_prospect ON outreach_events (prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_events_created ON outreach_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_events_follow_up ON outreach_events (follow_up_on) WHERE follow_up_on IS NOT NULL;

CREATE TABLE IF NOT EXISTS outreach_list_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key TEXT NOT NULL DEFAULT 'road_to_1000',
  person_key TEXT NOT NULL CHECK (person_key ~ '^[a-z0-9]{1,40}$'),
  list_day DATE NOT NULL,
  full_name TEXT,
  -- The dialable number stays in the database (staff need it to send the
  -- film); screens and the API only ever show the last three digits.
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  -- 'found_online' when the number is on a found-online listing (allowed
  -- since 15 Nov 2026, reported apart).
  lead_source TEXT,
  -- Why a number was refused when it was pasted:
  -- duplicate_sent | duplicate_list | existing_agent | do_not_contact | invalid
  refused_reason TEXT,
  refused_detail TEXT,
  added_by TEXT,
  added_by_person TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No number goes to two people: one accepted row per number, ever.
CREATE UNIQUE INDEX IF NOT EXISTS ux_outreach_list_numbers_accepted
  ON outreach_list_numbers (phone_key) WHERE accepted IS TRUE;
CREATE INDEX IF NOT EXISTS idx_outreach_list_numbers_person
  ON outreach_list_numbers (person_key, list_day DESC);
