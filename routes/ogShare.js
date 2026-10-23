'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const logger = require('../config/logger');
const { isVerifiedByMakaug } = require('../services/publicAgentEligibilityService');
const { agentCardBio, loadAgentSummaryListings } = require('../services/agentPublicProfileService');
const { loadPublicSeoListing } = require('../services/publicSeoRenderService');
const {
  SHARE_CACHE_CONTROL,
  categoryForListing,
  categoryKey,
  normalizeShareLang,
  renderShareCard,
  propertyShareRevision,
  shareCardPhotoList,
  sharePhotoHostPattern,
  usableAgentPhoto
} = require('../services/shareCardService');

const CARD_CACHE_MAX = 80;
const PHOTO_CACHE_MAX = 40;
const PHOTO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NO_PHOTO_CACHE_CONTROL = 'public, max-age=600, stale-while-revalidate=86400';
const cardCache = new Map();
const photoCache = new Map();

function rememberCard(key, buffer, ttlMs = Infinity) {
  if (cardCache.has(key)) cardCache.delete(key);
  cardCache.set(key, { buffer, expiresAt: Date.now() + ttlMs });
  while (cardCache.size > CARD_CACHE_MAX) {
    const oldest = cardCache.keys().next().value;
    if (oldest === undefined) break;
    cardCache.delete(oldest);
  }
}

function rememberPhoto(url, buffer) {
  if (!url || !buffer) return;
  if (photoCache.has(url)) photoCache.delete(url);
  photoCache.set(url, { buffer, expiresAt: Date.now() + PHOTO_CACHE_TTL_MS });
  while (photoCache.size > PHOTO_CACHE_MAX) {
    const oldest = photoCache.keys().next().value;
    if (oldest === undefined) break;
    photoCache.delete(oldest);
  }
}

function cachedPhoto(url) {
  const hit = photoCache.get(url);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    photoCache.delete(url);
    return null;
  }
  photoCache.delete(url);
  photoCache.set(url, hit);
  return hit.buffer;
}

function cachedCard(key) {
  const hit = cardCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cardCache.delete(key);
    return null;
  }
  cardCache.delete(key);
  cardCache.set(key, hit);
  return hit.buffer;
}

function safeId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return '';
  return id;
}

function sendCard(res, buffer, source, cacheControl = SHARE_CACHE_CONTROL) {
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', cacheControl);
  res.set('X-makaug-Og-Card', source || 'card');
  return res.status(200).send(buffer);
}

function imageMagic(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return true;
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return true;
  if (buffer.subarray(0, 3).toString() === 'GIF') return true;
  return false;
}

function blockedPhotoTarget(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '169.254.169.254' || host === 'metadata.google.internal') return true;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.0\.0\.0$)/.test(host)) return true;
    return false;
  } catch (_error) {
    return true;
  }
}

async function fetchPhoto(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  const cached = cachedPhoto(value);
  if (cached) return cached;
  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)) {
    const payload = value.slice(value.indexOf(',') + 1);
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null;
    try { await sharp(buffer).stats(); } catch (_error) { return null; }
    return buffer;
  }
  if (blockedPhotoTarget(value)) return null;
  const response = await fetch(value, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; makaug-og-card/1.0; +https://makaug.com)'
    }
  });
  if (!response.ok) return null;
  if (response.url && blockedPhotoTarget(response.url)) return null;
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('text/') || type.includes('html') || type.includes('json')) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null;
  if (!type.startsWith('image/') && !imageMagic(buffer)) return null;
  if (/maxresdefault/i.test(value) && buffer.length < 3000) return null;
  try { await sharp(buffer).stats(); } catch (_error) { return null; }
  rememberPhoto(value, buffer);
  return buffer;
}

const SHARE_PHOTO_LOOKUP_SQL = `SELECT i.url
     FROM property_images i
    WHERE i.property_id::text = $1
      AND i.url ~* '^https://.+'
      AND i.url !~* 'tiktokcdn|byteimg|unsplash\\.com|photo-1560518883-ce09059eeffa|image[ _-]*pending'
      AND COALESCE(i.slot_key, '') <> 'source_evidence_card'
      AND COALESCE(i.room_label, '') !~* 'image[ _-]*pending'
      AND (
        i.url ~* $2
        OR i.url ~* '^https://(i\\.ytimg\\.com|img\\.youtube\\.com|pbs\\.twimg\\.com|video\\.twimg\\.com)/'
      )
    ORDER BY
      (i.url ~* $2) DESC,
      (COALESCE(i.slot_key, '') = 'staff_upload') DESC,
      (COALESCE(i.slot_key, '') ~* '^(video_key_frame_|video_still_|video_recovery_still_)') DESC,
      i.is_primary DESC,
      i.sort_order ASC NULLS LAST,
      i.created_at ASC
    LIMIT 6`;

