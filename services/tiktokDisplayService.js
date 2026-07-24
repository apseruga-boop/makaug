const crypto = require('crypto');

const TIKTOK_DISPLAY_MARKER = 'tiktok-display-review-20260725';
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const TIKTOK_VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const TIKTOK_DISPLAY_SCOPES = ['user.info.basic', 'video.list'];

function clean(value = '') {
  return String(value || '').trim();
}

function resolveTikTokDisplayConfig(env = process.env) {
  const mode = clean(env.TIKTOK_DISPLAY_MODE || 'sandbox').toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
  const sandboxClientKey = clean(env.TIKTOK_SANDBOX_CLIENT_KEY);
  const sandboxClientSecret = clean(env.TIKTOK_SANDBOX_CLIENT_SECRET);
  const productionClientKey = clean(env.TIKTOK_CLIENT_KEY);
  const productionClientSecret = clean(env.TIKTOK_CLIENT_SECRET);
  const clientKey = mode === 'sandbox'
    ? sandboxClientKey || productionClientKey
    : productionClientKey;
  const clientSecret = mode === 'sandbox'
    ? sandboxClientSecret || productionClientSecret
    : productionClientSecret;
  const publicBaseUrl = clean(env.PUBLIC_BASE_URL || env.APP_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');

  return {
    mode,
    clientKey,
    clientSecret,
    publicBaseUrl,
    redirectUri: `${publicBaseUrl}/api/tiktok-display/callback`,
    scopes: TIKTOK_DISPLAY_SCOPES,
    configured: Boolean(clientKey && clientSecret && clean(env.JWT_SECRET)),
    marker: TIKTOK_DISPLAY_MARKER
  };
}

function encryptionSecret(env = process.env) {
  const secret = clean(env.TIKTOK_TOKEN_ENCRYPTION_KEY || env.JWT_SECRET);
  if (!secret) throw new Error('TikTok token encryption is not configured');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(value, env = process.env) {
  const plaintext = clean(value);
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionSecret(env), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value, env = process.env) {
  const encryptedValue = clean(value);
  if (!encryptedValue) return '';
  const [ivPart, tagPart, encryptedPart] = encryptedValue.split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Invalid encrypted TikTok token');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionSecret(env),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

async function fetchTikTokJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  const providerError = data?.error;
  if (!response.ok || (providerError && providerError.code && providerError.code !== 'ok')) {
    const message = providerError?.message
      || data?.error_description
      || data?.message
      || `TikTok request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.providerCode = providerError?.code || '';
    throw error;
  }
  return data;
}

async function exchangeAuthorizationCode({ code, config, fetchImpl = fetch }) {
  return fetchTikTokJson(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri
    })
  }, fetchImpl);
}

async function refreshAccessToken({ refreshToken, config, fetchImpl = fetch }) {
  return fetchTikTokJson(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  }, fetchImpl);
}

async function fetchTikTokProfile(accessToken, fetchImpl = fetch) {
  const endpoint = new URL(TIKTOK_USER_INFO_URL);
  endpoint.searchParams.set('fields', 'open_id,union_id,avatar_url,display_name');
  const data = await fetchTikTokJson(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, fetchImpl);
  return data?.data?.user || {};
}

async function fetchTikTokVideos(accessToken, fetchImpl = fetch) {
  const endpoint = new URL(TIKTOK_VIDEO_LIST_URL);
  endpoint.searchParams.set(
    'fields',
    'id,title,video_description,duration,cover_image_url,embed_link,share_url,create_time'
  );
  const data = await fetchTikTokJson(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ max_count: 20 })
  }, fetchImpl);
  return {
    videos: Array.isArray(data?.data?.videos) ? data.data.videos : [],
    cursor: data?.data?.cursor || 0,
    hasMore: Boolean(data?.data?.has_more)
  };
}

function tokenExpiryDate(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(Date.now() + parsed * 1000);
}

module.exports = {
  TIKTOK_DISPLAY_MARKER,
  TIKTOK_AUTH_URL,
  TIKTOK_DISPLAY_SCOPES,
  resolveTikTokDisplayConfig,
  encryptSecret,
  decryptSecret,
  fetchTikTokJson,
  exchangeAuthorizationCode,
  refreshAccessToken,
  fetchTikTokProfile,
  fetchTikTokVideos,
  tokenExpiryDate
};
