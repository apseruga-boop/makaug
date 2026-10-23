ALTER TABLE advertising_placements
  ADD COLUMN IF NOT EXISTS subline TEXT;

-- Replace the October holiday overrides on the Uganda house bands only.
-- The retained bundled paths also select each placement's mobile crop.
-- A pre-deployment API snapshot retains the old creative values for rollback.
WITH refreshed (key, preview_image_url, headline, subline, background_position, copy_side) AS (
  VALUES
    ('home-featured', '/assets/house-ads-v3/home-hero.webp', 'Every property in Uganda, in one place.', 'Search homes, land and rentals by area.', 'left center', 'right'),
    ('home-brokers', '/assets/house-ads-v3/agents.webp', 'Talk to an agent who knows the area.', 'Open an agent profile and message them direct.', 'left center', 'right'),
    ('sale-grid', '/assets/house-ads-v3/sale.webp', 'Search by neighbourhood.', 'Filter by area, bedrooms and property type.', 'left center', 'right'),
    ('rent-grid', '/assets/house-ads-v3/rent.webp', 'Get new rentals first.', 'Tap Save search on any results page.', 'left center', 'right'),
    ('student-grid', '/assets/house-ads-v3/students.webp', 'Find a room near your campus.', 'Search hostels and rooms by university area.', 'left center', 'right'),
    ('commercial-grid', '/assets/house-ads-v3/commercial.webp', 'Shops and offices, one search.', 'Filter by town and type of space.', 'right center', 'left'),
    ('land-grid', '/assets/house-ads-v3/land.webp', 'Walk the plot first.', 'Read our land safety tips, then visit with the seller.', 'left center', 'right'),
    ('marketplace-results', '/assets/house-ads-v3/marketplace.webp', 'Find surveyors, lawyers and builders.', 'Browse property services by area and specialty.', 'left center', 'right'),
    ('brokers-grid', '/assets/house-ads-v3/brokers.webp', 'Agents who know the area.', 'Open a profile to see their current listings.', 'left center', 'right'),
    ('mortgage-results', '/assets/house-ads-v3/mortgage.webp', 'Plan your home loan before you view.', 'Use the repayment calculator to compare lenders.', 'left center', 'right'),
    ('property-detail', '/assets/house-ads-v3/detail.webp', 'Like it? Ask on WhatsApp.', 'WhatsApp 0780 863 394 with the listing link.', 'left center', 'right')
)
UPDATE advertising_placements AS placement
   SET preview_image_url = refreshed.preview_image_url,
       headline = refreshed.headline,
       subline = refreshed.subline,
       background_position = refreshed.background_position,
       copy_side = refreshed.copy_side,
       updated_at = NOW()
  FROM refreshed
 WHERE current_setting('app.country_code', true) = 'UG'
   AND placement.key = refreshed.key
   AND placement.slot_type = 'house_band'
   AND (placement.preview_image_url, placement.headline, placement.subline,
        placement.background_position, placement.copy_side)
       IS DISTINCT FROM
       (refreshed.preview_image_url, refreshed.headline, refreshed.subline,
        refreshed.background_position, refreshed.copy_side);
