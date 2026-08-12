const APPROVED_SOURCE_VERIFICATION_STATUSES = new Set([
  'official_api_verified',
  'official_oembed_verified',
  'registry_verified',
  'manual_source_verified',
  'verified_public_source',
]);

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function textValue(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function nestedSourceRecord(item = {}) {
  const raw = item.raw_source_post || item.rawSourcePost || {};
  return {
    raw,
    nested: raw.raw_source_post || raw.rawSourcePost || {},
  };
}

function sourceVerificationFor(item = {}) {
  const { raw, nested } = nestedSourceRecord(item);
  const status = textValue(
    item.sourceVerificationStatus,
    item.source_verification_status,
    raw.source_verification_status,
    raw.sourceVerificationStatus,
    nested.source_verification_status,
    nested.sourceVerificationStatus,
  ).toLowerCase();
  const explicitlyVerified = [
    item.sourceVerified,
    item.source_verified,
    raw.source_verified,
    raw.sourceVerified,
    nested.source_verified,
    nested.sourceVerified,
  ].some((value) => value === true);
  const verified = explicitlyVerified || APPROVED_SOURCE_VERIFICATION_STATUSES.has(status);
  return {
    verified,
    status: status || (verified ? 'verified_public_source' : 'unverified_source'),
  };
}

function titleQualityFor(item = {}) {
  const title = textValue(item.title, item.sourceTitle, item.source_title);
  const plain = title
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const generic = /^(?:property|listing|home|house|land|apartment|flat)(?:\s+(?:for\s+)?(?:sale|rent))?(?:\s+in)?$/i.test(plain)
    || /^(?:property|listing)\s+(?:for\s+(?:sale|rent)\s+)?in\s+/i.test(plain);
  return {
    valid: plain.length >= 12 && !generic,
    title,
    normalized_length: plain.length,
  };
}

function categoryQualityFor(item = {}, intake = {}) {
  const integrity = item.dataIntegrity || item.data_integrity || intake.data_integrity || {};
  const issueCodes = Array.isArray(integrity.issue_codes) ? integrity.issue_codes : [];
  const category = textValue(item.listingType, item.listing_type, integrity.classification?.listing_type);
  const confidence = textValue(
    item.categoryConfidence,
    item.category_confidence,
    integrity.classification?.confidence,
  ).toLowerCase();
  return {
    valid: Boolean(category)
      && confidence === 'strong'
      && !issueCodes.includes('category_ambiguous')
      && !issueCodes.includes('category_conflicts_with_source_evidence'),
    category,
    confidence: confidence || 'unknown',
  };
}

function locationQualityFor(item = {}, intake = {}) {
  const canonicalId = textValue(item.canonicalLocationId, item.canonical_location_id);
  const level = textValue(item.canonicalLocationLevel, item.canonical_location_level).toLowerCase();
  const confidence = Number(item.locationResolutionConfidence ?? item.location_resolution_confidence ?? 0);
  const exactStatus = textValue(item.locationResolutionStatus, item.location_resolution_status).toLowerCase();
  const exact = Boolean(
    canonicalId
      && ['city', 'suburb'].includes(level)
      && (confidence === 1 || exactStatus === 'canonical_match')
      && intake.complete_location !== false
  );
  return { exact, canonical_id: canonicalId, level, confidence };
}

function priceQualityFor(item = {}) {
  const price = Number(item.price || 0);
  const currency = textValue(item.priceCurrency, item.price_currency, 'ZAR').toUpperCase();
  const priceOnApplication = item.priceOnApplication === true || item.price_on_application === true;
  return {
    valid: Number.isFinite(price) && price > 0 && currency === 'ZAR' && !priceOnApplication,
    price,
    currency,
    price_on_application: priceOnApplication,
  };
}

function dedupeQualityFor(item = {}, context = {}) {
  const passed = context.dedupePassed === true
    || item.autoPublishDedupePassed === true
    || item.auto_publish_dedupe_passed === true;
  return { passed, status: passed ? 'unique' : 'dedupe_not_proven' };
}

function evaluateSouthAfricaAutoPublish(item = {}, { intake = {}, dedupePassed = false } = {}) {
  const source = sourceVerificationFor(item);
  const title = titleQualityFor(item);
  const category = categoryQualityFor(item, intake);
  const location = locationQualityFor(item, intake);
  const price = priceQualityFor(item);
  const dedupe = dedupeQualityFor(item, { dedupePassed });
  const riskFlags = [
    ...(Array.isArray(item.risk_flags) ? item.risk_flags : []),
    ...(Array.isArray(item.dataIntegrity?.issue_codes) ? item.dataIntegrity.issue_codes : []),
    ...(Array.isArray(intake.data_integrity?.issue_codes) ? intake.data_integrity.issue_codes : []),
  ].filter(Boolean);
  const blockers = [
    !source.verified ? 'source_not_verified' : '',
    !location.exact ? 'location_not_exact' : '',
    !price.valid ? (price.price_on_application ? 'price_on_application' : 'invalid_or_missing_zar_price') : '',
    !category.valid ? 'category_not_confident' : '',
    !title.valid ? 'junk_or_generic_title' : '',
    !dedupe.passed ? 'duplicate_check_not_passed' : '',
    riskFlags.length ? 'risk_flag_present' : '',
    intake.eligible === false ? 'intake_gate_failed' : '',
  ].filter(Boolean);
  const eligible = blockers.length === 0;
  const enabled = envFlagEnabled(process.env.ZA_CONFIDENCE_AUTO_PUBLISH_ENABLED);
  return {
    eligible,
    enabled,
    approved: eligible && enabled,
    target_auto_publish_rate: 0.8,
    policy: 'za_confidence_auto_publish_v1',
    reason: eligible
      ? (enabled
        ? 'All exactness, price, category, title, duplicate, source-verification, and risk gates passed.'
        : 'Eligible for automatic publication, but ZA_CONFIDENCE_AUTO_PUBLISH_ENABLED is off.')
      : `Human review required: ${blockers.join(', ')}.`,
    blockers,
    checks: { source, location, price, category, title, dedupe, risk_flags: riskFlags },
  };
}

module.exports = {
  APPROVED_SOURCE_VERIFICATION_STATUSES,
  envFlagEnabled,
  evaluateSouthAfricaAutoPublish,
  sourceVerificationFor,
};
