-- Split combined adverts and set the Namanve warehouse price
-- (Arthur, 20 Nov 2026: "sort them out").
--
-- This file only creates the backup table. The row updates and the new
-- pending listings run after the process is already serving, from
-- scripts/run-split-multi-plot-listings-242.js (hooked from
-- scheduleStartupDataRepairs):
--   * MK-20261120-P5T3F stays pending as the Kawuku 20-acre listing;
--     a new pending listing is created for 9 acres on Bussi Island at
--     UGX 160 million per acre, same lister, photos copied from the
--     combined advert for staff to confirm.
--   * MK-20261120-8STA5 stays live as the first (Bwaise) plot at the
--     advert price of UGX 300 million; three new PENDING listings are
--     created for the Kawempe plots at UGX 300, 350 and 360 million.
--     Photos stay on the Bwaise row (they show one roadside plot).
--   * MK-20261120-Y2URD stays pending; price set to USD 1,950,000 with
--     the site's UGX conversion. Land size 4 acres and type Warehouse
--     are already on the row.
-- Re-running is a no-op. Rollback:
-- scripts/rollback-242-split-multi-plot-listings.sql.
-- Nothing is sent to anyone.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS split_multi_plot_listings_242_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  source_inquiry_reference text NOT NULL,
  property_id uuid NOT NULL,
  inquiry_reference text NOT NULL,
  before_row jsonb,
  before_updated_at timestamptz,
  applied_at timestamptz NOT NULL,
  rolled_back_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS split_multi_plot_listings_242_backup_property_id
  ON split_multi_plot_listings_242_backup (property_id);
