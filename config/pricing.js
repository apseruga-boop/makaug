'use strict';

// makaug rate card: the ONE place a price lives (PR G, 8 Oct 2026).
//
// Arthur's decisions of 8 Oct 2026 (makaug Finance & Sales; master doc
// https://docs.google.com/document/d/1B4fb7GSmz_XetnNzLa6OzNnyySccY1vxYxPwoU3OFCc/edit).
// All prices include VAT. Every server path, the SPA (window.__MAKAUG_PRICING__,
// inlined by the server), the PDFs, WhatsApp and the AI prompts read from here.
// The database never overrides an amount: billing_settings keeps only
// operational knobs, and a disagreeing row is logged as pricing_drift.
//
// Loaded as a UMD file: module.exports on the server, window.__MAKAUG_PRICING__
// in the browser (/config/pricing.js is on the static allowlist).

(function (root, factory) {
  const pricing = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = pricing;
  if (typeof window !== 'undefined') window.__MAKAUG_PRICING__ = pricing;
  else if (root) root.__MAKAUG_PRICING__ = pricing;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const freezeDeep = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeDeep);
      Object.freeze(value);
    }
    return value;
  };

  const MIN_WEEKLY_UGX = 50000;
  const MAX_WEEKLY_UGX = 200000;

  // The 22 weekly display placements published on /about. A placement outside
  // the 50,000–200,000 weekly range is "Price on request" with no amount.
  const placementRows = [
    ['homepage_hero_leaderboard', 'Homepage', 'Hero leaderboard', 'Under search, above Featured · 970×250 desktop / 320×100 mobile', 200000],
    ['homepage_featured_strip_sponsor', 'Homepage', 'Featured strip sponsor', 'Brand logo and link on the Featured strip header', 150000],
    ['homepage_mid_page_mpu', 'Homepage', 'Mid-page MPU', '300×250 beside Popular areas', 100000],
    ['homepage_footer_banner', 'Homepage', 'Footer banner', 'Full width above footer', 60000],
    ['search_top_leaderboard', 'Search results', 'Top-of-results leaderboard', 'Above the first card · per category', 150000],
    ['search_in_feed_card', 'Search results', 'In-feed sponsored card', 'Native card in positions 4 and 12', 120000],
    ['search_sidebar_mpu', 'Search results', 'Sidebar MPU', '300×250 sticky desktop · after result 8 mobile', 90000],
    ['search_bottom_banner', 'Search results', 'Bottom-of-results banner', 'Under pagination', 50000],
    ['detail_above_enquiry', 'Property detail', 'Above enquiry form', '300×250 beside contact and WhatsApp', 120000],
    ['detail_below_gallery', 'Property detail', 'Below gallery banner', 'Full width under photo gallery', 80000],
    ['detail_similar_sponsor', 'Property detail', 'Similar properties sponsor', 'Sponsored card in Similar properties', 60000],
    ['off_plan_hero_banner', 'Off Plan', 'Hero banner', 'Top of Uganda and Overseas landing page', 175000],
    ['off_plan_in_feed_card', 'Off Plan', 'In-feed development card', 'Sponsored development card in position 2', 120000],
    ['mortgage_lender_partner', 'Mortgage Finder', 'Lender partner placement', 'Featured lender box at top of results', 150000],
    ['mortgage_sidebar_mpu', 'Mortgage Finder', 'Sidebar MPU', '300×250', 80000],
    ['valuation_results_banner', 'Property Value', 'Results-page banner', 'Shown with valuation result', 100000],
    ['brokers_spotlight', 'Find Brokers', 'Broker spotlight', 'Top-of-directory featured agency card', 100000],
    ['brokers_sidebar_mpu', 'Find Brokers', 'Sidebar MPU', '300×250', 50000],
    ['ask_ai_sponsored_suggestion', 'AI Chatbot / Ask AI', 'Sponsored suggestion', 'Labelled partner suggestion in relevant answers', 100000],
    ['marketplace_category_sponsor', 'Marketplace', 'Category sponsor', 'Banner at top of a Marketplace category', 60000],
    ['content_page_mpu', 'About / Help / Safety', 'Content-page MPU', '300×250 in right rail or between sections', 40000],
    ['alerts_sponsor', 'Email / WhatsApp alerts', 'Alert sponsor', 'Logo and one line in every alert that week', 100000]
  ];
  // /advertise packages and the in-page house-ad bands, as currently sold.
  // These are the same amounts the catalog had; the display rule below turns
  // anything outside 50,000–200,000 a week into "Price on request".
  // [key, price_ugx, duration_days] — duration 0 = one-off, no weekly basis.
  const advertisingPackageRows = [
    ['regional_search_boost', 150000, 14],
    ['homepage_banner', 250000, 7],
    ['agent_spotlight', 120000, 14],
    ['student_accommodation_push', 180000, 14],
    ['commercial_land_sponsor', 220000, 14],
    ['whatsapp_chatbot_sponsor', 200000, 7],
    ['haymaker_all_platform', 950000, 30],
    ['creative_design_addon', 80000, 0]
  ];
  // [placement key, weekly base price]
  const advertisingBandRows = [
    ['home-featured', 350000], ['home-brokers', 300000], ['sale-grid', 180000], ['rent-grid', 180000],
    ['student-grid', 220000], ['commercial-grid', 240000], ['land-grid', 240000], ['marketplace-results', 180000],
    ['brokers-grid', 160000], ['mortgage-results', 220000], ['property-detail', 120000]
  ];
  const withinDisplayRange = (weekly) => Number.isFinite(weekly) && weekly >= MIN_WEEKLY_UGX && weekly <= MAX_WEEKLY_UGX;
  const placements = placementRows.map(([key, page, placement, format, weekly]) => (withinDisplayRange(weekly)
    ? { key, page, placement, format, amount_ugx: weekly, period: 'week', quote_on_request: false }
    : { key, page, placement, format, amount_ugx: null, period: 'week', quote_on_request: true }));

  // "Prices include VAT". The non-English lines need native review.
  const VAT_LABELS = {
    en: 'Prices include VAT',
    lg: 'Ebisale bitwaliddemu VAT',
    sw: 'Bei zinajumuisha VAT',
    ac: 'Wel ducu tye ki VAT iye',
    ny: 'Ebiciro nibitwariramu VAT',
    rn: 'Ebiciro nibitwariramu VAT',
    sm: 'Emiwendo giteekeddwamu VAT',
    am: 'ዋጋዎቹ ቫትን ያካትታሉ',
    ar: 'الأسعار تشمل ضريبة القيمة المضافة'
  };

  const PRICING = {
    version: 'rate-card-20261008',
    currency: 'UGX',
    vat: { included: true, label: VAT_LABELS.en, labels: VAT_LABELS, translations_need_native_review: true },
    private_listing: { amount_ugx: 20000, period: 'month', unit: 'property', months: 1, trial_days: 7 },
    agent_subscription: { amount_ugx: 50000, period: 'month', unit: 'agent', months: 1, includes: ['verified_badge', 'broker_profile'] },
    featured: { amount_ugx: 50000, period: '7 days', unit: 'listing', days: 7 },
    premium: { amount_ugx: 25000, period: '7 days', unit: 'listing', days: 7 },
    boosted: { amount_ugx: 25000, period: 'month', unit: 'listing', months: 1 },
    off_plan: { amount_ugx: 150000, period: 'project / 3 months', unit: 'project', months: 3 },
    short_stay_host: { amount_ugx: 50000, period: '3 months', unit: 'listing', months: 3 },
    market_report: { amount_ugx: 100000, period: 'report', unit: 'report' },
    agency_website: { amount_ugx: 200000, period: 'setup', unit: 'agency', monthly_amount_ugx: 100000 },
    professional_listing: { amount_ugx: 50000, period: 'property', unit: 'property' },
    display: {
      min_weekly_ugx: MIN_WEEKLY_UGX,
      max_weekly_ugx: MAX_WEEKLY_UGX,
      four_week_discount_percent: 10,
      four_week_discount_min_days: 28,
      placements,
      packages: advertisingPackageRows.map(([key, price_ugx, duration_days]) => ({ key, price_ugx, duration_days })),
      bands: advertisingBandRows.map(([key, weekly_price_ugx]) => ({ key, weekly_price_ugx }))
    },
    off_sale: {
      agent_pro_monthly: { status: 'retired', sellable: false },
      featured_lender_monthly: { status: 'retired', sellable: false },
      marketplace_verified: { amount_ugx: 150000, period: 'month', status: 'parked', active: false, sellable: false }
    }
  };

  const SELLABLE_KEYS = ['private_listing', 'agent_subscription', 'featured', 'premium', 'boosted', 'off_plan', 'short_stay_host', 'market_report', 'agency_website', 'professional_listing'];

  // Period wording per language. Untranslated languages fall back to English
  // rather than risk a wrong price line (all non-English need native review).
  const PERIOD_LABELS = {
    en: { month: 'month', '7 days': '7 days', 'project / 3 months': 'project / 3 months', '3 months': '3 months', report: 'report', setup: 'set-up', property: 'property', week: 'week' },
    lg: { month: 'omwezi', '7 days': 'ennaku 7', 'project / 3 months': 'pulojekiti / emyezi 3', '3 months': 'emyezi 3' },
    sw: { month: 'mwezi', '7 days': 'siku 7', 'project / 3 months': 'mradi / miezi 3', '3 months': 'miezi 3' }
  };
  const UNIT_PREFIX = {
    private_listing: 'property', boosted: 'listing', short_stay_host: 'listing'
  };

  function ugx(n) {
    const amount = Math.round(Number(n));
    if (!Number.isFinite(amount)) return '';
    return `UGX ${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }

  function lineFor(key) {
    if (PRICING[key] && SELLABLE_KEYS.includes(key)) return PRICING[key];
    return null;
  }

  function periodLabel(period, lang = 'en') {
    const table = PERIOD_LABELS[lang] || PERIOD_LABELS.en;
    return table[period] || PERIOD_LABELS.en[period] || period;
  }

  // "UGX 20,000 / property / month", "UGX 150,000 / project / 3 months".
  function priceLabel(key, lang = 'en') {
    const line = lineFor(key);
    if (!line) return '';
    const unit = UNIT_PREFIX[key];
    const period = periodLabel(line.period, lang);
    const parts = [ugx(line.amount_ugx)];
    if (unit && lang === 'en') parts.push(unit);
    parts.push(period);
    let label = parts.join(' / ');
    if (key === 'agency_website') label = `${ugx(line.amount_ugx)} ${periodLabel('setup', lang)} + ${ugx(line.monthly_amount_ugx)} / ${periodLabel('month', lang)}`;
    return label;
  }

  function isSellable(key) {
    if (PRICING.off_sale[key]) return false;
    return SELLABLE_KEYS.includes(key);
  }

  function vatLabel(lang = 'en') {
    return VAT_LABELS[lang] || VAT_LABELS.en;
  }

  // Weekly price of an ad package; null outside the display range.
  function weeklyDisplayPrice(priceUgx, durationDays) {
    const price = Number(priceUgx);
    const days = Number(durationDays);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(days) || days <= 0) return null;
    return price / (days / 7);
  }

  function isDisplayPriceInRange(priceUgx, durationDays) {
    return withinDisplayRange(weeklyDisplayPrice(priceUgx, durationDays));
  }

  // The display rule for one priced item: { price_ugx, weekly_price_ugx,
  // quote_on_request }. Outside 50,000–200,000 a week (or no weekly basis),
  // the price is null and the item is "Price on request".
  function displayOffer(priceUgx, durationDays) {
    const weekly = weeklyDisplayPrice(priceUgx, durationDays);
    if (weekly === null || !withinDisplayRange(weekly)) {
      return { price_ugx: null, weekly_price_ugx: null, quote_on_request: true };
    }
    return { price_ugx: Math.round(Number(priceUgx)), weekly_price_ugx: Math.round(weekly), quote_on_request: false };
  }

  function fourWeekDiscountUgx(subtotalUgx, durationDays) {
    if (Number(durationDays) < PRICING.display.four_week_discount_min_days) return 0;
    return Math.round(Number(subtotalUgx || 0) * PRICING.display.four_week_discount_percent / 100);
  }

  // The public price list (/api/pricing): sellable lines only, plus VAT and display.
  function publicPriceList() {
    const out = { version: PRICING.version, currency: PRICING.currency, vat: { included: true, label: PRICING.vat.label } };
    for (const key of SELLABLE_KEYS) out[key] = PRICING[key];
    const { min_weekly_ugx, max_weekly_ugx, four_week_discount_percent, four_week_discount_min_days, placements: weekly } = PRICING.display;
    out.display = { min_weekly_ugx, max_weekly_ugx, four_week_discount_percent, four_week_discount_min_days, placements: weekly };
    return out;
  }

  // Short text block for AI system prompts (sellable lines only).
  function aiPriceBlock() {
    return [
      'makaug prices (the only fees that exist; never quote any other fee or product):',
      `- Private listing: first ${PRICING.private_listing.trial_days} days free, then ${ugx(PRICING.private_listing.amount_ugx)} per property per month.`,
      `- Agent subscription: ${ugx(PRICING.agent_subscription.amount_ugx)} a month for all their listings, verified badge and broker profile included.`,
      `- Featured: ${ugx(PRICING.featured.amount_ugx)} for 7 days. Premium: ${ugx(PRICING.premium.amount_ugx)} for 7 days. Boosted: ${ugx(PRICING.boosted.amount_ugx)} per listing per month.`,
      `- Off-plan: ${ugx(PRICING.off_plan.amount_ugx)} per project per 3 months. Short-stay host: ${ugx(PRICING.short_stay_host.amount_ugx)} per listing per 3 months.`,
      `- Market Intelligence Report: ${ugx(PRICING.market_report.amount_ugx)}. Agency website: ${ugx(PRICING.agency_website.amount_ugx)} set-up + ${ugx(PRICING.agency_website.monthly_amount_ugx)} a month. Professional listing service: ${ugx(PRICING.professional_listing.amount_ugx)} per property.`,
      `- Display ads: ${ugx(MIN_WEEKLY_UGX)}–${ugx(MAX_WEEKLY_UGX)} per placement per week, ${PRICING.display.four_week_discount_percent}% off 4-week bookings; anything else is price on request.`,
      `- ${PRICING.vat.label}.`,
      '- Searching is free for everyone.'
    ].join('\n');
  }

  return freezeDeep({
    ...PRICING,
    SELLABLE_KEYS,
    ugx,
    priceLabel,
    periodLabel,
    isSellable,
    vatLabel,
    weeklyDisplayPrice,
    isDisplayPriceInRange,
    displayOffer,
    fourWeekDiscountUgx,
    publicPriceList,
    aiPriceBlock
  });
}));
