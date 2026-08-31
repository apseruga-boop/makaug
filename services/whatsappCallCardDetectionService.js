'use strict';

// Keep these patterns deliberately narrow. Generic labels such as "Voice call"
// also appear on WhatsApp's fixed header buttons and must never turn an ordinary
// authored message into a call event.
const MISSED_CALL_TEXT_PATTERN_SOURCE = String.raw`\b(?:missed\s+(?:voice|video)\s+call|(?:voice|video)\s+call(?:\s*[•·,:—-]\s*|\s+)(?:no answer|unanswered|declined|rejected|not answered))\b`;
const MISSED_CALL_MARKER_PATTERN_SOURCE = String.raw`(?:^|[-_:])(?:call[-_:]?(?:missed|unanswered|declined|rejected)|missed[-_:]?(?:voice|video)?[-_:]?call)(?:$|[-_:])`;

function matchesMissedCallSystemText(value = '') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return new RegExp(MISSED_CALL_TEXT_PATTERN_SOURCE, 'i').test(normalized);
}

function hasMissedCallSemanticMarker(values = []) {
  const list = Array.isArray(values) ? values : [values];
  const pattern = new RegExp(MISSED_CALL_MARKER_PATTERN_SOURCE, 'i');
  return list.some((value) => pattern.test(String(value || '').trim()));
}

function isWhatsappMissedCallCard({
  text = '',
  semanticMarkers = [],
  hasAuthoredMessage = false,
  direction = 'unknown'
} = {}) {
  if (hasAuthoredMessage) return false;
  if (String(direction || '').trim().toLowerCase() === 'out') return false;
  return matchesMissedCallSystemText(text) || hasMissedCallSemanticMarker(semanticMarkers);
}

function whatsappCallCardBrowserConfig() {
  return {
    textPatternSource: MISSED_CALL_TEXT_PATTERN_SOURCE,
    markerPatternSource: MISSED_CALL_MARKER_PATTERN_SOURCE
  };
}

module.exports = {
  MISSED_CALL_TEXT_PATTERN_SOURCE,
  MISSED_CALL_MARKER_PATTERN_SOURCE,
  matchesMissedCallSystemText,
  hasMissedCallSemanticMarker,
  isWhatsappMissedCallCard,
  whatsappCallCardBrowserConfig
};
