'use strict';

const ABOUT_COMMERCIAL_PRODUCTS = Object.freeze({
  version: 'about-commercial-products-20260910-v1',
  currency: 'UGX',
  monthlyDiscountPercent: 10,
  products: Object.freeze({
    privateListing: { amount: 25000, period: 'property / month', trialDays: 7 },
    agentSubscription: { amount: 50000, period: 'month' },
    offPlanDevelopment: { amount: 150000, period: 'project / month' },
    featuredListing: { amount: 50000, period: '7 days' },
    premiumListing: { amount: 25000, period: '7 days' },
    boostedListing: { amount: 25000, period: 'listing / month' },
    marketReport: { amount: 100000, period: 'report' },
    agencyWebsiteSetup: { amount: 200000, period: 'setup' },
    agencyWebsiteMonthly: { amount: 100000, period: 'month' },
    professionalListing: { amount: 50000, period: 'property' },
    advertisingMinimum: { amount: 40000, period: 'placement / week' },
    advertisingMaximum: { amount: 200000, period: 'placement / week' }
  }),
  advertisingPlacements: Object.freeze([
    { page: 'Homepage', placement: 'Hero leaderboard', format: 'Under search, above Featured · 970×250 desktop / 320×100 mobile', amount: 200000 },
    { page: 'Homepage', placement: 'Featured strip sponsor', format: 'Brand logo and link on the Featured strip header', amount: 150000 },
    { page: 'Homepage', placement: 'Mid-page MPU', format: '300×250 beside Popular areas', amount: 100000 },
    { page: 'Homepage', placement: 'Footer banner', format: 'Full width above footer', amount: 60000 },
    { page: 'Search results', placement: 'Top-of-results leaderboard', format: 'Above the first card · per category', amount: 150000 },
    { page: 'Search results', placement: 'In-feed sponsored card', format: 'Native card in positions 4 and 12', amount: 120000 },
    { page: 'Search results', placement: 'Sidebar MPU', format: '300×250 sticky desktop · after result 8 mobile', amount: 90000 },
    { page: 'Search results', placement: 'Bottom-of-results banner', format: 'Under pagination', amount: 50000 },
    { page: 'Property detail', placement: 'Above enquiry form', format: '300×250 beside contact and WhatsApp', amount: 120000 },
    { page: 'Property detail', placement: 'Below gallery banner', format: 'Full width under photo gallery', amount: 80000 },
    { page: 'Property detail', placement: 'Similar properties sponsor', format: 'Sponsored card in Similar properties', amount: 60000 },
    { page: 'Off Plan', placement: 'Hero banner', format: 'Top of Uganda and Overseas landing page', amount: 175000 },
    { page: 'Off Plan', placement: 'In-feed development card', format: 'Sponsored development card in position 2', amount: 120000 },
    { page: 'Mortgage Finder', placement: 'Lender partner placement', format: 'Featured lender box at top of results', amount: 150000 },
    { page: 'Mortgage Finder', placement: 'Sidebar MPU', format: '300×250', amount: 80000 },
    { page: 'Property Value', placement: 'Results-page banner', format: 'Shown with valuation result', amount: 100000 },
    { page: 'Find Brokers', placement: 'Broker spotlight', format: 'Top-of-directory featured agency card', amount: 100000 },
    { page: 'Find Brokers', placement: 'Sidebar MPU', format: '300×250', amount: 50000 },
    { page: 'AI Chatbot / Ask AI', placement: 'Sponsored suggestion', format: 'Labelled partner suggestion in relevant answers', amount: 100000 },
    { page: 'Marketplace', placement: 'Category sponsor', format: 'Banner at top of a Marketplace category', amount: 60000 },
    { page: 'About / Help / Safety', placement: 'Content-page MPU', format: '300×250 in right rail or between sections', amount: 40000 },
    { page: 'Email / WhatsApp alerts', placement: 'Alert sponsor', format: 'Logo and one line in every alert that week', amount: 100000 }
  ])
});

if (typeof window !== 'undefined') {
  window.__MAKAUG_ABOUT_COMMERCIAL_PRODUCTS__ = ABOUT_COMMERCIAL_PRODUCTS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ABOUT_COMMERCIAL_PRODUCTS;
}
