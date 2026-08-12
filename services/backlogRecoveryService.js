'use strict';

const { deriveListingClassification, listingDataIntegrityReport } = require('../utils/listingDataIntegrity');
const { detectPropertyTypeEvidence } = require('../utils/propertyTypeVocabulary');
const { resolveCanonicalUgandaLocationFromText } = require('../utils/ugandaLocationRegistry');
const { regionForDistrict } = require('../utils/ugandaLocationHierarchy');

const RECOVERY_MARKER = 'uganda-review-recovery-proposals-20260811';
const PENDING_STATUSES = new Set(['pending', 'submitted', 'source_review', 'review_queue', 'pending_review', 'in_review', 'under_review', 'needs_more_details', 'held', 'resubmitted']);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compact(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sourceEvidenceText(record = {}) {
  const extra = object(record.extra_fields);
  const raw = object(extra.raw_source_post);
  return [
    record.source_title, record.caption, record.source_caption, record.source_text,
    record.source_visual_text, record.description, record.title,
    extra.source_title, extra.source_caption, extra.caption, extra.source_description,
    extra.source_text, extra.source_visual_text, extra.video_text, extra.video_ocr_text,
    extra.image_text, extra.image_ocr_text, raw.title, raw.caption, raw.description, raw.source_text,
  ].map(compact).filter(Boolean).join(' ');
}

function normalizeAmount(numberText = '', suffix = '') {
  const value = Number(String(numberText).replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = /^(?:k|thousand)$/i.test(suffix) ? 1_000
    : /^(?:m|mill|million)$/i.test(suffix) ? 1_000_000
      : /^(?:bn|billion|b)$/i.test(suffix) ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

function extractPriceProposal(record = {}) {
  const text = sourceEvidenceText(record);
  const candidates = [];
  const pattern = /(?:\b(UGX|UShs?|Shs?|Sh|USD|US\$|\$|dollars?)\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k|m|mill|million|thousand|bn|billion|b)?\s*(\/=|\/\-)?(?=\s|[.,;]|$)/gi;
  for (const match of text.matchAll(pattern)) {
    const currencyToken = compact(match[1]).toUpperCase();
    const suffix = compact(match[3]).toLowerCase();
    const around = text.slice(Math.max(0, match.index - 18), Math.min(text.length, match.index + match[0].length + 22));
    const hasCurrency = Boolean(currencyToken) || Boolean(match[4]);
    const hasMagnitude = Boolean(suffix);
    const hasPriceCue = /\b(?:price|asking|rent|sale|cost|ugx|ush|usd|dollars?)\b|\$/i.test(around);
    if (!hasCurrency && !hasMagnitude && !hasPriceCue) continue;
    if (/\b(?:call|tel|phone|whatsapp)\b/i.test(around) && !hasCurrency && !hasMagnitude) continue;
    const originalCurrency = /USD|US\$|\$|DOLLARS?/.test(currencyToken) ? 'USD' : 'UGX';
    const originalAmount = normalizeAmount(match[2], suffix);
    if (!originalAmount || (originalCurrency === 'UGX' ? originalAmount < 1_000 : originalAmount < 10)) continue;
    const existingRate = Number(record.price_fx_rate_ugx ?? object(record.extra_fields).price_fx_rate_ugx);
    const canonicalPrice = originalCurrency === 'USD'
      ? (Number.isFinite(existingRate) && existingRate > 0 ? Math.round(originalAmount * existingRate) : null)
      : originalAmount;
    candidates.push({ original_amount: originalAmount, original_currency: originalCurrency, fx_rate_ugx: originalCurrency === 'USD' ? existingRate || null : null, price_ugx: canonicalPrice, evidence: compact(around) });
  }
  const unique = Array.from(new Map(candidates.map((item) => [`${item.original_currency}:${item.original_amount}`, item])).values());
  if (!unique.length) return { status: 'unmatched', proposal: null, reason: 'No source-backed price found.' };
  if (unique.length > 1) return { status: 'manual_review', proposal: null, candidates: unique.slice(0, 8), reason: 'Multiple distinct source-backed prices found.' };
  const proposal = unique[0];
  const saleIntent = /\b(?:for\s+sale|on\s+sale|selling|asking\s+price|purchase\s+price)\b/i.test(text);
  const monthlyIntent = /(?:\b(?:per|a)\s+month\b|\bp\.?m\.?\b|\/month\b|\/mo\b|\bmonthly\b)/i.test(text);
  const listingType = compact(record.listing_type).toLowerCase();
  const period = saleIntent ? 'once'
    : monthlyIntent ? 'month'
      : ['sale', 'land'].includes(listingType) ? 'once'
        : listingType === 'rent' ? 'month'
          : listingType === 'student' ? 'semester'
            : null;
  if (!period) {
    return { status: 'manual_review', proposal, reason: 'One price found but its payment period is ambiguous.' };
  }
  proposal.price_period = period;
  if (proposal.original_currency === 'USD' && !proposal.price_ugx) {
    return { status: 'manual_review', proposal, reason: 'USD amount found but no stored listing FX rate is available; no exchange rate was invented.' };
  }
  return { status: 'proposed', proposal, reason: 'One source-backed price found.' };
}

function extractLocationProposal(record = {}) {
  const text = sourceEvidenceText(record);
  const districtHint = compact(record.district);
  const resolution = resolveCanonicalUgandaLocationFromText(text, districtHint);
  if (resolution.status === 'matched' && resolution.confidence === 1 && resolution.match) {
    const match = resolution.match;
    return {
      status: 'proposed',
      proposal: {
        canonical_location_id: match.key,
        canonical_location_level: match.level,
        area: match.name,
        neighborhood: match.level === 'district' ? null : match.name,
        city: match.town || match.name,
        district: match.district,
        region: match.region || regionForDistrict(match.district),
        latitude: match.lat ?? null,
        longitude: match.lng ?? null,
        district_only: match.level === 'district',
      },
      reason: 'Exact shared-registry match from source evidence.',
    };
  }
  if (resolution.status === 'ambiguous') {
    return { status: 'manual_review', proposal: null, candidates: resolution.candidates, reason: 'Source location name is ambiguous across canonical parents.' };
  }
  return { status: 'unmatched', proposal: null, reason: 'No exact shared-registry location found; fuzzy guessing is disabled.' };
}

function cleanSourceTitle(value = '') {
  return compact(String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#\S+/g, ' ')
    .replace(/(?:\+?256|0)7\d(?:[\s().-]*\d){7,9}/g, ' ')
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2,}/gu, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\b(?:fyp|viral|trending|ugandatiktok(?:ers)?)\b/gi, ' ')
    .replace(/\b(?:call|contact|whatsapp)\s+(?:now|us|me|today)\b/gi, ' ')
    .replace(/([!?.,])\1+/g, '$1')
    .replace(/[|•]+/g, ' '));
}

function titleLooksLikeJunk(value = '') {
  const clean = compact(value);
  if (!clean) return true;
  const hashtagCount = (clean.match(/#/g) || []).length;
  const phoneCount = (clean.match(/(?:\+?256|0)7\d(?:[\s().-]*\d){7,9}/g) || []).length;
  return hashtagCount >= 2 || phoneCount > 0 || clean.length > 140 || cleanSourceTitle(clean).length < 8;
}

function titleProposal(record = {}, classification = {}) {
  const current = compact(record.title);
  if (current && !titleLooksLikeJunk(current)) return { status: 'not_needed', proposal: current, reason: 'Stored title is already clean.' };
  const location = compact(record.area) || compact(record.district);
  const physical = classification.property_type || detectPropertyTypeEvidence(sourceEvidenceText(record)).property_type || 'property';
  const intent = classification.listing_type === 'rent' ? 'for rent'
    : classification.listing_type === 'sale' ? 'for sale'
      : classification.listing_type === 'land' ? 'for sale'
        : classification.listing_type === 'student' ? 'for student accommodation'
          : 'available';
  const bedrooms = Number(record.bedrooms) > 0 ? `${Number(record.bedrooms)}-bedroom ` : '';
  const proposal = `${bedrooms}${physical.charAt(0).toUpperCase()}${physical.slice(1)} ${intent}${location ? ` in ${location}` : ''}`;
  return { status: 'proposed', proposal: cleanSourceTitle(proposal), reason: 'Generated from recognized physical type, transaction and stored canonical location.' };
}

function recordBuckets(record = {}) {
  const report = listingDataIntegrityReport(record);
  const codes = new Set(report.issue_codes || []);
  return {
    missing_price: (!Number.isFinite(Number(record.price)) || Number(record.price) <= 0) && !report.price_on_application,
    missing_location: !compact(record.canonical_location_id || object(record.extra_fields).canonical_location_id) || !compact(record.area) || !compact(record.district),
    junk_title: titleLooksLikeJunk(record.title),
    category_ambiguous: codes.has('category_ambiguous') || codes.has('category_conflicts_with_source_evidence'),
    district_only: compact(record.canonical_location_level || object(record.extra_fields).canonical_location_level).toLowerCase() === 'district'
      || (compact(record.area) && compact(record.area).toLowerCase() === compact(record.district).toLowerCase()),
    student: compact(record.listing_type).toLowerCase() === 'student',
  };
}

function buildBacklogRecoveryProposal(record = {}, options = {}) {
  const status = compact(record.status).toLowerCase();
  const buckets = recordBuckets(record);
  const classification = deriveListingClassification(record);
  const proposal = {
    marker: RECOVERY_MARKER,
    listing_id: record.id || null,
    current_status: status,
    generated_at: options.generatedAt || new Date().toISOString(),
    buckets,
    protected: !PENDING_STATUSES.has(status),
    student_excluded: buckets.student,
    district_only_policy: options.districtOnlyPolicy === 'release' ? 'release' : 'hold',
    price: extractPriceProposal(record),
    location: extractLocationProposal(record),
    title: titleProposal(record, classification),
    classification: {
      status: classification.category_ambiguous ? 'manual_review' : 'proposed',
      proposal: {
        listing_type: classification.listing_type,
        property_type: classification.property_type,
        transaction_type: classification.transaction_type,
        price_period: classification.price_period,
      },
      reason: classification.ambiguity_reason || 'Shared classifier found consistent source evidence.',
      source_evidence: classification.source_evidence,
    },
  };
  proposal.eligible_for_proposal_storage = !proposal.protected && !proposal.student_excluded
    && !(buckets.district_only && proposal.district_only_policy === 'hold');
  proposal.never_auto_publish = true;
  return proposal;
}

function recountBacklog(rows = []) {
  const pending = rows.filter((row) => PENDING_STATUSES.has(compact(row.status).toLowerCase()));
  const counts = { total_pending: pending.length, missing_price: 0, missing_location: 0, junk_title: 0, category_ambiguous: 0, district_only: 0, student_manual_only: 0 };
  const overlap = {};
  pending.forEach((row) => {
    const buckets = recordBuckets(row);
    const names = Object.entries(buckets).filter(([, value]) => value).map(([name]) => name).sort();
    if (buckets.missing_price) counts.missing_price += 1;
    if (buckets.missing_location) counts.missing_location += 1;
    if (buckets.junk_title) counts.junk_title += 1;
    if (buckets.category_ambiguous) counts.category_ambiguous += 1;
    if (buckets.district_only) counts.district_only += 1;
    if (buckets.student) counts.student_manual_only += 1;
    overlap[names.join('+') || 'none'] = (overlap[names.join('+') || 'none'] || 0) + 1;
  });
  return { marker: RECOVERY_MARKER, counts, overlap, protected_statuses_excluded: true, students_excluded_from_automation: true };
}

module.exports = {
  PENDING_STATUSES,
  RECOVERY_MARKER,
  buildBacklogRecoveryProposal,
  cleanSourceTitle,
  extractLocationProposal,
  extractPriceProposal,
  recountBacklog,
  recordBuckets,
  sourceEvidenceText,
  titleLooksLikeJunk,
};
