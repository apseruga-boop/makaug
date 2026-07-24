const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const {
  TIKTOK_AUTH_URL,
  TIKTOK_DISPLAY_MARKER,
  resolveTikTokDisplayConfig,
  encryptSecret,
  decryptSecret,
  exchangeAuthorizationCode,
  refreshAccessToken,
  fetchTikTokProfile,
  fetchTikTokVideos,
  tokenExpiryDate
} = require('../services/tiktokDisplayService');

const router = express.Router();
const STATE_COOKIE = 'makaug_tiktok_oauth_state';
const CONNECTION_COOKIE = 'makaug_tiktok_connection';

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function clean(value = '') {
  return String(value || '').trim();
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index < 1) return cookies;
      const key = part.slice(0, index);
      const value = part.slice(index + 1);
      try {
        cookies[key] = decodeURIComponent(value);
      } catch (_) {
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/api/tiktok-display'
  };
}

function clearTikTokCookies(res) {
  res.clearCookie(STATE_COOKIE, cookieOptions(0));
  res.clearCookie(CONNECTION_COOKIE, cookieOptions(0));
}

function signState(nonce) {
  return jwt.sign(
    { purpose: 'tiktok_display_oauth', nonce },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function verifyState(state, nonce) {
  const decoded = jwt.verify(state, process.env.JWT_SECRET);
  if (decoded?.purpose !== 'tiktok_display_oauth' || !nonce || decoded?.nonce !== nonce) {
    throw new Error('TikTok authorization state did not match');
  }
  return decoded;
}

function signConnection(connectionId) {
  return jwt.sign(
    { purpose: 'tiktok_display_connection', connection_id: connectionId },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function connectionIdFromRequest(req) {
  const token = clean(parseCookies(req)[CONNECTION_COOKIE]);
  if (!token) return '';
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.purpose === 'tiktok_display_connection'
      ? clean(decoded.connection_id)
      : '';
  } catch (_) {
    return '';
  }
}

function redirectWithTikTokState(config, state, message = '') {
  const url = new URL('/tiktok-connect', config.publicBaseUrl);
  url.searchParams.set('tiktok', state);
  if (message) url.searchParams.set('message', message);
  return url.toString();
}

async function upsertConnection({ token, profile }) {
  const connectionId = crypto.randomUUID();
  const accessExpiresAt = tokenExpiryDate(token.expires_in);
  const refreshExpiresAt = tokenExpiryDate(token.refresh_expires_in);
  const result = await db.query(
    `INSERT INTO tiktok_display_connections (
       id,
       open_id,
       display_name,
       avatar_url,
       profile_deep_link,
       scope,
       access_token_encrypted,
       refresh_token_encrypted,
       access_token_expires_at,
       refresh_token_expires_at,
       created_at,
       updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
     ON CONFLICT (open_id)
     DO UPDATE SET
       id = EXCLUDED.id,
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       profile_deep_link = EXCLUDED.profile_deep_link,
       scope = EXCLUDED.scope,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
       updated_at = NOW()
     RETURNING *`,
    [
      connectionId,
      clean(profile.open_id || token.open_id),
      clean(profile.display_name),
      clean(profile.avatar_url),
      clean(profile.profile_deep_link),
      clean(token.scope),
      encryptSecret(token.access_token),
      encryptSecret(token.refresh_token),
      accessExpiresAt,
      refreshExpiresAt
    ]
  );
  return result.rows[0];
}

async function getConnection(connectionId) {
  if (!connectionId) return null;
  const result = await db.query(
    `SELECT *
     FROM tiktok_display_connections
     WHERE id = $1
     LIMIT 1`,
    [connectionId]
  );
  return result.rows[0] || null;
}

async function activeAccessToken(connection, config) {
  const expiresAt = connection?.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(connection.access_token_encrypted);
  }

  const refreshToken = decryptSecret(connection.refresh_token_encrypted);
  if (!refreshToken) throw new Error('TikTok authorization has expired');
  const refreshed = await refreshAccessToken({ refreshToken, config });
  const accessToken = clean(refreshed.access_token);
  if (!accessToken) throw new Error('TikTok did not return a refreshed access token');
  await db.query(
    `UPDATE tiktok_display_connections
     SET access_token_encrypted = $2,
         refresh_token_encrypted = COALESCE(NULLIF($3, ''), refresh_token_encrypted),
         access_token_expires_at = $4,
         refresh_token_expires_at = COALESCE($5, refresh_token_expires_at),
         scope = COALESCE(NULLIF($6, ''), scope),
         updated_at = NOW()
     WHERE id = $1`,
    [
      connection.id,
      encryptSecret(accessToken),
      encryptSecret(refreshed.refresh_token),
      tokenExpiryDate(refreshed.expires_in),
      tokenExpiryDate(refreshed.refresh_expires_in),
      clean(refreshed.scope)
    ]
  );
  return accessToken;
}

router.get('/config', (_req, res) => {
  const config = resolveTikTokDisplayConfig();
  return res.json({
    ok: true,
    data: {
      configured: config.configured,
      mode: config.mode,
      scopes: config.scopes,
      redirect_uri: config.redirectUri,
      marker: TIKTOK_DISPLAY_MARKER
    }
  });
});

router.get('/start', (req, res) => {
  const config = resolveTikTokDisplayConfig();
  if (!config.configured) {
    return res.redirect(redirectWithTikTokState(config, 'error', 'TikTok connection is not configured yet.'));
  }
  const nonce = crypto.randomBytes(24).toString('base64url');
  const state = signState(nonce);
  res.cookie(STATE_COOKIE, nonce, cookieOptions(10 * 60 * 1000));
  const params = new URLSearchParams({
    client_key: config.clientKey,
    scope: config.scopes.join(','),
    response_type: 'code',
    redirect_uri: config.redirectUri,
    state,
    disable_auto_auth: '1'
  });
  return res.redirect(`${TIKTOK_AUTH_URL}?${params.toString()}`);
});

router.get('/callback', async (req, res) => {
  const config = resolveTikTokDisplayConfig();
  try {
    const code = clean(req.query.code);
    const state = clean(req.query.state);
    const nonce = clean(parseCookies(req)[STATE_COOKIE]);
    if (!code || !state) throw new Error('TikTok did not return an authorization code');
    verifyState(state, nonce);
    const token = await exchangeAuthorizationCode({ code, config });
    if (!clean(token.access_token)) throw new Error('TikTok did not return an access token');
    const profile = await fetchTikTokProfile(token.access_token);
    const connection = await upsertConnection({ token, profile });
    res.clearCookie(STATE_COOKIE, cookieOptions(0));
    res.cookie(CONNECTION_COOKIE, signConnection(connection.id), cookieOptions(30 * 24 * 60 * 60 * 1000));
    return res.redirect(redirectWithTikTokState(config, 'connected'));
  } catch (error) {
    logger.error('TikTok Display API callback failed', error.message);
    clearTikTokCookies(res);
    return res.redirect(redirectWithTikTokState(config, 'error', 'TikTok authorization could not be completed.'));
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const config = resolveTikTokDisplayConfig();
    const connection = await getConnection(connectionIdFromRequest(req));
    if (!connection) {
      return res.json({
        ok: true,
        data: {
          connected: false,
          configured: config.configured,
          mode: config.mode,
          marker: TIKTOK_DISPLAY_MARKER
        }
      });
    }
    const accessToken = await activeAccessToken(connection, config);
    const result = await fetchTikTokVideos(accessToken);
    return res.json({
      ok: true,
      data: {
        connected: true,
        configured: true,
        mode: config.mode,
        marker: TIKTOK_DISPLAY_MARKER,
        profile: {
          display_name: connection.display_name || '',
          avatar_url: connection.avatar_url || '',
          profile_deep_link: connection.profile_deep_link || ''
        },
        videos: result.videos,
        has_more: result.hasMore,
        cursor: result.cursor
      }
    });
  } catch (error) {
    if (/expired|invalid|authorization/i.test(error.message || '')) {
      clearTikTokCookies(res);
      return res.status(401).json({
        ok: false,
        error: 'TikTok authorization has expired. Connect TikTok again.'
      });
    }
    return next(error);
  }
});

router.post('/disconnect', async (req, res, next) => {
  try {
    const connectionId = connectionIdFromRequest(req);
    if (connectionId) {
      await db.query('DELETE FROM tiktok_display_connections WHERE id = $1', [connectionId]);
    }
    clearTikTokCookies(res);
    return res.json({ ok: true, data: { disconnected: true } });
  } catch (error) {
    return next(error);
  }
});

router._test = {
  parseCookies,
  signState,
  verifyState,
  signConnection
};

module.exports = router;
