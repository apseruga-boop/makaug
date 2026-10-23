'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');
const { isVerifiedByMakaug } = require('../services/publicAgentEligibilityService');
const { agentCardBio, loadAgentSummaryListings } = require('../services/agentPublicProfileService');
const { loadPublicSeoListing } = require('../services/publicSeoRenderService');
const {
  SHARE_CACHE_CONTROL,
  categoryKey,
  categoryForListing,
  normalizeShareLang,
  renderShareCard,
  usableAgentPhoto,
  usableListingPhoto
} = require('../services/shareCardService');

const CARD_CACHE_MAX = 80;
const cardCache = new Map();

function rememberCard(key, buffer) {
  if (cardCache.has(key)) cardCache.delete(key);
  cardCache.set(key, buffer);
  while (cardCache.size > CARD_CACHE_MAX) {
    const oldest = cardCache.keys().next().value;
    if (oldest === undefined) break;
    cardCache.delete(oldest);
  }
}

function cachedCard(key) {
  const hit = cardCache.get(key);
  if (!hit) return null;
  cardCache.delete(key);
  cardCache.set(key, hit);
  return hit;
}

function safeId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return '';
  return id;
}

function sendCard(res, buffer, source) {
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', SHARE_CACHE_CONTROL);
  res.set('X-makaug-Og-Card', source || 'card');
  return res.status(200).send(buffer);
}

async function fetchPhoto(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)) {
    const payload = value.slice(value.indexOf(',') + 1);
    const buffer = Buffer.from(payload, 'base64');
    return buffer.length ? buffer : null;
  }
  const response = await fetch(value, {
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': 'makaug-og-card/1.0' }
  });
  if (!response.ok) return null;
  const type = String(response.headers.get('content-type') || '');
  if (!type.startsWith('image/')) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null;
  return buffer;
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

async function defaultLoadProperty(db, id) {
  const listing = await loadPublicSeoListing(db, id);
  if (!listing) return null;
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
    photoUrl: usableListingPhoto(listing.primary_image_url) ? listing.primary_image_url : ''
  };
}

function createOgShareRouter(options = {}) {
  const router = express.Router();
  const loadAgent = options.loadAgent || ((id) => defaultLoadAgent(options.db, id));
  const loadProperty = options.loadProperty || ((id) => defaultLoadProperty(options.db, id));
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
      const category = categoryForListing(listing);
      let photo = listing.photo || null;
      if (!photo && listing.photoUrl && usableListingPhoto(listing.photoUrl)) {
        try { photo = await readPhoto(listing.photoUrl); } catch (_error) { photo = null; }
      }
      const source = photo ? 'property' : category;
      const cacheKey = `property:${id}:${lang}:${source}`;
      const hit = cachedCard(cacheKey);
      if (hit) return sendCard(res, hit, source);
      const buffer = photo
        ? await renderShareCard({ kind: 'property', lang, listing: { ...listing, photo } })
        : await categoryCard(category, lang);
      rememberCard(cacheKey, buffer);
      return sendCard(res, buffer, source);
    } catch (error) {
      logger.warn('Share card property render failed', { message: error.message });
      try { return sendCard(res, await homeCard(lang), 'home'); } catch (_fallback) { return res.status(200).end(); }
    }
  });

  return router;
}

module.exports = {
  createOgShareRouter,
  clearOgShareCache() { cardCache.clear(); }
};
