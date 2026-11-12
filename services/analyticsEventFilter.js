'use strict';

// What counts as a real listing view for agent reports.
// Staff previews, owner previews and obvious bots are recorded but excluded.
// Events saved before these flags existed have no payload markers, so they
// still count — we do not invent a drop in historical numbers.

const PUBLIC_VIEWER = 'public';
const STAFF_VIEWER = 'staff';
const OWNER_PREVIEW_VIEWER = 'owner_preview';
const VIEWER_KINDS = new Set([PUBLIC_VIEWER, STAFF_VIEWER, OWNER_PREVIEW_VIEWER]);

// Conservative: only strings that are almost never a real buyer's browser.
const BOT_UA_RE = /(?:bot|crawler|spider|crawling|slurp|headless|phantomjs|puppeteer|playwright|selenium|scrapy|wget|curl\/|python-requests|go-http-client|libwww|okhttp|bytespider|petalbot|semrush|ahrefs|dotbot|ia_archiver|facebookexternalhit|meta-externalagent|twitterbot|linkedinbot|slackbot|discordbot|yandexbot|baiduspider|applebot|bingpreview)/i;

function viewerKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return VIEWER_KINDS.has(kind) ? kind : PUBLIC_VIEWER;
}

function isTruthyFlag(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function isLikelyBotUserAgent(userAgent) {
  const ua = String(userAgent || '').trim();
  if (!ua) return false;
  return BOT_UA_RE.test(ua);
}

function isLikelyBotRequest(req = {}, params = {}) {
  if (isTruthyFlag(params.is_bot)) return true;
  const headers = req && typeof req.get === 'function'
    ? (name) => req.get(name)
    : (name) => (req.headers || {})[String(name).toLowerCase()];
  const ua = (headers && (headers('user-agent') || headers('User-Agent'))) || params.user_agent || '';
  if (isLikelyBotUserAgent(ua)) return true;
  const verified = String((headers && (headers('cf-verified-bot') || headers('Cf-Verified-Bot'))) || '').toLowerCase();
  if (verified === 'true' || verified === '1') return true;
  const scoreRaw = headers && (headers('cf-bot-score') || headers('Cf-Bot-Score'));
  const score = Number(scoreRaw);
  if (Number.isFinite(score) && score > 0 && score < 30) return true;
  return false;
}

function annotateEventPayload(params = {}, req = {}) {
  const payload = { ...(params && typeof params === 'object' ? params : {}) };
  payload.viewer_kind = viewerKind(payload.viewer_kind);
  if (isLikelyBotRequest(req, payload)) payload.is_bot = true;
  else delete payload.is_bot;
  return payload;
}

function isCountableListingView(payload = {}) {
  const kind = viewerKind(payload.viewer_kind);
  if (kind !== PUBLIC_VIEWER) return false;
  if (isTruthyFlag(payload.is_bot)) return false;
  return true;
}

// Same rule as isCountableListingView, for analytics_events payload JSON.
// Missing flags (legacy rows) are treated as public, non-bot.
function countableListingViewSql(alias = 'e') {
  const p = `${alias}.payload`;
  return `COALESCE(${p}->>'viewer_kind', 'public') = 'public'
    AND COALESCE(${p}->>'is_bot', 'false') NOT IN ('true', '1', 'yes')`;
}

module.exports = {
  BOT_UA_RE,
  OWNER_PREVIEW_VIEWER,
  PUBLIC_VIEWER,
  STAFF_VIEWER,
  annotateEventPayload,
  countableListingViewSql,
  isCountableListingView,
  isLikelyBotRequest,
  isLikelyBotUserAgent,
  viewerKind
};
