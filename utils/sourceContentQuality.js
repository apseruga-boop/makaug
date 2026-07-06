'use strict';

const NON_LISTING_SOURCE_PATTERN = /\b(?:dawinci|da\s*winci|sameblood)\b/i;
const HARD_NON_LISTING_PATTERN = /\b(?:how\s+to\s+apply|how\s+big\s+is|building\s+permit|building\s+regulations?|bio(?:de)?g[ie]ster|biodigester|plumbing|pipe\s*work|pipework|material\s+costs?|cost\s+breakdown|roofing\s+materials?|perimeter\s+fence|land\s+title\s+transfer|documents?\s+needed|penthouse\s+design|house\s+design|house\s+plan|(?:plot|land)\s+(?:sizes?|dimensions?|measurements?)|(?:plot|land)\s+measurements?|\d+\s*ft\s*(?:by|x)\s*\d+\s*ft|construction\s+(?:tips?|ideas?|costs?|materials?))\b/i;
const SOURCE_BOUND_NON_LISTING_PATTERN = /\b(?:house\s+reveal|building\s+nice\s+houses?|design\s+and\s+construction|construction\s+clip|construction\s+video|building\s+process|site\s+visit)\b/i;
const EXPLICIT_LISTING_INTENT_PATTERN = /\b(?:for\s+sale|on\s+sale|for\s+rent|to\s+rent|to\s+let|rent\s+to\s+own|rent-to-own|available\s+(?:for\s+)?(?:sale|rent|lease)|selling|asking\s+price|guide\s+price|price\s*:|land\s+for\s+sale|plots?\s+for\s+sale|house\s+for\s+sale|home\s+for\s+sale|apartment\s+for\s+sale|apartment\s+for\s+rent|office\s+space\s+for\s+rent|shop\s+for\s+rent|student\s+(?:room|hostel|accommodation))\b/i;
const MONEY_SIGNAL_PATTERN = /\b(?:ugx|ush|shs?|usd|\$)\s*[\d,.]+|[\d,.]+\s*(?:m|mn|million|b|bn|billion)\b/i;

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function jsonText(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return '';
  }
}

function sourceQualityText(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  return [
    record.title,
    record.sourceTitle,
    record.source_title,
    record.caption,
    record.description,
    record.sourceText,
    record.source_text,
    record.sourceVisualText,
    record.source_visual_text,
    record.lister_name,
    record.source_name,
    record.sourceAgentName,
    record.source_agent_name,
    record.channel_name,
    record.source,
    record.listed_via,
    record.source_platform,
    extra.source_name,
    extra.source_agent_name,
    extra.public_display_name,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.youtube_source_title,
    jsonText(extra.raw_source_post),
  ].map(compactText).filter(Boolean).join(' ');
}

function sourceNameText(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  return [
    record.source_name,
    record.sourceAgentName,
    record.source_agent_name,
    record.lister_name,
    record.channel_name,
    extra.source_name,
    extra.source_agent_name,
    extra.public_display_name,
    extra.youtube_channel_title,
  ].map(compactText).filter(Boolean).join(' ');
}

function sourceQualitySuppressionForRecord(record = {}) {
  const text = sourceQualityText(record);
  const sourceText = sourceNameText(record);
  const hasExplicitListingIntent = EXPLICIT_LISTING_INTENT_PATTERN.test(text);
  const hasMoneySignal = MONEY_SIGNAL_PATTERN.test(text);
  const hardMatch = text.match(HARD_NON_LISTING_PATTERN);
  const sourceBoundMatch = text.match(SOURCE_BOUND_NON_LISTING_PATTERN);
  const knownNonListingSource = NON_LISTING_SOURCE_PATTERN.test(sourceText || text);

  if (hardMatch && !hasExplicitListingIntent) {
    return {
      suppressed: true,
      reason: 'non_listing_tutorial_or_construction_content',
      matched: hardMatch[0],
      known_non_listing_source: knownNonListingSource,
      listing_signal: hasMoneySignal ? 'price_signal_ignored_for_tutorial_content' : 'no_listing_intent',
    };
  }

  if (knownNonListingSource && sourceBoundMatch && !hasExplicitListingIntent) {
    return {
      suppressed: true,
      reason: 'non_listing_design_or_construction_showcase',
      matched: sourceBoundMatch[0],
      known_non_listing_source: true,
      listing_signal: hasMoneySignal ? 'price_signal_ignored_for_showcase_content' : 'no_listing_intent',
    };
  }

  if (knownNonListingSource && hardMatch) {
    return {
      suppressed: true,
      reason: 'known_non_listing_source_tutorial_content',
      matched: hardMatch[0],
      known_non_listing_source: true,
      listing_signal: hasExplicitListingIntent ? 'explicit_listing_intent_present_but_source_keyword_is_blocked' : 'no_listing_intent',
    };
  }

  return {
    suppressed: false,
    reason: '',
    matched: '',
    known_non_listing_source: knownNonListingSource,
    listing_signal: hasExplicitListingIntent || hasMoneySignal ? 'listing_signal_present' : '',
  };
}

