# Rate card database steps (PR G, 8 Oct 2026)

These files change live rows, so they are **not** migrations: nothing here runs
at boot. Arthur runs them himself, one at a time, with the runner, which is a
dry run unless `--apply` is given and the changed-row count matches the
file's `-- expect-rows:` header:

    node scripts/run-manual-sql.js db/manual/pricing/<file>.sql           # dry run
    node scripts/run-manual-sql.js db/manual/pricing/<file>.sql --apply   # commit

Every statement matches on the id **and** a second guard column (code, name or
amount), so a wrong id changes nothing. Order: 191, 192, 193, 194, then 195
(needs migration 190 deployed), 196 only if Arthur confirms, 197.
Check afterwards with `node scripts/pricing-db-drift.js` (read-only).
