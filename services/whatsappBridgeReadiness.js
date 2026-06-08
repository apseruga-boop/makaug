'use strict';

const DEFAULT_FRESH_SECONDS = 180;
const HOSTED_SIGNAL_RE = /render|hosted|docker|background[-_ ]?worker|prod|production/i;
const SECRET_KEY_RE = /(token|secret|password|credential|cookie|session|auth|key)/i;

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase();
}

function isTruthyValue(value) {
  return ['1', 'true', 'yes', 'on', 'hosted', 'render', 'production'].includes(normalizeStatus(value));
}

function parseMaybeJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeTimestampMs(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeBridgeClient(client = {}) {
  const metadata = parseMaybeJsonObject(client.metadata);
  const stats = parseMaybeJsonObject(client.stats);
  return {
    ...client,
    stats,
    metadata,
    status: normalizeStatus(client.status),
    client_id: normalizeText(client.client_id || client.clientId),
    operator_name: normalizeText(client.operator_name || client.operatorName),
    browser_name: normalizeText(client.browser_name || client.browserName),
    profile_dir: normalizeText(client.profile_dir || client.profileDir || metadata.profile_dir),
    last_error: normalizeText(client.last_error || client.lastError),
    last_seen_ms: normalizeTimestampMs(client.last_seen_at || client.lastSeenAt),
    updated_ms: normalizeTimestampMs(client.updated_at || client.updatedAt)
  };
}

function isFreshBridgeClient(client, nowMs = Date.now(), freshSeconds = DEFAULT_FRESH_SECONDS) {
  const normalized = normalizeBridgeClient(client);
  if (!normalized.last_seen_ms) return false;
  return nowMs - normalized.last_seen_ms <= freshSeconds * 1000;
}

function isHostedWhatsappBridgeClient(client = {}) {
  const normalized = normalizeBridgeClient(client);
  const metadata = parseMaybeJsonObject(normalized.metadata);
  if (
    isTruthyValue(metadata.hosted) ||
    isTruthyValue(metadata.is_hosted) ||
    isTruthyValue(metadata.render) ||
    isTruthyValue(metadata.production)
  ) {
    return true;
  }

  if (normalized.profile_dir.startsWith('/var/data')) return true;

  const signals = [
    normalized.client_id,
    normalized.operator_name,
    normalized.browser_name,
    normalized.profile_dir,
    metadata.source,
    metadata.runtime,
    metadata.deploy_target,
    metadata.environment,
    metadata.render_service_id,
    metadata.render_service_name,
    metadata.render_instance_id,
    metadata.render_external_hostname,
    metadata.worker_name,
    metadata.service_name
  ].map(normalizeText).filter(Boolean);

  return signals.some((signal) => HOSTED_SIGNAL_RE.test(signal));
}

function getBridgeReadinessBlocker(client = {}) {
  const normalized = normalizeBridgeClient(client);
  if (!normalized.status) return 'status_missing';
  if (normalized.status !== 'online') return `status_${normalized.status.replace(/[^a-z0-9]+/g, '_')}`;
  if (normalized.last_error) return 'last_error_reported';

  const metadata = parseMaybeJsonObject(normalized.metadata);
  const readyState = parseMaybeJsonObject(metadata.ready_state || metadata.readyState);
  if (readyState.databaseError || metadata.phase === 'browser_database_error') return 'browser_database_error';
  if (readyState.openElsewhere) return 'open_elsewhere';
  if (readyState.waitingForLogin || readyState.loginPrompt) return 'waiting_for_login';

  const phase = normalizeStatus(metadata.phase || metadata.note || metadata.status);
  if (/database|login|open_elsewhere|error|degraded|offline|browser/.test(phase)) {
    return phase.replace(/[^a-z0-9]+/g, '_');
  }

  return '';
}

function sanitizeObject(value, depth = 0) {
  if (depth > 3) return {};
  const object = parseMaybeJsonObject(value);
  const safe = {};
  for (const [key, rawValue] of Object.entries(object)) {
    if (SECRET_KEY_RE.test(key)) continue;
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      safe[key] = sanitizeObject(rawValue, depth + 1);
    } else if (Array.isArray(rawValue)) {
      safe[key] = rawValue.slice(0, 10).map((item) => (
        item && typeof item === 'object' ? sanitizeObject(item, depth + 1) : item
      ));
    } else {
      safe[key] = rawValue;
    }
  }
  return safe;
}

