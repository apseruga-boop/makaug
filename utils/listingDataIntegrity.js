'use strict';

const {
  normalizeCommercialPropertyType,
  normalizeCommercialTransactionType,
  normalizeListingPricePeriod,
} = require('./commercialClassification');

const MAX_CANONICAL_PRICE_UGX = 100_000_000_000;
const MIN_WHOLE_PROPERTY_PRICE_UGX = 1_000_000;
const MIN_RECURRING_PRICE_UGX = 30_000;

const HOSPITALITY_PATTERN = /\b(?:air\s*&?\s*b(?:n|and)?\s*b|airbnb|short[-\s]*stay|short[-\s]*term\s+stay|per\s+night|nightly|bed\s*(?:and|&)\s*breakfast|booking\.com|holiday\s+home|vacation\s+rental|guest\s*house|guesthouse|hotel\s+room|lodge\s+room|resort\s+stay)\b/i;
const SPECIFIC_PROPERTY_PATTERN = /\b(?:bed(?:room)?s?|studio|bedsitter|house|home|apartment|flat|villa|bungalow|mansion|duplex|condo|townhouse|plot|plots|land|acre|acres|decimal|decimals|hostel|room|rooms|shop|office|warehouse|factory|arcade|showroom|commercial\s+(?:space|land|plot)|building)\b/i;
const DWELLING_PATTERN = /\b(?:bed(?:room)?s?|bath(?:room)?s?|house|home|apartment(?:\s+block)?|flat|villa|bungalow|mansion|duplex|condo|townhouse|residence|residential|self[-\s]*contained|rentals?|rental\s+units?)\b/i;
const STRONG_LAND_PATTERN = /\b(?:(?:prime|vacant|bare|titled)\s+land|(?:land|plots?|ettaka|kibanja|bibanja)\s+(?:is\s+)?(?:for|on)\s+sale|\d+(?:\.\d+)?\s*(?:acres?|decimals?|square\s+(?:miles?|kilomet(?:er|re)s?))(?:\s+of\s+land)?\s+(?:for|on)\s+sale|square\s+(?:miles?|kilomet(?:er|re)s?)\s+of\s+land)\b/i;
const LAND_PATTERN = /\b(?:land|plots?|acres?|decimals?|square\s+(?:miles?|kilomet(?:er|re)s?)(?:\s+of\s+land)?|bare[-\s]+land|ettaka|kibanja|bibanja)\b/i;
const COMMERCIAL_PATTERN = /\b(?:office|shop|retail|warehouse|industrial|factory|arcade|showroom|business\s+premises|commercial\s+(?:building|property|premises|space|land|plot))\b/i;
const STUDENT_PATTERN = /\b(?:student\s+(?:accommodation|hostel|room)|hostel\s+(?:room|bed|space)|campus|university|college|per\s+semester)\b/i;
const SALE_PATTERN = /\b(?:for\s+sale|on\s+sale|available\s+for\s+sale|selling|asking\s+price|guide\s+price|purchase\s+price)\b/i;
const DIRECT_RENT_PATTERN = /\b(?:for\s+rent|to\s+rent|to\s+let|for\s+lease|available\s+to\s+rent|monthly\s+rent)\b/i;
const PERIODIC_RENT_PATTERN = /(?:\bper\s+month\b|\/month\b|\/mo\b)/i;
const YIELD_PATTERN = /\b(?:monthly|rental)\s+income\b|\b(?:collects?|generates?|earns?|brings?|making)\b.{0,80}\b(?:income|monthly|per\s+month|\/month)\b/i;

