const COMMERCIAL_TRANSACTION_TYPES = Object.freeze(['rent', 'sale']);
const COMMERCIAL_PROPERTY_TYPES = Object.freeze([
  'office',
  'shop_retail',
  'warehouse_industrial',
  'commercial_land',
  'hospitality',
  'other'
]);

function compactText(...values) {
  return values
    .flat(Infinity)
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCommercialTransactionType(value, options = {}) {
  const explicit = compactText(value).toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    rent: 'rent',
    rental: 'rent',
    lease: 'rent',
    let: 'rent',
    to_let: 'rent',
    for_rent: 'rent',
    sale: 'sale',
    sell: 'sale',
    selling: 'sale',
    buy: 'sale',
    for_sale: 'sale'
  };
  if (aliases[explicit]) return aliases[explicit];

  const text = compactText(options.text, options.title, options.description).toLowerCase();
  if (/\b(for sale|on sale|available for sale|selling|purchase)\b/.test(text)) return 'sale';
  if (/\b(for rent|to rent|to let|for lease|available to rent|rental)\b/.test(text)) return 'rent';

  const period = compactText(options.pricePeriod, options.price_period).toLowerCase().replace(/[\s-]+/g, '_');
  if (['month', 'monthly', 'mo', 'per_month', 'week', 'weekly', 'per_week', 'night', 'daily'].includes(period)) return 'rent';
  if (['once', 'one_off', 'total', 'sale', 'cash', 'plot', 'acre'].includes(period)) return 'sale';
  return '';
}

function normalizeListingPricePeriod(value, options = {}) {
  const listingType = compactText(options.listingType, options.listing_type)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const text = compactText(options.text, options.title, options.description).toLowerCase();

  // Source wording is stronger evidence than a period guessed from the source
  // registry category. Check sale first because "rental property for sale"
  // describes an income-producing asset sale, not a monthly rental.
  if (/\b(for sale|on sale|available for sale|selling|purchase|asking price)\b/.test(text)) return 'once';
  if (/\b(for rent|to rent|to let|for lease|available to rent|monthly rent|per month)\b|\/(?:month|mo)\b/.test(text)) return 'month';

  const explicit = compactText(value).toLowerCase().replace(/[\s-]+/g, '_');
  const recurring = {
    month: 'month',
    monthly: 'month',
    mo: 'month',
    per_month: 'month',
    week: 'week',
    weekly: 'week',
    per_week: 'week',
    night: 'night',
    nightly: 'night',
    day: 'day',
    daily: 'day',
    semester: 'sem',
    sem: 'sem',
    term: 'sem'
  };
  const oneOff = {
    once: 'once',
    one_off: 'once',
    total: 'once',
    sale: 'once',
    cash: 'once',
    plot: 'once',
    acre: 'once'
  };
  if (recurring[explicit]) return recurring[explicit];
  if (oneOff[explicit]) return oneOff[explicit];
  if (listingType === 'sale' || listingType === 'land') return 'once';
  if (listingType === 'rent') return 'month';
  if (listingType === 'student' || listingType === 'students') return 'sem';
  return '';
}

function normalizeCommercialPropertyType(value, options = {}) {
  const explicit = compactText(value).toLowerCase().replace(/[\s/.-]+/g, '_');
  const aliases = {
    office: 'office',
    offices: 'office',
    office_space: 'office',
    retail: 'shop_retail',
    shop: 'shop_retail',
    shops: 'shop_retail',
    retail_shop: 'shop_retail',
    shop_retail: 'shop_retail',
    showroom: 'shop_retail',
    warehouse: 'warehouse_industrial',
    warehouses: 'warehouse_industrial',
    industrial: 'warehouse_industrial',
    industrial_space: 'warehouse_industrial',
    warehouse_industrial: 'warehouse_industrial',
    land: 'commercial_land',
    plot: 'commercial_land',
    commercial_plot: 'commercial_land',
    commercial_land: 'commercial_land',
    hospitality: 'hospitality',
    hotel: 'hospitality',
    leisure: 'hospitality',
    restaurant: 'hospitality',
    lodge: 'hospitality',
    other: 'other',
    commercial: 'other',
    commercial_space: 'other'
  };
  if (aliases[explicit]) return aliases[explicit];

  const text = compactText(value, options.text, options.title, options.description).toLowerCase();
  if (/\b(commercial land|commercial plot|land|plots?|acre|acres|decimal|decimals)\b/.test(text)) return 'commercial_land';
  if (/\b(warehouse|industrial|factory|workshop|storage|depot|logistics|distribution centre|distribution center)\b/.test(text)) return 'warehouse_industrial';
  if (/\b(office|business centre|business center|coworking|co-working)\b/.test(text)) return 'office';
  if (/\b(hotel|hospitality|restaurant|lodge|guest house|guesthouse|leisure|bar|resort)\b/.test(text)) return 'hospitality';
  if (/\b(shop|retail|showroom|mall|store|boutique|market stall)\b/.test(text)) return 'shop_retail';
  if (/\b(commercial|business premises|business space)\b/.test(text)) return 'other';
  return '';
}

function commercialMisclassificationWarning(record = {}) {
  const listingType = compactText(record.listing_type, record.listingType, record.type).toLowerCase();
  if (listingType !== 'commercial') return '';
  const text = compactText(
    record.title,
    record.description,
    record.caption,
    record.source_title,
    record.source_text,
    record.source_visual_text
  ).toLowerCase();
  const hasDwelling = /\b(house|home|apartment|flat|villa|mansion|bungalow|bedroom|bedrooms)\b/.test(text);
  const hasCommercialSignal = /\b(office|shop|retail|warehouse|industrial|factory|commercial|showroom|hotel|hospitality|restaurant|business premises)\b/.test(text);
  if (hasDwelling && !hasCommercialSignal) {
    return 'Possible residential listing classified as commercial; confirm category before approval.';
  }
  return '';
}

module.exports = {
  COMMERCIAL_TRANSACTION_TYPES,
  COMMERCIAL_PROPERTY_TYPES,
  normalizeCommercialTransactionType,
  normalizeListingPricePeriod,
  normalizeCommercialPropertyType,
  commercialMisclassificationWarning
};