function summarizeWhatsappBridgeClient(client = {}) {
  const normalized = normalizeBridgeClient(client);
  return {
    client_id: normalized.client_id || null,
    operator_name: normalized.operator_name || null,
    status: normalized.status || null,
    browser_name: normalized.browser_name || null,
    profile_dir: normalized.profile_dir || null,
    current_url: normalized.current_url || normalized.currentUrl || null,
    active_chat_key: normalized.active_chat_key || normalized.activeChatKey || null,
    unread_count: Math.max(0, Number(normalized.unread_count ?? normalized.unreadCount ?? 0) || 0),
    last_error: normalized.last_error || null,
    metadata: sanitizeObject(normalized.metadata),
    last_seen_at: normalized.last_seen_at || normalized.lastSeenAt || null,
    updated_at: normalized.updated_at || normalized.updatedAt || null,
    hosted: isHostedWhatsappBridgeClient(normalized)
  };
}

function evaluateHostedWhatsappBridgeReadiness(clients = [], options = {}) {
  const nowMs = normalizeTimestampMs(options.now) || Date.now();
  const freshSeconds = Math.max(
    30,
    Number(options.freshSeconds || options.fresh_seconds || DEFAULT_FRESH_SECONDS) || DEFAULT_FRESH_SECONDS
  );
  const normalizedClients = (Array.isArray(clients) ? clients : []).map(normalizeBridgeClient);
  const hostedClients = normalizedClients.filter(isHostedWhatsappBridgeClient);
  const freshHostedClients = hostedClients.filter((client) => isFreshBridgeClient(client, nowMs, freshSeconds));
  const readyHostedClients = freshHostedClients.filter((client) => (
    normalizeStatus(client.status) === 'online' && !getBridgeReadinessBlocker(client)
  ));
  const localOnlineClients = normalizedClients.filter((client) => (
    !isHostedWhatsappBridgeClient(client) &&
    isFreshBridgeClient(client, nowMs, freshSeconds) &&
    normalizeStatus(client.status) === 'online'
  ));

  let ok = false;
  let status = 'offline';
  let reason = 'no_bridge_clients_seen';
  let selectedClient = null;

  if (readyHostedClients.length > 0) {
    ok = true;
    status = 'ready';
    reason = 'hosted_agent_online';
    selectedClient = readyHostedClients[0];
  } else if (freshHostedClients.length > 0) {
    status = 'blocked';
    reason = getBridgeReadinessBlocker(freshHostedClients[0]) || 'hosted_agent_not_ready';
    selectedClient = freshHostedClients[0];
  } else if (hostedClients.length > 0) {
    status = 'stale';
    reason = 'hosted_agent_stale_or_not_heartbeating';
    selectedClient = hostedClients[0];
  } else if (localOnlineClients.length > 0) {
    status = 'local_only';
    reason = 'only_local_laptop_bridge_is_online';
    selectedClient = localOnlineClients[0];
  }

  return {
    ok,
    status,
    reason,
    checked_at: new Date(nowMs).toISOString(),
    fresh_seconds: freshSeconds,
    total_clients: normalizedClients.length,
    hosted_seen_count: hostedClients.length,
    hosted_fresh_count: freshHostedClients.length,
    hosted_online_count: readyHostedClients.length,
    local_online_count: localOnlineClients.length,
    selected_client: selectedClient ? summarizeWhatsappBridgeClient(selectedClient) : null
  };
}

module.exports = {
  DEFAULT_FRESH_SECONDS,
  evaluateHostedWhatsappBridgeReadiness,
  getBridgeReadinessBlocker,
  isFreshBridgeClient,
  isHostedWhatsappBridgeClient,
  summarizeWhatsappBridgeClient
};
