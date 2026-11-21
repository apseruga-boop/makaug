-- Staff, pay & targets (Arthur, 21 Nov 2026). King adds and removes staff,
-- sets a monthly salary (every change kept) and daily targets.
-- New tables only: nothing existing changes.
-- Rollback: scripts/rollback-245-staff-pay-history.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- One row per salary set. The latest row for a month is that month's salary;
-- a month with no row carries the last salary set before it.
CREATE TABLE IF NOT EXISTS staff_salaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_key text NOT NULL,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  salary_ugx bigint NOT NULL CHECK (salary_ugx >= 0 AND salary_ugx <= 100000000),
  note text NOT NULL DEFAULT '',
  set_by text NOT NULL DEFAULT '',
  set_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_salaries_person_month ON staff_salaries (person_key, month DESC, set_at DESC);

-- Who was added, removed or brought back, by whom and why. Never deleted.
CREATE TABLE IF NOT EXISTS staff_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_key text NOT NULL,
  user_id text,
  action text NOT NULL CHECK (action IN ('added', 'removed', 'reactivated')),
  reason text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_changes_person ON staff_changes (person_key, at DESC);
