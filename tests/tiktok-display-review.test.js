'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  TIKTOK_DISPLAY_MARKER,
  resolveTikTokDisplayConfig,
  encryptSecret,
  decryptSecret
} = require('../services/tiktokDisplayService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const frontend = read('assets/makaug-app.js');
const route = read('routes/tiktok-display.js');
const server = read('server.js');
const tiktokService = read('services/tiktokDisplayService.js');
const publicHtmlSanitizer = read('services/publicHtmlSanitizer.js');
const migration = read('db/migrations/090_tiktok_display_connections.sql');
const envExample = read('.env.example');

assert.strictEqual(TIKTOK_DISPLAY_MARKER, 'tiktok-display-review-20260725');

const config = resolveTikTokDisplayConfig({
  TIKTOK_DISPLAY_MODE: 'sandbox',
  TIKTOK_SANDBOX_CLIENT_KEY: 'sandbox-key',
  TIKTOK_SANDBOX_CLIENT_SECRET: 'sandbox-secret',
  TIKTOK_CLIENT_KEY: 'production-key',
  TIKTOK_CLIENT_SECRET: 'production-secret',
  JWT_SECRET: 'jwt-secret',
  PUBLIC_BASE_URL: 'https://makaug.com/'
});
assert.strictEqual(config.mode, 'sandbox');
assert.strictEqual(config.clientKey, 'sandbox-key');
assert.strictEqual(config.clientSecret, 'sandbox-secret');
assert.strictEqual(config.redirectUri, 'https://makaug.com/api/tiktok-display/callback');
assert.deepStrictEqual(config.scopes, ['user.info.basic', 'video.list']);
assert.strictEqual(config.configured, true);

const tokenEnv = {
  TIKTOK_TOKEN_ENCRYPTION_KEY: 'test-encryption-secret'
};
const encrypted = encryptSecret('tiktok-access-token', tokenEnv);
assert.notStrictEqual(encrypted, 'tiktok-access-token');
assert(!encrypted.includes('tiktok-access-token'));
assert.strictEqual(decryptSecret(encrypted, tokenEnv), 'tiktok-access-token');

assert(server.includes("app.use('/api/tiktok-display', tiktokDisplayRoutes)"));
assert(tiktokService.includes("'open_id,union_id,avatar_url,display_name'"));
assert(!tiktokService.includes("'open_id,avatar_url,display_name,profile_deep_link'"));
assert(route.includes("purpose: 'tiktok_display_oauth'"));
assert(route.includes("res.set('Cache-Control', 'no-store')"));
assert(route.includes('disable_auto_auth'));
assert(route.includes("res.cookie(CONNECTION_COOKIE"));
assert(route.includes("DELETE FROM tiktok_display_connections"));
assert(!route.includes('access_token: connection'));
assert(!route.includes('refresh_token: connection'));

assert(migration.includes('CREATE TABLE IF NOT EXISTS tiktok_display_connections'));
assert(migration.includes('access_token_encrypted TEXT NOT NULL'));
assert(migration.includes('refresh_token_encrypted TEXT'));
assert(envExample.includes('TIKTOK_DISPLAY_MODE=sandbox'));
assert(envExample.includes('TIKTOK_SANDBOX_CLIENT_KEY='));
assert(envExample.includes('TIKTOK_TOKEN_ENCRYPTION_KEY='));

assert(html.includes('data-tiktok-display-marker="tiktok-display-review-20260725"'));
assert(html.includes('href="/api/tiktok-display/start"'));
assert(html.includes('id="tiktok-display-videos"'));
assert(html.includes('href="/privacy-policy"'));
assert(html.includes('href="/terms"'));
assert(html.includes('id="footer-link-tiktok"'));

assert(frontend.includes('async function initializeTikTokDisplayPage()'));
assert(frontend.includes('async function disconnectTikTokDisplay()'));
assert(frontend.includes('"tiktok-connect": "/tiktok-connect"'));
assert(frontend.includes('get("video_url")'));
assert(frontend.includes('user.info.basic'));
assert(frontend.includes('video.list'));
assert(frontend.includes('OAuth tokens are encrypted at rest'));
assert(frontend.includes('deleted immediately when the user disconnects'));
assert(!frontend.includes('Legal review note:'));
assert(publicHtmlSanitizer.includes("'page-tiktok-connect'"));
assert(publicHtmlSanitizer.includes("'/tiktok-connect': ['page-tiktok-connect']"));
assert(publicHtmlSanitizer.includes('TikTok Login Kit and Display API'));
assert(publicHtmlSanitizer.includes('TikTok security, control, and retention'));
assert(publicHtmlSanitizer.includes('user.info.basic'));
assert(publicHtmlSanitizer.includes('video.list'));
assert(!publicHtmlSanitizer.includes("eyebrow: 'Legal review required'"));

console.log('ok - TikTok sandbox Login Kit and Display API review flow is wired, encrypted, and disclosed');