function sqlTextExpression(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  // Keep staff dashboard SQL cheap. The richer JS classifier still inspects long
  // source/OCR text at import time, but live queue counts must avoid scanning
  // large JSON text fields for every pending row on every dashboard hydrate.
  return `CONCAT_WS(' ',
    COALESCE(${prefix}title, ''),
    COALESCE(${prefix}lister_name, ''),
    COALESCE(${prefix}source, ''),
    COALESCE(${prefix}listed_via, ''),
    COALESCE(${prefix}extra_fields->>'source_name', ''),
    COALESCE(${prefix}extra_fields->>'source_agent_name', ''),
    COALESCE(${prefix}extra_fields->>'public_display_name', ''),
    COALESCE(${prefix}extra_fields->>'youtube_channel_title', ''),
    COALESCE(${prefix}extra_fields->>'source_title', ''),
    COALESCE(${prefix}extra_fields->>'source_caption', ''),
    COALESCE(${prefix}extra_fields->>'youtube_source_title', '')
  )`;
}

function sqlSourceExpression(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `CONCAT_WS(' ',
    COALESCE(${prefix}lister_name, ''),
    COALESCE(${prefix}source, ''),
    COALESCE(${prefix}listed_via, ''),
    COALESCE(${prefix}extra_fields->>'source_name', ''),
    COALESCE(${prefix}extra_fields->>'source_agent_name', ''),
    COALESCE(${prefix}extra_fields->>'public_display_name', ''),
    COALESCE(${prefix}extra_fields->>'youtube_channel_title', '')
  )`;
}

function sourceQualitySuppressedSql(alias = 'p') {
  const text = sqlTextExpression(alias);
  const source = sqlSourceExpression(alias);
  const hard = "(how[[:space:]]+to[[:space:]]+apply|how[[:space:]]+big[[:space:]]+is|building[[:space:]]+permit|building[[:space:]]+regulations?|bio(de)?g[ie]ster|biodigester|plumbing|pipe[[:space:]]*work|pipework|material[[:space:]]+costs?|cost[[:space:]]+breakdown|roofing[[:space:]]+materials?|perimeter[[:space:]]+fence|land[[:space:]]+title[[:space:]]+transfer|documents?[[:space:]]+needed|penthouse[[:space:]]+design|house[[:space:]]+design|house[[:space:]]+plan|(plot|land)[[:space:]]+(size|sizes|dimensions?|measurements?)|(plot|land)[[:space:]]+measurements?|[0-9]+[[:space:]]*ft[[:space:]]*(by|x)[[:space:]]*[0-9]+[[:space:]]*ft|construction[[:space:]]+(tips?|ideas?|costs?|materials?))";
  const sourceBound = "(house[[:space:]]+reveal|building[[:space:]]+nice[[:space:]]+houses?|design[[:space:]]+and[[:space:]]+construction|construction[[:space:]]+clip|construction[[:space:]]+video|building[[:space:]]+process|site[[:space:]]+visit)";
  const explicit = "(for[[:space:]]+sale|on[[:space:]]+sale|for[[:space:]]+rent|to[[:space:]]+rent|to[[:space:]]+let|rent[[:space:]]+to[[:space:]]+own|rent-to-own|available[[:space:]]+(for[[:space:]]+)?(sale|rent|lease)|selling|asking[[:space:]]+price|guide[[:space:]]+price|price[[:space:]]*:|land[[:space:]]+for[[:space:]]+sale|plots?[[:space:]]+for[[:space:]]+sale|house[[:space:]]+for[[:space:]]+sale|home[[:space:]]+for[[:space:]]+sale|apartment[[:space:]]+for[[:space:]]+sale|apartment[[:space:]]+for[[:space:]]+rent|office[[:space:]]+space[[:space:]]+for[[:space:]]+rent|shop[[:space:]]+for[[:space:]]+rent|student[[:space:]]+(room|hostel|accommodation))";
  const knownSource = "(dawinci|da[[:space:]]*winci|sameblood)";
  return `(
    (${text} ~* '${hard}' AND ${text} !~* '${explicit}')
    OR (${source} ~* '${knownSource}' AND ${text} ~* '${sourceBound}' AND ${text} !~* '${explicit}')
    OR (${source} ~* '${knownSource}' AND ${text} ~* '${hard}')
  )`;
}

module.exports = {
  sourceQualitySuppressionForRecord,
  sourceQualitySuppressedSql,
};
