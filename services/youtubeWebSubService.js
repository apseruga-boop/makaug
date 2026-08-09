'use strict';

const crypto = require('crypto');
const logger = require('../config/logger');

const YOUTUBE_WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/subscribe';
const YOUTUBE_FEED_BASE_URL = 'https://www.youtube.com/xml/feeds/videos.xml';
const DEFAULT_LEASE_SECONDS = 864000;

function clean(value = '') {
  return String(value || '').trim();
}

function callbackUrl(env = process.env) {
  const explicit = clean(env.YOUTUBE_WEBSUB_CALLBACK_URL);
  if (explicit) return explicit;
  const base = clean(env.PUBLIC_BASE_URL || env.APP_BASE_URL).replace(/\/+$/, '');
  return base ? `${base}/api/harvest/youtube/websub` : '';
}

function youtubeFeedTopic(channelId = '') {
  const id = clean(channelId);
  return id ? `${YOUTUBE_FEED_BASE_URL}?channel_id=${encodeURIComponent(id)}` : '';
}

function channelIdFromTopic(topic = '') {
  try {
    const parsed = new URL(topic);
    if (parsed.origin !== 'https://www.youtube.com' || parsed.pathname !== '/xml/feeds/videos.xml') return '';
    return clean(parsed.searchParams.get('channel_id'));
  } catch (_) {
    return '';
  }
}

