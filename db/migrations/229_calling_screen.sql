-- Calling screen (16 Nov 2026)
--
-- Arthur, 16 Nov 2026: Ronald (then Harriet and anyone added later) works from
-- a full-screen calling session. He picks a task (get new agents, get payments
-- in, client retention), one number comes up at a time, he taps to call from
-- the company phone, and the call only counts once he has picked an outcome.
-- Every number shown, every tap, the call length, the outcome, the note and
-- the gap between calls are kept so King can check the work.
--
-- Additive only. New tables; no existing table or row is changed. Reuses
-- agent_prospects, outreach_list_numbers, agents and revenue_entries by id.
--   call_tasks              the task picker, data-driven: queue kind, steps,
--                           outcomes and settings per task (add a row = a new task)
--   call_targets            calls and closes per person per day, with history
--   call_sessions           one work session: started, ended, open / focus /
--                           away / break time, exits, last heartbeat
--   call_session_events     fullscreen exits and returns, tab hidden / visible,
--                           breaks, sales-kit sends (append-only)
--   call_attempts           one row per number shown: tap, end, wrap-up,
--                           outcome, note, callback, flags. A number can be open
--                           for one caller at a time (unique index), so two
--                           people never ring the same number at once.
--   call_number_submissions numbers a caller adds; King reviews them before
--                           they join anyone's list
--   call_daily_reports      the end-of-day report per person, saved as it is made
--
-- Phones: the dialable number is kept (the caller needs it); screens, reports
-- and the API outside the focus screen only show the last three digits.
--
-- Rollback (nothing else refers to these tables):
--   DROP TABLE IF EXISTS call_daily_reports, call_number_submissions,
--     call_session_events, call_attempts, call_sessions, call_targets, call_tasks;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS call_tasks (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Which queue builder fills it: new_agents | payments | retention
  queue_kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Script variants this task may use, first one is the default.
  script_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The steps the caller must tick: [{key,label,required}]
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Wrap-up outcomes: [{key,label,spoke,close,date:'required'|'optional'|null,terminal}]
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Queue settings: cooldown_days, max_no_answer, inactive_days, renewal_window_days, lapsed_split_days
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO call_tasks (key, name, description, queue_kind, sort_order, script_variants, checklist, outcomes, config, updated_by) VALUES
('new_agents', 'Get new agents', 'Numbers from your morning list and the Outreach prospects. Sign them up as agents.', 'new_agents', 10,
 '["cold_call","found_online","existing_contact"]'::jsonb,
 '[{"key":"name","label":"Confirmed their name","required":true},
   {"key":"role","label":"Agent or owner?","required":true},
   {"key":"areas","label":"Areas they cover","required":false},
   {"key":"listings","label":"How many places they have now","required":false},
   {"key":"price","label":"Told the price: UGX 50,000 a month (owners UGX 20,000), no free trial","required":true},
   {"key":"whatsapp","label":"OK to WhatsApp them the film and link","required":false}]'::jsonb,
 '[{"key":"no_answer","label":"No answer","spoke":false,"close":false,"date":null,"terminal":false},
   {"key":"rejected","label":"Rejected","spoke":true,"close":false,"date":null,"terminal":true},
   {"key":"call_back","label":"Call back","spoke":true,"close":false,"date":"required","terminal":false},
   {"key":"interested","label":"Interested","spoke":true,"close":false,"date":"optional","terminal":false},
   {"key":"signed_up","label":"Closed / signed up","spoke":true,"close":true,"date":null,"terminal":true},
   {"key":"do_not_contact","label":"Don''t contact again","spoke":true,"close":false,"date":null,"terminal":true},
   {"key":"wrong_number","label":"Wrong number","spoke":false,"close":false,"date":null,"terminal":true}]'::jsonb,
 '{"cooldown_days":null,"max_no_answer":3}'::jsonb, 'migration 229'),
('payments', 'Get payments in', 'Agents who signed up but have not paid, and renewals that are overdue. MoMo merchant code 27248497.', 'payments', 20,
 '["payment_follow_up"]'::jsonb,
 '[{"key":"name","label":"Confirmed their name","required":true},
   {"key":"amount","label":"Told the amount (UGX 50,000 a month)","required":true},
   {"key":"momo","label":"Gave MoMo merchant code 27248497","required":true},
   {"key":"reference","label":"Asked them to send the payment reference","required":false},
   {"key":"date","label":"Agreed a pay date if not today","required":false}]'::jsonb,
 '[{"key":"no_answer","label":"No answer","spoke":false,"close":false,"date":null,"terminal":false},
   {"key":"call_back","label":"Call back","spoke":true,"close":false,"date":"required","terminal":false},
   {"key":"promised","label":"Promised to pay","spoke":true,"close":false,"date":"required","terminal":false},
   {"key":"paid","label":"Paid now (check MoMo)","spoke":true,"close":true,"date":null,"terminal":false},
   {"key":"rejected","label":"Won''t pay","spoke":true,"close":false,"date":null,"terminal":false},
   {"key":"do_not_contact","label":"Don''t contact again","spoke":true,"close":false,"date":null,"terminal":true},
   {"key":"wrong_number","label":"Wrong number","spoke":false,"close":false,"date":null,"terminal":true}]'::jsonb,
 '{"cooldown_days":3,"max_no_answer":3,"lapsed_split_days":14}'::jsonb, 'migration 229'),