async function defaultLoadSharePhotos(db, id) {
  if (!db || typeof db.query !== 'function') return [];
  const result = await db.query(SHARE_PHOTO_LOOKUP_SQL, [id, sharePhotoHostPattern()]);
  return (result.rows || []).map((row) => row.url).filter(Boolean);
}

function publicAgentName(value) {
  return String(value || '').trim().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('en'));
}

function districtText(row, fromListings) {
  const covered = Array.isArray(row.districts_covered) ? row.districts_covered : [];
  const names = [...covered, ...(fromListings || [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(names)].slice(0, 4).join(', ');
}

async function defaultLoadAgent(db, id) {
  const agentResult = await db.query(
    `SELECT
       a.id, a.full_name, a.company_name, a.profile_photo_url, a.status, a.removed_at,
       a.bio, a.verification_reason, a.identity_document_url, a.contact_phone_verified_at,
       a.licence_number, a.districts_covered
     FROM agents a
     WHERE a.id::text = $1
       AND LOWER(COALESCE(a.status, 'pending')) NOT IN ('rejected', 'declined', 'suspended', 'deleted', 'removed', 'blocked')
       AND EXISTS (
         SELECT 1 FROM properties p
         WHERE p.agent_id = a.id AND p.status = 'approved'
       )
     LIMIT 1`,
    [id]
  );
  const row = agentResult.rows[0];
  if (!row) return null;
  const listings = await loadAgentSummaryListings(db, row.id);
  const prices = listings.map((item) => Number(item.price)).filter((price) => price > 0);
  const cardBio = agentCardBio(row, listings);
  return {
    name: publicAgentName(row.full_name || row.company_name || 'Property agent'),
    verified: isVerifiedByMakaug(row),
    districts: districtText(row, listings.map((item) => item.district)),
    bio: cardBio.text,
    bioSource: cardBio.source,
    bioParts: cardBio.parts || null,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    photoUrl: usableAgentPhoto(row.profile_photo_url) ? String(row.profile_photo_url).trim() : ''
  };
}

async function defaultLoadProperty(db, id, loadSharePhotos) {
  const listing = await loadPublicSeoListing(db, id);
  if (!listing) return null;
  let gallery = [];
  try {
    gallery = await (loadSharePhotos || defaultLoadSharePhotos)(db, id);
  } catch (error) {
    logger.warn('Share card photo lookup failed', { message: error.message });
  }
  const photoUrls = shareCardPhotoList({
    photoUrls: [listing.primary_image_url, ...(Array.isArray(gallery) ? gallery : [])]
  });
  return {
    id: listing.id,
    listing_type: listing.listing_type,
    propertyType: listing.property_type,
    title: listing.title,
    price: listing.price,
    pricePeriod: listing.price_period,
    bedrooms: listing.bedrooms,
    area: listing.area,
    district: listing.district,
    foundOnline: Boolean(listing.found_online_notice),
    updated_at: listing.updated_at,
    photoUrl: photoUrls[0] || '',
    photoUrls
  };
}

function createOgShareRouter(options = {}) {
  const router = express.Router();
  const loadAgent = options.loadAgent || ((id) => defaultLoadAgent(options.db, id));
  const loadProperty = options.loadProperty || ((id) => defaultLoadProperty(options.db, id, options.loadSharePhotos));
  const readPhoto = options.fetchPhoto || fetchPhoto;
  const limiter = options.limiter || rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false
  });
  router.use(limiter);

  async function homeCard(lang) {
    const key = `home:${lang}`;
    const hit = cachedCard(key);
    if (hit) return hit;
    const buffer = await renderShareCard({ kind: 'home', lang });
    rememberCard(key, buffer);
    return buffer;
  }

  async function categoryCard(key, lang) {
    const cacheKey = `category:${key}:${lang}`;
    const hit = cachedCard(cacheKey);
    if (hit) return hit;
    const buffer = await renderShareCard({ kind: 'category', category: key, lang });
    rememberCard(cacheKey, buffer);
    return buffer;
  }

  router.get('/home.jpg', async (req, res) => {
    const lang = normalizeShareLang(req.query.lang);
    try {
      return sendCard(res, await homeCard(lang), 'home');
    } catch (error) {
      logger.warn('Share card home render failed', { message: error.message });
      return res.status(200).type('jpeg').send(Buffer.alloc(0));
    }
  });

  router.get('/category/:key.jpg', async (req, res) => {
    const lang = normalizeShareLang(req.query.lang);
    const key = categoryKey(req.params.key);
    try {
      if (!key) return sendCard(res, await homeCard(lang), 'home');
      return sendCard(res, await categoryCard(key, lang), key);
    } catch (error) {
      logger.warn('Share card category render failed', { key, message: error.message });
      try {
        return sendCard(res, await homeCard(lang), 'home');
      } catch (_fallback) {
        return res.status(200).type('jpeg').send(Buffer.alloc(0));
      }
    }
  });

  router.get('/agent/:id.jpg', async (req, res) => {
    const lang = normalizeShareLang(req.query.lang);
    const id = safeId(req.params.id);
    if (!id) {
      try { return sendCard(res, await homeCard(lang), 'home'); } catch (_error) { return res.status(200).end(); }
    }
    const cacheKey = `agent:${id}:${lang}`;
    const hit = cachedCard(cacheKey);
    if (hit) return sendCard(res, hit, 'agent');
    try {
      const agent = await loadAgent(id);
      if (!agent) return sendCard(res, await homeCard(lang), 'home');
      let photo = agent.photo || null;
      if (!photo && agent.photoUrl) {
        try { photo = await readPhoto(agent.photoUrl); } catch (_error) { photo = null; }
      }
      const buffer = await renderShareCard({
        kind: 'agent',
        lang,
        agent: { ...agent, photo }
      });
      rememberCard(cacheKey, buffer);
      return sendCard(res, buffer, 'agent');
    } catch (error) {
      logger.warn('Share card agent render failed', { message: error.message });
      try { return sendCard(res, await homeCard(lang), 'home'); } catch (_fallback) { return res.status(200).end(); }
    }
  });

  router.get('/property/:id.jpg', async (req, res) => {
    const lang = normalizeShareLang(req.query.lang);
    const id = safeId(req.params.id);
    if (!id) {
      try { return sendCard(res, await homeCard(lang), 'home'); } catch (_error) { return res.status(200).end(); }
    }
    try {
      const listing = await loadProperty(id);
      if (!listing) return sendCard(res, await homeCard(lang), 'home');
      const cacheKey = `property:${id}:${lang}:${propertyShareRevision(listing)}`;
      const hit = cachedCard(cacheKey);
      if (hit) return sendCard(res, hit, 'property');
      const photoUrls = listing.photo ? [] : shareCardPhotoList(listing);
      if (!listing.photo && !photoUrls.length) {
        const key = categoryForListing(listing);
        return sendCard(res, await categoryCard(key, lang), key, NO_PHOTO_CACHE_CONTROL);
      }
      let photo = listing.photo || null;
      if (!photo) {
        for (const photoUrl of photoUrls) {
          try {
            const candidate = await readPhoto(photoUrl);
            if (!candidate) continue;
            if (/maxresdefault/i.test(photoUrl) && candidate.length < 3000) continue;
            photo = candidate;
            break;
          } catch (error) {
            logger.warn('Share card photo fetch failed', {
              host: (() => { try { return new URL(photoUrl).host; } catch (_error) { return ''; } })(),
              message: error.message
            });
          }
        }
      }
      const buffer = await renderShareCard({ kind: 'property', lang, listing: { ...listing, photo } });
      if (photo) {
        rememberCard(cacheKey, buffer, 24 * 60 * 60 * 1000);
        return sendCard(res, buffer, 'property');
      }
      return sendCard(res, buffer, 'property', 'public, max-age=60, must-revalidate');
    } catch (error) {
      logger.warn('Share card property render failed', { message: error.message });
      try { return sendCard(res, await homeCard(lang), 'home'); } catch (_fallback) { return res.status(200).end(); }
    }
  });

  return router;
}

module.exports = {
  createOgShareRouter,
  SHARE_PHOTO_LOOKUP_SQL,
  NO_PHOTO_CACHE_CONTROL,
  clearOgShareCache() {
    cardCache.clear();
    photoCache.clear();
  }
};