function xmlEntityDecode(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlTag(xml = '', tag = '') {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? clean(xmlEntityDecode(match[1].replace(/<!\[CDATA\[|\]\]>/g, ''))) : '';
}

function parseYouTubeWebSubAtom(xml = '') {
  const body = String(xml || '');
  const entryMatch = body.match(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/i);
  const entry = entryMatch?.[1] || body;
  return {
    video_id: xmlTag(entry, 'yt:videoId'),
    channel_id: xmlTag(entry, 'yt:channelId'),
    title: xmlTag(entry, 'title'),
    published_at: xmlTag(entry, 'published'),
    updated_at: xmlTag(entry, 'updated'),
    author_name: xmlTag(entry, 'name'),
    deleted: /<at:deleted-entry\b/i.test(body),
  };
}

function webSubSignatureValid(rawBody, signature = '', secret = process.env.YOUTUBE_WEBSUB_SECRET || '') {
  const configuredSecret = clean(secret);
  if (!configuredSecret) return true;
  const [algorithm, supplied] = clean(signature).split('=', 2);
  if (!['sha1', 'sha256'].includes(algorithm) || !supplied) return false;
  const expected = crypto.createHmac(algorithm, configuredSecret).update(rawBody).digest('hex');
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(supplied, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function upsertYouTubeChannel(db, channel = {}) {
  const channelId = clean(channel.channel_id || channel.external_channel_id);
  if (!channelId || !db?.query) return null;
  const result = await db.query(
    `INSERT INTO property_harvest_channels (
       platform, source_key, display_name, profile_url, external_channel_id,
       subscription_status, last_ingested_at, newest_post_at, metadata
     ) VALUES ('youtube',$1,$2,$3,$1,$4,$5,$6,$7::jsonb)
     ON CONFLICT (platform, source_key) DO UPDATE
       SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), property_harvest_channels.display_name),
           profile_url = COALESCE(NULLIF(EXCLUDED.profile_url, ''), property_harvest_channels.profile_url),
           external_channel_id = EXCLUDED.external_channel_id,
           subscription_status = CASE
             WHEN property_harvest_channels.subscription_status = 'subscribed' THEN 'subscribed'
             ELSE EXCLUDED.subscription_status
           END,
           last_ingested_at = COALESCE(EXCLUDED.last_ingested_at, property_harvest_channels.last_ingested_at),
           newest_post_at = GREATEST(EXCLUDED.newest_post_at, property_harvest_channels.newest_post_at),
           metadata = property_harvest_channels.metadata || EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING *`,
    [
      channelId,
      clean(channel.display_name || channel.author_name),
      clean(channel.profile_url) || `https://www.youtube.com/channel/${channelId}`,
      clean(channel.subscription_status) || 'tracked',
      channel.last_ingested_at || null,
      channel.newest_post_at || null,
      JSON.stringify(channel.metadata || {}),
    ]
  );
  return result.rows[0] || null;
}

async function requestYouTubeWebSubSubscription(db, channelId, {
  mode = 'subscribe',
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const id = clean(channelId);
  const callback = callbackUrl(env);
  if (!id) return { ok: false, reason: 'missing_youtube_channel_id' };
  if (!callback) return { ok: false, reason: 'missing_youtube_websub_callback_url' };
  const secret = clean(env.YOUTUBE_WEBSUB_SECRET);
  if (!secret) return { ok: false, reason: 'missing_youtube_websub_secret' };
  const params = new URLSearchParams({
    'hub.callback': callback,
    'hub.topic': youtubeFeedTopic(id),
    'hub.verify': 'async',
    'hub.mode': mode === 'unsubscribe' ? 'unsubscribe' : 'subscribe',
    'hub.lease_seconds': String(DEFAULT_LEASE_SECONDS),
  });
  params.set('hub.secret', secret);
  const response = await fetchImpl(YOUTUBE_WEBSUB_HUB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const ok = response.ok || response.status === 202 || response.status === 204;
  if (db?.query) {
    await upsertYouTubeChannel(db, {
      channel_id: id,
      subscription_status: ok ? 'subscription_requested' : 'subscription_failed',
      metadata: { websub_request_status: response.status, websub_requested_at: new Date().toISOString() },
    });
  }
  return { ok, status: response.status, channel_id: id, callback_url: callback, topic: youtubeFeedTopic(id) };
}

async function verifyYouTubeWebSubChallenge(db, query = {}) {
  const mode = clean(query['hub.mode']);
  const topic = clean(query['hub.topic']);
  const challenge = clean(query['hub.challenge']);
  const leaseSeconds = Math.max(0, Number(query['hub.lease_seconds'] || 0) || 0);
  const channelId = channelIdFromTopic(topic);
  if (!['subscribe', 'unsubscribe'].includes(mode) || !channelId || !challenge) {
    return { ok: false, status: 404, reason: 'invalid_websub_challenge' };
  }
  if (db?.query) {
    const requested = await db.query(
      `SELECT id FROM property_harvest_channels
       WHERE platform = 'youtube'
         AND external_channel_id = $1
         AND subscription_status IN ('subscription_requested','subscribed')
       LIMIT 1`,
      [channelId]
    );
    if (!requested.rows.length) return { ok: false, status: 404, reason: 'unrequested_websub_channel' };
    await upsertYouTubeChannel(db, {
      channel_id: channelId,
      subscription_status: mode === 'subscribe' ? 'subscribed' : 'unsubscribed',
      metadata: { websub_verified_at: new Date().toISOString(), websub_mode: mode },
    });
    if (mode === 'subscribe' && leaseSeconds > 0) {
      await db.query(
        `UPDATE property_harvest_channels
         SET lease_expires_at = NOW() + ($2::int * INTERVAL '1 second'), updated_at = NOW()
         WHERE platform = 'youtube' AND source_key = $1`,
        [channelId, leaseSeconds]
      );
    }
  }
  return { ok: true, status: 200, challenge, channel_id: channelId };
}

async function processYouTubeWebSubNotification(db, rawBody, {
  signature = '',
  fetchImpl = fetch,
} = {}) {
  const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''));
  if (!webSubSignatureValid(buffer, signature)) return { ok: false, status: 401, reason: 'invalid_websub_signature' };
  const event = parseYouTubeWebSubAtom(buffer.toString('utf8'));
  if (!event.video_id || !event.channel_id || event.deleted) {
    return { ok: true, skipped: true, reason: event.deleted ? 'youtube_video_deleted' : 'youtube_websub_entry_missing_ids', event };
  }
  await upsertYouTubeChannel(db, {
    channel_id: event.channel_id,
    display_name: event.author_name,
    last_ingested_at: new Date().toISOString(),
    newest_post_at: event.published_at || null,
    metadata: { latest_websub_video_id: event.video_id, latest_websub_received_at: new Date().toISOString() },
  });
  const { importExactSocialSourcePosts } = require('./socialPlatformPostDiscoveryService');
  const result = await importExactSocialSourcePosts({
    db,
    posts: [{
      post_url: `https://www.youtube.com/watch?v=${event.video_id}`,
      title: event.title,
      source_name: event.author_name,
      source_page_url: `https://www.youtube.com/channel/${event.channel_id}`,
      first_posted_at: event.published_at,
      source_registry_key: event.channel_id,
    }],
    dryRun: false,
    fetchOembed: true,
    fetchPublicMetadata: true,
    fetchImpl,
  });
  const { recordHarvestImportResult } = require('./propertyHarvestMonitoringService');
  await recordHarvestImportResult(db, result, { eventType: 'youtube_websub', sourceKey: event.channel_id }).catch((error) => {
    logger.warn('YouTube WebSub event logging failed', { message: error.message });
  });
  return { ok: true, event, import_result: result };
}

function channelFromDiscoveredPost(post = {}) {
  const raw = post.raw_source_post || {};
  const item = raw.youtube_search_item || {};
  const snippet = item.snippet || {};
  const channelId = clean(snippet.videoOwnerChannelId || snippet.channelId || post.channel_id || post.youtube_channel_id);
  return channelId ? {
    channel_id: channelId,
    display_name: clean(snippet.channelTitle || post.source_name),
    profile_url: post.source_page_url || `https://www.youtube.com/channel/${channelId}`,
    newest_post_at: post.first_posted_at || post.published_at || null,
  } : null;
}

async function registerDiscoveredYouTubeChannels(db, posts = [], { autoSubscribe = true, fetchImpl = fetch, env = process.env } = {}) {
  const channels = [...new Map((Array.isArray(posts) ? posts : [])
    .map(channelFromDiscoveredPost)
    .filter(Boolean)
    .map((channel) => [channel.channel_id, channel])).values()].slice(0, 10);
  const reports = [];
  for (const channel of channels) {
    const stored = await upsertYouTubeChannel(db, channel);
    const shouldSubscribe = autoSubscribe && stored?.subscription_status !== 'subscribed';
    const subscription = shouldSubscribe
      ? await requestYouTubeWebSubSubscription(db, channel.channel_id, { fetchImpl, env }).catch((error) => ({ ok: false, reason: error.message }))
      : { ok: true, skipped: true, reason: 'already_subscribed' };
    reports.push({ channel_id: channel.channel_id, stored: Boolean(stored), subscription });
  }
  return { ok: true, discovered_channel_count: channels.length, reports };
}

module.exports = {
  YOUTUBE_WEBSUB_HUB_URL,
  callbackUrl,
  channelIdFromTopic,
  parseYouTubeWebSubAtom,
  processYouTubeWebSubNotification,
  registerDiscoveredYouTubeChannels,
  requestYouTubeWebSubSubscription,
  verifyYouTubeWebSubChallenge,
  webSubSignatureValid,
  youtubeFeedTopic,
};
