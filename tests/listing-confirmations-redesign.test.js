const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const {
  buildOwnerSubmissionMessage,
  buildOwnerStatusMessage
} = require('../services/listingModerationService');

const html = read('index.html');
const server = read('server.js');
const propertiesRoute = read('routes/properties.js');
const app = read('assets/makaug-app.js');
const moderationService = read('services/listingModerationService.js');

const listing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '4-bed Property for sale - Kyanja, Kampala',
  inquiry_reference: 'MK-20260713-ABCD1',
  lister_name: 'Arthur',
  lister_email: 'owner@example.com',
  lister_phone: '+256701234567',
  listing_type: 'sale',
  area: 'Kyanja',
  district: 'Kampala',
  price: 850000000,
  price_period: 'once',
  created_at: '2026-07-13T04:54:00.000Z',
  primary_image_url: 'https://makaug.com/uploads/kyanja.jpg',
  live_count: 1885
};

const submitted = buildOwnerSubmissionMessage({ listing });
assert.strictEqual(submitted.subject, "We've received your makaug listing");
assert(submitted.text.includes('Property: 4-bed Property for sale - Kyanja, Kampala'), 'submitted text should name the property');
assert(submitted.text.includes('Reference: MK-20260713-ABCD1'), 'submitted text should include the same reference');
assert(submitted.text.includes('13 July 2026'), 'submitted date should be human-friendly in Uganda timezone');
assert(!submitted.text.includes('2026-07-13T04:54:00.000Z'), 'submitted text must not expose a raw ISO timestamp');
assert(submitted.html.includes("We've received your listing"), 'submitted email should use the redesigned received heading');
assert(submitted.html.includes('max-width:600px'), 'submitted email should stay inside a 600px email-safe shell');
assert(submitted.html.includes('Pending review'), 'submitted email should show a pending review pill');
assert(submitted.html.includes('Browse listings'), 'submitted email should include the single re-engagement CTA');
assert(submitted.html.includes('1,885 live listings'), 'submitted email should include the live-count re-engagement strip when available');
assert(!submitted.text.includes('Dashboard:'), 'submitted text should not include the old dashboard button/link pile');
assert(!submitted.text.includes('Open makaug:'), 'submitted text should not duplicate the browse CTA');
assert(submitted.whatsapp.includes('your makaug listing is *submitted* and under review'), 'submitted WhatsApp copy should align with the email');
assert(submitted.whatsapp.includes('Browse makaug meanwhile: https://makaug.com'), 'submitted WhatsApp copy should pull the user back to the site');

const live = buildOwnerStatusMessage({ listing, status: 'approved' });
assert.strictEqual(live.subject, 'Your listing is live - 4-bed Property for sale - Kyanja, Kampala');
assert(live.text.includes('Your property is now live on makaug'), 'live text should announce the listing is live');
assert(live.text.includes('View listing: https://makaug.com/property/11111111-1111-4111-8111-111111111111'), 'live text should include the public URL');
assert(live.html.includes('Share on WhatsApp'), 'live email should include WhatsApp sharing');
assert(live.html.includes('Share on Facebook'), 'live email should include Facebook sharing');
assert(live.html.includes('View listing'), 'live email should include a direct view-listing CTA');
assert(live.html.includes('https://makaug.com/uploads/kyanja.jpg'), 'live email should render the primary image');
assert(live.html.includes('USh 850,000,000'), 'live email should format UGX prices as USh');
assert(live.whatsapp.includes('View & share: https://makaug.com/property/11111111-1111-4111-8111-111111111111'), 'live WhatsApp copy should include the share URL');

assert(html.includes('listing-confirmations-redesign-20260713'), 'index marker should expose the listing-confirmation redesign');
assert(server.includes('listingConfirmationsRedesignVersion'), 'server should cache-bust the listing-confirmation redesign');
assert(propertiesRoute.includes('sendOwnerListingSubmissionNotifications'), 'create route should send the submitted owner confirmation');
assert(propertiesRoute.includes('primary_image_url: imageUrls[0] || null'), 'submitted confirmation should receive the first image as the primary image');
assert(propertiesRoute.includes('getPrimaryImageUrlForProperty(listing.id)'), 'approved confirmation should hydrate the primary image for the share card');
assert(propertiesRoute.includes('price, price_period, area, district, created_at'), 'status notification payload should include card facts');
assert(app.includes('Get your confirmation on WhatsApp'), 'success modal should expose the click-to-chat WhatsApp fallback');
assert(server.includes("app.get('/property/:id'"), 'server should provide listing-specific HTML for social previews');
assert(server.includes('patchListingOpenGraphMeta'), 'server should patch OG tags for listing pages');
assert(server.includes('og:image'), 'server OG patch should include listing images');
assert(!moderationService.includes('const submittedAt = new Date().toISOString();'), 'old raw-ISO submitted timestamp must stay removed');

console.log('Listing confirmation redesign tests passed');