function compact(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizedListingType(value = '') {
  const type = compact(value).toLowerCase().replace(/[\s-]+/g, '_');
  return type === 'students' ? 'student' : type;
}

function listingEvidenceText(record = {}) {
  const extra = object(record.extra_fields);
  const raw = object(extra.raw_source_post);
  return [
    record.title,
    record.description,
    record.caption,
    record.source_title,
    record.source_caption,
    record.source_text,
    record.source_visual_text,
    record.property_type,
    record.address,
    record.area,
    record.district,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.source_card_description,
    raw.title,
    raw.caption,
    raw.description,
    raw.source_text,
  ].map(compact).filter(Boolean).join(' ');
}

function primaryListingEvidenceText(record = {}) {
  const extra = object(record.extra_fields);
  const raw = object(extra.raw_source_post);
  return [
    record.title,
    record.source_title,
    record.caption,
    extra.source_title,
    extra.source_caption,
    raw.title,
    raw.caption,
  ].map(compact).filter(Boolean).join(' ');
}

function hasPriceOnApplication(record = {}) {
  const extra = object(record.extra_fields);
  return record.price_on_application === true
    || record.priceOnApplication === true
    || extra.price_on_application === true
    || extra.price_upon_application === true
    || /\b(?:price\s*)?(?:upon\s+application|on\s+request|poa)\b/i.test(compact(
      record.price_label || extra.price_label || extra.source_price_label
    ));
}

function hasContactPath(record = {}) {
  const extra = object(record.extra_fields);
  const raw = object(extra.raw_source_post);
  return Boolean([
    record.lister_phone,
    record.lister_email,
    record.contact_phone,
    record.phone,
    record.whatsapp,
    record.source_contact_url,
    record.source_url,
    extra.public_contact_phone,
    extra.contact_phone,
    extra.source_contact_url,
    extra.source_channel_url,
    extra.source_url,
    raw.contact_phone,
    raw.phone,
    raw.source_url,
  ].map(compact).find(Boolean));
}

function hasSpecificLocation(record = {}) {
  const extra = object(record.extra_fields);
  const canonicalLevel = compact(record.canonical_location_level || extra.canonical_location_level).toLowerCase();
  const canonicalId = compact(record.canonical_location_id || extra.canonical_location_id);
  if (canonicalId && canonicalLevel && !['district', 'region'].includes(canonicalLevel)) return true;
  const area = compact(record.area);
  const district = compact(record.district);
  return Boolean(area && district && area.toLowerCase() !== district.toLowerCase());
}

function deriveListingClassification(record = {}) {
  const text = listingEvidenceText(record);
  const primaryText = primaryListingEvidenceText(record) || text;
  const currentType = normalizedListingType(record.listing_type || record.listingType || record.category);
  const bedroomBathroomEvidence = Number(record.bedrooms || record.beds || 0) > 0
    || Number(record.bathrooms || record.baths || 0) > 0
    || /\b\d+\s*(?:bed(?:room)?s?|bath(?:room)?s?)\b/i.test(primaryText);
  const primaryDwelling = DWELLING_PATTERN.test(primaryText);
  const primaryCommercial = COMMERCIAL_PATTERN.test(primaryText);
  const primaryStrongLand = STRONG_LAND_PATTERN.test(primaryText);
  const hasDwelling = DWELLING_PATTERN.test(text) || bedroomBathroomEvidence;
  const hasCommercial = COMMERCIAL_PATTERN.test(text);
  const hasStrongLand = STRONG_LAND_PATTERN.test(text);
  const hasLand = LAND_PATTERN.test(text);
  const hasStudent = STUDENT_PATTERN.test(text);
  const explicitStudentAccommodation = /\b(?:student\s+(?:accommodation|hostel|room)|hostel\s+(?:room|bed|space)|per\s+semester)\b/i.test(text);
  const primarySale = SALE_PATTERN.test(primaryText);
  const primaryDirectRent = DIRECT_RENT_PATTERN.test(primaryText);
  const primaryPeriodicRent = PERIODIC_RENT_PATTERN.test(primaryText) && !YIELD_PATTERN.test(primaryText);
  const evidenceSale = SALE_PATTERN.test(text);
  const evidenceDirectRent = DIRECT_RENT_PATTERN.test(text);
  const evidencePeriodicRent = PERIODIC_RENT_PATTERN.test(text) && !YIELD_PATTERN.test(text);
  const hospitality = HOSPITALITY_PATTERN.test(text)
    || ['night', 'nightly', 'day', 'daily'].includes(compact(record.price_period || record.pricePeriod).toLowerCase());

  let transactionIntent = '';
  let categoryAmbiguous = false;
  let ambiguityReason = '';
  if (primarySale && primaryDirectRent) {
    categoryAmbiguous = true;
    ambiguityReason = 'Source title contains both sale and rent intent.';
  } else if (primarySale) {
    transactionIntent = 'sale';
  } else if (primaryDirectRent || primaryPeriodicRent) {
    transactionIntent = 'rent';
  } else if (evidenceSale && evidenceDirectRent) {
    categoryAmbiguous = true;
    ambiguityReason = 'Source evidence contains both sale and rent intent.';
  } else if (evidenceSale) {
    transactionIntent = 'sale';
  } else if (evidenceDirectRent || evidencePeriodicRent) {
    transactionIntent = 'rent';
  }

  let physicalType = '';
  if ((explicitStudentAccommodation || (currentType === 'student' && hasStudent)) && !evidenceSale) physicalType = 'student';
  else if (bedroomBathroomEvidence) physicalType = 'residential';
  else if (primaryStrongLand) physicalType = 'land';
  else if (primaryDwelling) physicalType = 'residential';
  else if (primaryCommercial) physicalType = 'commercial';
  else if (hasStrongLand) physicalType = 'land';
  else if (hasDwelling) physicalType = 'residential';
  else if (hasCommercial) physicalType = 'commercial';
  else if (hasLand) physicalType = 'land';

  let listingType = currentType;
  if (!categoryAmbiguous) {
    if (physicalType === 'student') listingType = 'student';
    else if (physicalType === 'land') listingType = 'land';
    else if (physicalType === 'commercial') listingType = 'commercial';
    else if (physicalType === 'residential' && transactionIntent) listingType = transactionIntent;
    else if (physicalType === 'residential' && !['sale', 'rent'].includes(currentType)) {
      categoryAmbiguous = true;
      ambiguityReason = 'Residential evidence has no clear sale or rent intent.';
      listingType = currentType;
    }
  }

  const transactionType = ['commercial', 'land'].includes(listingType)
    ? transactionIntent
      || normalizeCommercialTransactionType(record.transaction_type || record.transactionType)
      || (listingType === 'land' ? 'sale' : '')
    : '';
  const commercialType = listingType === 'commercial'
    ? normalizeCommercialPropertyType(record.property_type || record.commercial_type, { text })
    : '';
  const pricePeriod = normalizeListingPricePeriod('', {
    listingType,
    text,
  }) || (listingType === 'student' ? 'sem' : (listingType === 'rent' ? 'month' : 'once'));

  return {
    listing_type: listingType,
    transaction_type: transactionType || null,
    commercial_type: commercialType || null,
    price_period: pricePeriod,
    hospitality,
    has_specific_property: SPECIFIC_PROPERTY_PATTERN.test(text),
    explicit_sale: evidenceSale,
    explicit_rent: evidenceDirectRent || evidencePeriodicRent,
    transaction_intent: transactionIntent || null,
    physical_type: physicalType || null,
    category_ambiguous: categoryAmbiguous,
    ambiguity_reason: ambiguityReason || null,
    confidence: !categoryAmbiguous && listingType && physicalType && (transactionIntent || ['student', 'land', 'commercial'].includes(physicalType)) ? 'strong' : 'weak',
  };
}

function normalizedPeriod(record = {}) {
  return compact(record.price_period || record.pricePeriod || record.period)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function priceMatchesContact(record = {}, price = null) {
  if (!Number.isFinite(price) || price <= 0) return false;
  const priceDigits = String(Math.round(price));
  const extra = object(record.extra_fields);
  const evidence = listingEvidenceText(record);
  const contacts = [
    record.lister_phone,
    record.contact_phone,
    record.phone,
    record.whatsapp,
    extra.public_contact_phone,
    extra.contact_phone,
    ...(evidence.match(/(?:\+?256|0)?7\d{8}/g) || []),
  ].map((value) => String(value || '').replace(/\D/g, '')).filter(Boolean);
  return contacts.some((digits) => {
    const local = digits.replace(/^256/, '').replace(/^0/, '');
    return priceDigits === digits || priceDigits === local || priceDigits === `0${local}`;
  });
}

function listingDataIntegrityReport(record = {}, options = {}) {
  const category = normalizedListingType(record.listing_type || record.listingType || record.category);
  const classification = deriveListingClassification(record);
  const period = normalizedPeriod(record);
  const price = Number(record.price);
  const poa = hasPriceOnApplication(record);
  const transactionType = normalizeCommercialTransactionType(record.transaction_type || record.transactionType);
  const commercialType = normalizeCommercialPropertyType(record.property_type || record.commercial_type);
  const storedCurrency = compact(record.price_currency || object(record.extra_fields).price_currency || 'UGX').toUpperCase();
  const originalCurrency = compact(
    record.price_original_currency
      || object(record.extra_fields).price_original_currency
      || object(record.extra_fields).source_price_currency
      || (storedCurrency === 'USD' ? 'USD' : 'UGX')
  ).toUpperCase();
  const issues = [];
  const add = (code, message, details = {}) => issues.push({ code, message, ...details });

  if (classification.hospitality) {
    add('unsupported_hospitality_or_nightly', 'Nightly, Airbnb, short-stay, hotel-room and hospitality inventory is not supported.');
  }
  if (options.requireCompleteEvidence === true && !classification.has_specific_property) {
    add('not_a_specific_property_listing', 'A specific property type or asset is required.');
  }
  if (options.requireCompleteEvidence === true && !hasSpecificLocation(record)) {
    add('missing_specific_canonical_location', 'A specific canonical area is required; district-only locations remain in review.');
  }
  if (options.requireCompleteEvidence === true && !hasContactPath(record)) {
    add('missing_public_contact_path', 'A phone, email, or exact public source/contact route is required.');
  }

  if ((!Number.isFinite(price) || price <= 0) && !poa) {
    add('missing_price_without_poa', 'A positive canonical price or explicit Price on application flag is required.');
  }
  if (Number.isFinite(price) && price > 0 && poa) {
    add('price_and_poa_conflict', 'A listing cannot carry both a numeric price and Price on application.');
  }
  if (Number.isFinite(price) && price > MAX_CANONICAL_PRICE_UGX) {
    add('price_above_100bn_ugx', 'Canonical UGX price exceeds the 100 billion integrity clamp.');
  }
  if (priceMatchesContact(record, price)) {
    add('phone_number_stored_as_price', 'The stored price matches a captured contact number.');
  }
  if (Number.isFinite(price) && price > 0) {
    const commercialSale = category === 'commercial' && (transactionType === 'sale' || classification.transaction_type === 'sale');
    if ((['sale', 'land'].includes(category) || commercialSale) && price < MIN_WHOLE_PROPERTY_PRICE_UGX) {
      add('whole_property_price_below_1m', 'Whole-property sale/land prices below UGX 1,000,000 require review.');
    }
    if (['rent', 'student'].includes(category) && price < MIN_RECURRING_PRICE_UGX) {
      add('recurring_price_below_30k', 'Recurring residential/student prices below UGX 30,000 require review.');
    }
  }

  if (storedCurrency !== 'UGX') {
    add('canonical_price_currency_not_ugx', 'The stored canonical price is UGX, so price_currency must be UGX.');
  }
  if (originalCurrency === 'USD') {
    const original = Number(record.price_original ?? object(record.extra_fields).price_original);
    const rate = Number(record.price_fx_rate_ugx ?? object(record.extra_fields).price_fx_rate_ugx);
    if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(rate) || rate <= 0) {
      add('usd_source_provenance_incomplete', 'USD source amount and FX rate are required.');
    } else if (Number.isFinite(price) && price > 0) {
      const expected = Math.round(original * rate);
      const drift = Math.abs(price - expected) / Math.max(price, expected);
      if (drift > 0.01) add('usd_fx_magnitude_mismatch', 'Canonical UGX price does not match source USD amount multiplied by the stored FX rate.', { expected_price_ugx: expected });
    }
  }

  if (classification.category_ambiguous) {
    add('category_ambiguous', classification.ambiguity_reason || 'Category evidence is contradictory or incomplete.', {
      proposed_listing_type: category || classification.listing_type,
    });
  } else if (classification.confidence === 'strong' && classification.listing_type && category && classification.listing_type !== category) {
    add('category_conflicts_with_source_evidence', `Source evidence indicates ${classification.listing_type}, not ${category}.`, {
      proposed_listing_type: classification.listing_type,
    });
  }
  if (['land'].includes(category) && Number(record.bedrooms || 0) > 0) {
    add('bedrooms_on_land_category', 'Land listings cannot carry residential bedroom counts.');
  }
  if (category === 'commercial' && ['commercial_land', 'office', 'warehouse_industrial'].includes(commercialType) && Number(record.bedrooms || 0) > 0) {
    add('bedrooms_on_non_residential_commercial_category', 'Commercial land, office and warehouse listings cannot carry residential bedroom counts.');
  }

  const allowedPeriods = {
    sale: new Set(['once', 'one_off', 'total', 'sale', 'cash']),
    land: new Set(['once', 'one_off', 'total', 'sale', 'cash']),
    rent: new Set(['month', 'monthly', 'mo', 'per_month']),
    student: new Set(['month', 'monthly', 'mo', 'per_month', 'sem', 'semester', 'term']),
  };
  if (allowedPeriods[category] && period && !allowedPeriods[category].has(period)) {
    add('price_period_conflicts_with_category', `${category} listings cannot use the ${period} price period.`, {
      proposed_price_period: classification.price_period,
    });
  }
  if (category === 'commercial') {
    const effectiveTransaction = transactionType || classification.transaction_type;
    if (effectiveTransaction === 'sale' && period && !allowedPeriods.sale.has(period)) {
      add('commercial_sale_period_conflict', 'Commercial sales require a one-off price period.', { proposed_price_period: 'once' });
    }
    if (effectiveTransaction === 'rent' && period && !allowedPeriods.rent.has(period)) {
      add('commercial_rent_period_conflict', 'Commercial rentals require a monthly price period.', { proposed_price_period: 'month' });
    }
    if (!commercialType) add('commercial_subtype_missing', 'Commercial listings require a canonical subtype.');
    if (!effectiveTransaction) add('commercial_transaction_missing', 'Commercial listings require rent or sale.');
  }
  if (classification.explicit_sale && transactionType === 'rent') {
    add('transaction_conflicts_with_sale_evidence', 'Stored transaction is rent but source evidence says for sale.', { proposed_transaction_type: 'sale' });
  }
  if (classification.explicit_rent && !classification.explicit_sale && transactionType === 'sale') {
    add('transaction_conflicts_with_rent_evidence', 'Stored transaction is sale but source evidence says for rent.', { proposed_transaction_type: 'rent' });
  }

  return {
    ok: issues.length === 0,
    marker: 'master-data-integrity-116',
    issues,
    issue_codes: issues.map((issue) => issue.code),
    price_on_application: poa,
    canonical_price_currency: storedCurrency,
    original_price_currency: originalCurrency,
    classification,
  };
}

module.exports = {
  HOSPITALITY_PATTERN,
  MAX_CANONICAL_PRICE_UGX,
  MIN_RECURRING_PRICE_UGX,
  MIN_WHOLE_PROPERTY_PRICE_UGX,
  deriveListingClassification,
  hasContactPath,
  hasPriceOnApplication,
  hasSpecificLocation,
  listingDataIntegrityReport,
  listingEvidenceText,
  normalizedListingType,
};