('retention', 'Client retention', 'Paying agents near renewal, agents with no new listing lately, and agents whose payment lapsed. Check in, help them list, renew.', 'retention', 30,
 '["retention"]'::jsonb,
 '[{"key":"name","label":"Confirmed their name","required":true},
   {"key":"checkin","label":"Asked how makaug is working for them","required":true},
   {"key":"listings","label":"Offered help to list new places","required":false},
   {"key":"renewal","label":"Reminded them of the renewal date and the MoMo code 27248497","required":true},
   {"key":"issue","label":"Wrote down any problem they have","required":false}]'::jsonb,
 '[{"key":"no_answer","label":"No answer","spoke":false,"close":false,"date":null,"terminal":false},
   {"key":"call_back","label":"Call back","spoke":true,"close":false,"date":"required","terminal":false},
   {"key":"renewed","label":"Renewed / paid","spoke":true,"close":true,"date":null,"terminal":false},
   {"key":"will_list","label":"Will list new places","spoke":true,"close":false,"date":"optional","terminal":false},
   {"key":"needs_help","label":"Needs help (note it)","spoke":true,"close":false,"date":"optional","terminal":false},
   {"key":"not_renewing","label":"Not renewing","spoke":true,"close":false,"date":null,"terminal":false},
   {"key":"do_not_contact","label":"Don''t contact again","spoke":true,"close":false,"date":null,"terminal":true},
   {"key":"wrong_number","label":"Wrong number","spoke":false,"close":false,"date":null,"terminal":true}]'::jsonb,
 '{"cooldown_days":14,"max_no_answer":3,"inactive_days":14,"renewal_window_days":7,"lapsed_split_days":14}'::jsonb, 'migration 229')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS call_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_key TEXT NOT NULL CHECK (person_key ~ '^[a-z0-9]{1,40}$'),
  calls_per_day INTEGER NOT NULL CHECK (calls_per_day >= 0 AND calls_per_day <= 1000),
  closes_per_day INTEGER NOT NULL CHECK (closes_per_day >= 0 AND closes_per_day <= 200),
  effective_from DATE NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_key, effective_from)
);

CREATE TABLE IF NOT EXISTS call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_key TEXT NOT NULL CHECK (person_key ~ '^[a-z0-9]{1,40}$'),
  task_key TEXT NOT NULL,
  actor_account TEXT,
  actor_user_id TEXT,
  device TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  -- exited (tapped Exit) | dropped (heartbeats stopped) | replaced (started again)
  end_reason TEXT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  open_ms BIGINT NOT NULL DEFAULT 0,
  focus_ms BIGINT NOT NULL DEFAULT 0,
  away_ms BIGINT NOT NULL DEFAULT 0,
  break_ms BIGINT NOT NULL DEFAULT 0,
  oncall_hidden_ms BIGINT NOT NULL DEFAULT 0,
  exit_count INTEGER NOT NULL DEFAULT 0,
  break_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_call_sessions_person ON call_sessions (person_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_open ON call_sessions (person_key) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS call_session_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  -- fs_exit | fs_enter | hidden | visible | break_start | break_end | kit_send | task_switch | start | end
  kind TEXT NOT NULL,
  detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_session_events_session ON call_session_events (session_id, at);

CREATE TABLE IF NOT EXISTS call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  person_key TEXT NOT NULL,
  task_key TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  full_name TEXT,
  -- list | prospect | agent | callback
  source_kind TEXT NOT NULL,
  source_label TEXT,
  reason TEXT,
  script_variant TEXT,
  prospect_id UUID,
  list_number_id UUID,
  agent_id UUID,
  -- shown | calling | done | skipped | released
  status TEXT NOT NULL DEFAULT 'shown',
  shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tapped_at TIMESTAMPTZ,
  tap_count INTEGER NOT NULL DEFAULT 0,
  ended_at TIMESTAMPTZ,
  wrapped_at TIMESTAMPTZ,
  talk_s INTEGER,
  wrapup_s INTEGER,
  gap_s INTEGER,
  outcome TEXT,
  is_close BOOLEAN NOT NULL DEFAULT FALSE,
  spoke BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  callback_at TIMESTAMPTZ,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  skip_reason TEXT,
  flags TEXT[] NOT NULL DEFAULT '{}',
  actor_account TEXT,
  actor_user_id TEXT
);
-- One open attempt per number across everyone: nobody rings a number someone else has up.
CREATE UNIQUE INDEX IF NOT EXISTS ux_call_attempts_open_phone
  ON call_attempts (phone_key) WHERE status IN ('shown', 'calling');
CREATE INDEX IF NOT EXISTS idx_call_attempts_phone ON call_attempts (phone_key, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_attempts_person ON call_attempts (person_key, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_attempts_callback ON call_attempts (callback_at) WHERE callback_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS call_number_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_key TEXT NOT NULL,
  full_name TEXT,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  note TEXT,
  -- pending | approved | rejected | duplicate
  status TEXT NOT NULL DEFAULT 'pending',
  duplicate_of TEXT,
  list_number_id UUID,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_call_number_submissions_pending
  ON call_number_submissions (phone_key) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS call_daily_reports (
  person_key TEXT NOT NULL,
  day DATE NOT NULL,
  figures JSONB NOT NULL,
  made_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_key, day)
);
