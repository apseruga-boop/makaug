const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const { asArray, cleanText, isValidEmail, isValidPhone } = require('../middleware/validation');
const { logNotification } = require('../services/notificationLogService');
const { ensurePostVerificationRecords } = require('../services/authFlowService');
const { normalizeEmail, normalizeUgPhone } = require('../utils/adminOtpOverride');
const { parsePagination, toPagination } = require('../utils/pagination');

const router = express.Router();
const KNOWN_AGENT_SOCIAL_LINKS = [
  {
    licence: 'CARNELIAN-YOUTUBE-20260519',
    email: 'carnelianproperties4@gmail.com',
    youtube: 'https://www.youtube.com/@CarnelianPropertiesuganda',
    tiktok: 'https://www.tiktok.com/@carnelian.propert',
    website: 'https://www.youtube.com/@CarnelianPropertiesuganda',
  },
  {
    licence: 'SOCIAL-REALTOR-MAHAD-20260520',
    name: 'realtor mahad',
    tiktok: 'https://www.tiktok.com/@realtor_mahad',
    website: 'https://www.youtube.com/@realtormahad',
  },
  {
    licence: 'SOCIAL-ROBS-PROPERTIES-TRAVELS-20260524',
    tiktok: 'https://www.tiktok.com/@robpropertiestravel',
  },
  {
    licence: 'SOCIAL-KNIGHT-FRANK-UGANDA-20260524',
    tiktok: 'https://www.tiktok.com/@knightfrankuganda',
    facebook: 'https://www.facebook.com/372685259596951',
    x: 'https://x.com/knightfrankug',
    website: 'https://www.knightfrank.ug/',
  },
  { licence: 'SOCIAL-BROLL-UGANDA-X-20260524', x: 'https://x.com/BrollUganda', website: 'https://broll.ug/' },
  { licence: 'SOCIAL-CHRIS-PROPERTY-UGANDA-X-20260524', x: 'https://x.com/chrispropertyug', website: 'https://chrispropertyuganda.com/' },
  { licence: 'SOCIAL-ECOLAND-PROPERTY-SERVICES-X-20260524', x: 'https://x.com/ecolandproperty', website: 'https://www.ecolandproperty.com/' },
  { licence: 'SOCIAL-BIGWAYS-UG-X-20260524', x: 'https://x.com/Bigways_UG', website: 'https://bigways.co.ug/' },
  { licence: 'SOCIAL-KHP-ESTATES-20260524', facebook: 'https://www.facebook.com/109087123897182', website: 'https://khpestates.com/' },
  { licence: 'SOCIAL-NAS-REALTORS-20260524', facebook: 'https://www.facebook.com/Nasrealtors/' },
  { licence: 'SOCIAL-DELTA-REAL-ESTATES-UGANDA-20260524', facebook: 'https://www.facebook.com/Deltarealestatesuganda/' },
  { licence: 'SOCIAL-ROYALE-PROPERTY-CONSULTANTS-20260524', facebook: 'https://www.facebook.com/Royalepropertiesuganda/' },
  { licence: 'SOCIAL-ANOMA-GROUP-20260524', facebook: 'https://www.facebook.com/anomagroupltd', website: 'https://www.anomaproperties.com/' },
  { licence: 'SOCIAL-CINAM-INVESTMENTS-20260524', facebook: 'https://www.facebook.com/CinamInvestments/' },
  { licence: 'SOCIAL-HONEST-ESTATE-DEVELOPERS-20260524', facebook: 'https://www.facebook.com/174491755991678/', website: 'https://www.honestestatedevelopers.com' },
  { licence: 'SOCIAL-PRIME-HOUSING-ESTATES-20260524', facebook: 'https://www.facebook.com/primehousingestates', website: 'https://primeestates.co.ug' },
  { licence: 'SOCIAL-JAKANA-HEIGHTS-20260524', facebook: 'https://www.facebook.com/286687085651624/' },
  { licence: 'SOCIAL-PROPERTY-SERVICES-LIMITED-20260524', facebook: 'https://www.facebook.com/164016330337117/', website: 'https://www.propertyservicesltd.com' },
  { licence: 'SOCIAL-KAMERUKA-PROPERTIES-20260524', facebook: 'https://www.facebook.com/327009134464566/', website: 'https://www.kameruka.com' },
  { licence: 'SOCIAL-KINGMAKER-PROPERTIES-UGANDA-20260524', facebook: 'https://www.facebook.com/KingMakerPropertiesUganda/', website: 'https://www.kingmakerproperties.co.ug/' },
];
const PUBLIC_AGENT_SUPPRESSED_MARKERS = ['QA TEST - DELETE', 'SOFT LAUNCH TEST - DELETE', 'TRAINING', 'DEMO', 'SAMPLE', 'PLACEHOLDER'];
const PUBLIC_AGENT_MIN_LIVE_LISTINGS = 2;
const PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS = 1;
const DIRECT_AGENT_PROFILE_MARKER = '[DIRECT_AGENT_AUTHORISED]';

function sqlLiteral(value = '') {
  return String(value).replace(/'/g, "''");
}

function knownAgentMatch(alias, link) {
  const checks = [];
  if (link.licence) checks.push(`COALESCE(${alias}.licence_number, '') = '${sqlLiteral(link.licence)}'`);
  if (link.email) checks.push(`LOWER(COALESCE(${alias}.email, '')) = '${sqlLiteral(link.email.toLowerCase())}'`);
  if (link.name) {
    checks.push(`LOWER(COALESCE(${alias}.full_name, '')) = '${sqlLiteral(link.name.toLowerCase())}'`);
    checks.push(`LOWER(COALESCE(${alias}.company_name, '')) = '${sqlLiteral(link.name.toLowerCase())}'`);
  }
  return checks.length ? `(${checks.join(' OR ')})` : 'FALSE';
}

function knownAgentSocialCase(alias, field, columnAlias) {
  const clauses = KNOWN_AGENT_SOCIAL_LINKS
    .filter((link) => link[field])
    .map((link) => `WHEN ${knownAgentMatch(alias, link)} THEN '${sqlLiteral(link[field])}'`)
    .join('\n          ');
  return `CASE
          ${clauses}
          ELSE NULL
        END AS ${columnAlias}`;
}

function knownAgentSocialSelect(alias = 'a') {
  const safeAlias = alias === 'a' ? 'a' : alias;
  return `
        ${knownAgentSocialCase(safeAlias, 'youtube', 'youtube_url')},
        ${knownAgentSocialCase(safeAlias, 'tiktok', 'tiktok_url')},
        ${knownAgentSocialCase(safeAlias, 'facebook', 'facebook_url')},
        ${knownAgentSocialCase(safeAlias, 'x', 'x_url')},
        ${knownAgentSocialCase(safeAlias, 'website', 'website_url')}`;
}

function addPublicAgentLaunchTestFilter(filters, values) {
  PUBLIC_AGENT_SUPPRESSED_MARKERS.forEach((marker) => {
    values.push(`%${marker}%`);
    const idx = values.length;
    filters.push(`(
      COALESCE(a.full_name, '') NOT ILIKE $${idx}
      AND COALESCE(a.company_name, '') NOT ILIKE $${idx}
      AND COALESCE(a.bio, '') NOT ILIKE $${idx}
      AND COALESCE(a.verification_reason, '') NOT ILIKE $${idx}
    )`);
  });
  filters.push("COALESCE(a.email, '') !~* '(qa-test|makaug\\.invalid|dummy|sample)'");
  filters.push("COALESCE(a.licence_number, '') !~* '^(QA|TEST|DUMMY|SAMPLE)-'");
  filters.push("COALESCE(a.specializations::text, '') !~* '(qa test delete|soft launch test|dummy|sample|training|demo|placeholder)'");
}

function addPublicAgentInventoryFilter(filters) {
  filters.push(`(
    (
      COALESCE(a.verification_reason, '') ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
      AND (
        SELECT COUNT(*)::int
        FROM properties p
        WHERE p.agent_id = a.id
          AND p.status = 'approved'
      ) >= ${PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS}
    )
    OR (
      COALESCE(a.verification_reason, '') NOT ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
      AND (
        SELECT COUNT(*)::int
        FROM properties p
        WHERE p.agent_id = a.id
          AND p.status = 'approved'
      ) >= ${PUBLIC_AGENT_MIN_LIVE_LISTINGS}
    )
  )`);
}

function addPublicAgentSelfRegistrationFilter(filters) {
  filters.push(`(
    a.user_id IS NOT NULL
    OR COALESCE(a.verification_reason, '') ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
  )`);
  filters.push("COALESCE(a.verification_reason, '') NOT ILIKE '%public social source onboarding%'");
  filters.push("COALESCE(a.verification_reason, '') NOT ILIKE '%source profile%'");
  filters.push("COALESCE(a.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'");
}

function verifyListingSubmitToken(token) {
  const secret = process.env.LISTING_OTP_JWT_SECRET
    || process.env.JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'dev-listing-otp-secret');
  if (!secret) return { ok: false, error: 'missing_jwt_secret' };

  try {
    const decoded = jwt.verify(token, secret);
    const channel = String(decoded?.channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
    const identifier = channel === 'email'
      ? normalizeEmail(decoded?.email || decoded?.identifier)
      : normalizeUgPhone(decoded?.phone || decoded?.identifier);

    if (decoded?.purpose !== 'listing_submit' || !identifier) {
      return { ok: false, error: 'invalid_purpose' };
    }

    return { ok: true, channel, identifier };
  } catch (error) {
    return { ok: false, error: 'invalid_or_expired' };
  }
}

function parseCsvList(value) {
  if (Array.isArray(value)) {
    return value.map((x) => cleanText(x)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function cleanBrokerUpload(value, fallbackName = 'broker document') {
  if (!value || typeof value !== 'object') return null;
  const name = cleanText(value.name || fallbackName).slice(0, 160) || fallbackName;
  const type = cleanText(value.type || value.mime || 'application/octet-stream').slice(0, 120);
  const size = Number(value.size || 0) || 0;
  const dataUrl = String(value.data_url || value.dataUrl || '').trim();
  const url = cleanText(value.url || value.href || '').slice(0, 2000);
  if (size > 5 * 1024 * 1024) {
    const err = new Error(`${fallbackName} is too large. Upload must be 5MB or smaller.`);
    err.status = 400;
    throw err;
  }
  const allowedDataUrl = dataUrl.startsWith('data:image/');
  const allowedUrl = /^https?:\/\//i.test(url);
  if (!allowedDataUrl && !allowedUrl) return null;
  return {
    name,
    type,
    size,
    data_url: allowedDataUrl ? dataUrl : undefined,
    url: allowedUrl ? url : undefined,
    uploaded_at: new Date().toISOString()
  };
}

function getBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookieHeader = req.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)makaug_auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, preferred_language, profile_data
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [decoded.sub]
    );
    return result.rows[0] || null;
  } catch (_) {
    return null;
  }
}

function phoneDigits(value = '') {
  return cleanText(value).replace(/\D+/g, '');
}

async function fetchBrokerAgentForUser(user) {
  if (!user?.id) return null;
  const email = normalizeEmail(user.email || '');
  const digits = phoneDigits(user.phone || '');
  const result = await db.query(
    `SELECT
      a.id,
      a.makaug_agent_number,
      a.full_name,
      a.company_name,
      a.phone,
      a.whatsapp,
      a.email,
      a.licence_number,
      a.registration_status,
      a.listing_limit,
      a.user_id,
      a.nin,
      a.id_expiry_date,
      a.area_certificate_url,
      a.districts_covered,
      a.specializations,
      a.experience_years,
      a.identity_document_name,
      a.identity_document_url,
      a.identity_document_type,
      a.identity_document_uploaded_at,
      a.profile_photo_url,
      a.bio,
      a.verification_reason,
      a.privacy_consent_accepted,
      a.privacy_consent_at,
      a.data_retention_notice_accepted,
      a.data_retention_notice_at,
      a.approved_at,
      a.contact_phone_verified_at,
      a.agent_application_channel,
      a.featured_homepage,
      a.featured_at,
      a.rating,
      a.sales_count,
      a.status,
      a.created_at,
      a.updated_at,
      ${knownAgentSocialSelect('a')},
      COALESCE(p.active_listings, 0) AS listings_count,
      COALESCE(lp.pending_listings, 0) AS pending_listings_count,
      COALESCE(li.lead_enquiries, 0) AS lead_enquiries
     FROM agents a
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS active_listings
       FROM properties p
       WHERE (p.agent_id = a.id OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = a.id::text)
         AND p.status = 'approved'
     ) p ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS pending_listings
       FROM properties p
       WHERE (p.agent_id = a.id OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = a.id::text)
         AND p.status = 'pending'
     ) lp ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(pi.*)::int AS lead_enquiries
       FROM properties p
       JOIN property_inquiries pi ON pi.property_id = p.id
       WHERE p.agent_id = a.id OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = a.id::text
     ) li ON true
     WHERE a.user_id = $1
        OR ($2::text <> '' AND LOWER(COALESCE(a.email, '')) = LOWER($2))
        OR ($3::text <> '' AND regexp_replace(COALESCE(a.phone, ''), '\\D', '', 'g') = $3)
        OR ($3::text <> '' AND regexp_replace(COALESCE(a.whatsapp, ''), '\\D', '', 'g') = $3)
     ORDER BY a.user_id = $1 DESC, a.updated_at DESC
     LIMIT 1`,
    [user.id, email, digits]
  );
  return result.rows[0] || null;
}

async function fetchBrokerListings({ agent, user }) {
  if (!agent?.id) return [];
  const result = await db.query(
    `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.price, p.price_period, p.status, p.created_at, p.updated_at,
            p.inquiry_reference, p.lister_email, p.lister_phone, p.agent_id, p.listed_via, p.source, p.extra_fields,
            img.url AS primary_image_url,
            COALESCE(i.inquiry_count, 0) AS inquiry_count
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS inquiry_count
       FROM property_inquiries pi
       WHERE pi.property_id = p.id
     ) i ON true
     LEFT JOIN LATERAL (
       SELECT pi.url
       FROM property_images pi
       WHERE pi.property_id = p.id
       ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
       LIMIT 1
     ) img ON true
     WHERE $1::uuid IS NOT NULL
       AND (
         p.agent_id = $1
         OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text
       )
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [agent.id]
  );
  return result.rows;
}

router.get('/me', async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in required' });
    if (user.role !== 'agent_broker') return res.status(403).json({ ok: false, error: 'Broker account required' });

    let agent = await fetchBrokerAgentForUser(user);
    if (!agent) {
      await ensurePostVerificationRecords(db, user);
      agent = await fetchBrokerAgentForUser(user);
    }

    const listings = await fetchBrokerListings({ agent, user });
    const linkedListingIds = listings.map((item) => item.id);
    const saveCountResult = linkedListingIds.length
      ? await db.query(
          `SELECT COUNT(*)::int AS total
           FROM saved_properties
           WHERE property_id = ANY($1::uuid[])`,
          [linkedListingIds]
        ).catch(() => ({ rows: [{ total: 0 }] }))
      : { rows: [{ total: 0 }] };

    return res.json({
      ok: true,
      data: {
        user,
        agent,
        listings,
        stats: {
          active_listings: listings.filter((item) => item.status === 'approved').length,
          pending_listings: listings.filter((item) => item.status === 'pending').length,
          listing_saves: Number(saveCountResult.rows[0]?.total || 0),
          lead_enquiries: listings.reduce((sum, item) => sum + Number(item.inquiry_count || 0), 0),
          listing_views: 0,
          profile_views: 0
        },
        capabilities: {
          can_skip_listing_otp: true,
          can_skip_listing_identity_upload: true,
          listings_require_admin_approval: true,
          can_boost_properties: true
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in required' });
    if (user.role !== 'agent_broker') return res.status(403).json({ ok: false, error: 'Broker account required' });

    let agent = await fetchBrokerAgentForUser(user);
    if (!agent) {
      await ensurePostVerificationRecords(db, user);
      agent = await fetchBrokerAgentForUser(user);
    }
    if (!agent?.id) return res.status(404).json({ ok: false, error: 'Broker profile not found' });

    const body = req.body || {};
    const fullName = cleanText(body.full_name).slice(0, 160);
    const companyName = cleanText(body.company_name).slice(0, 160);
    const bio = cleanText(body.bio).slice(0, 1000);
    const whatsapp = normalizeUgPhone(body.whatsapp || body.phone || '');
    const profilePhotoUrl = String(body.profile_photo_url || '').trim();
    const districtsCovered = parseCsvList(body.districts_covered || body.areas);
    const specializations = parseCsvList(body.specializations);

    if (whatsapp && !isValidPhone(whatsapp)) return res.status(400).json({ ok: false, error: 'whatsapp is invalid' });
    if (profilePhotoUrl && !(/^data:image\//i.test(profilePhotoUrl) || /^https?:\/\//i.test(profilePhotoUrl))) {
      return res.status(400).json({ ok: false, error: 'profile_photo_url must be an image data URL or remote image URL' });
    }

    const updated = await db.query(
      `UPDATE agents
       SET full_name = COALESCE(NULLIF($1, ''), full_name),
           company_name = COALESCE(NULLIF($2, ''), company_name),
           bio = COALESCE(NULLIF($3, ''), bio),
           whatsapp = COALESCE(NULLIF($4, ''), whatsapp),
           phone = COALESCE(NULLIF($4, ''), phone),
           profile_photo_url = COALESCE(NULLIF($5, ''), profile_photo_url),
           districts_covered = CASE WHEN cardinality($6::text[]) > 0 THEN $6::text[] ELSE districts_covered END,
           specializations = CASE WHEN cardinality($7::text[]) > 0 THEN $7::text[] ELSE specializations END,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        fullName,
        companyName,
        bio,
        whatsapp,
        profilePhotoUrl.slice(0, 5 * 1024 * 1024),
        districtsCovered,
        specializations,
        agent.id
      ]
    );

    await db.query(
      `UPDATE users
       SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, JSON.stringify({
        broker_agent_id: agent.id,
        agent_company: companyName || agent.company_name || '',
        agent_districts: districtsCovered.length ? districtsCovered.join(', ') : (agent.districts_covered || []).join(', '),
        agent_specialities: specializations.length ? specializations.join(', ') : (agent.specializations || []).join(', '),
        broker_profile_photo_url: profilePhotoUrl || agent.profile_photo_url || '',
        broker_bio: bio || agent.bio || ''
      })]
    );

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = cleanText(req.query.search);
    const district = cleanText(req.query.district);
    const status = cleanText(req.query.status || 'approved');

    const filters = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(a.full_name ILIKE $${values.length} OR a.company_name ILIKE $${values.length})`);
    }

    if (district) {
      values.push(district);
      filters.push(`$${values.length} = ANY(a.districts_covered)`);
    }

    if (status && status !== 'all') {
      values.push(status);
      filters.push(`a.status = $${values.length}`);
    }
    addPublicAgentLaunchTestFilter(filters, values);
    addPublicAgentSelfRegistrationFilter(filters);
    addPublicAgentInventoryFilter(filters);

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const totalResult = await db.query(`SELECT COUNT(*)::int AS total FROM agents a ${where}`, values);
    const total = totalResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        a.id,
        a.full_name,
        a.company_name,
        a.phone,
        a.whatsapp,
        a.email,
        a.user_id,
        a.registration_status,
        a.featured_homepage,
        a.featured_at,
        a.bio,
        a.profile_photo_url,
        a.licence_number,
        a.verification_reason,
        a.status,
        a.rating,
        a.sales_count,
        a.districts_covered,
        a.specializations,
        ${knownAgentSocialSelect('a')},
        COALESCE(p.active_listings, 0) AS listings_count
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_listings
        FROM properties p
        WHERE p.agent_id = a.id AND p.status = 'approved'
      ) p ON true
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const agent = await db.query(
      `SELECT
        a.id,
        a.full_name,
        a.company_name,
        a.phone,
        a.whatsapp,
        a.email,
        a.user_id,
        a.registration_status,
        a.featured_homepage,
        a.featured_at,
        a.bio,
        a.profile_photo_url,
        a.licence_number,
        a.status,
        a.rating,
        a.sales_count,
        a.districts_covered,
        a.specializations,
        a.experience_years,
        a.makaug_agent_number,
        a.verification_reason,
        ${knownAgentSocialSelect('a')},
        COALESCE(p.active_listings, 0) AS listings_count
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_listings
        FROM properties p
        WHERE p.agent_id = a.id AND p.status = 'approved'
      ) p ON true
      WHERE a.id = $1
        AND (
          a.user_id IS NOT NULL
          OR COALESCE(a.verification_reason, '') ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
        )
        AND LOWER(COALESCE(a.status, 'pending')) NOT IN ('rejected', 'declined', 'suspended', 'deleted', 'removed', 'blocked')
        AND COALESCE(a.verification_reason, '') NOT ILIKE '%public social source onboarding%'
        AND COALESCE(a.verification_reason, '') NOT ILIKE '%source profile%'
        AND COALESCE(a.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'
        AND COALESCE(a.full_name, '') NOT ILIKE '%QA TEST - DELETE%'
        AND COALESCE(a.full_name, '') NOT ILIKE '%SOFT LAUNCH TEST - DELETE%'
        AND COALESCE(a.company_name, '') NOT ILIKE '%QA TEST - DELETE%'
        AND COALESCE(a.company_name, '') NOT ILIKE '%SOFT LAUNCH TEST - DELETE%'
        AND COALESCE(a.bio, '') NOT ILIKE '%QA TEST - DELETE%'
        AND COALESCE(a.bio, '') NOT ILIKE '%SOFT LAUNCH TEST - DELETE%'
        AND COALESCE(a.full_name, '') !~* '(training|demo|sample|placeholder)'
        AND COALESCE(a.company_name, '') !~* '(training|demo|sample|placeholder)'
        AND COALESCE(a.bio, '') !~* '(training|demo|sample|placeholder)'
        AND COALESCE(a.verification_reason, '') !~* '(training|demo|sample|placeholder)'
        AND COALESCE(a.email, '') !~* '(qa-test|makaug\\.invalid|dummy|sample)'
        AND COALESCE(a.licence_number, '') !~* '^(QA|TEST|DUMMY|SAMPLE)-'
        AND COALESCE(a.specializations::text, '') !~* '(qa test delete|soft launch test|dummy|sample|training|demo|placeholder)'`,
      [req.params.id]
    );

    if (!agent.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    const listings = await db.query(
      `SELECT
         p.id,
         p.title,
         p.description,
         p.listing_type,
         p.district,
         p.area,
         p.address,
         p.price,
         p.price_currency,
         p.price_original,
         p.price_fx_rate_ugx,
         p.price_fx_as_of,
         p.price_period,
         p.bedrooms,
         p.bathrooms,
         p.property_type,
         p.status,
         p.created_at,
         p.latitude,
         p.longitude,
         p.agent_id,
         p.extra_fields,
         img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT i.url
         FROM property_images i
         WHERE i.property_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
         LIMIT 1
       ) img ON true
       WHERE p.agent_id = $1 AND p.status = 'approved'
       ORDER BY COALESCE(p.approved_at, p.updated_at, p.created_at) DESC
       LIMIT 100`,
      [req.params.id]
    );

    return res.json({
      ok: true,
      data: {
        ...agent.rows[0],
        listings: listings.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const body = req.body || {};

    const fullName = cleanText(body.full_name);
    const licenceNumber = cleanText(body.licence_number);
    const registrationStatus = 'not_registered';
    const listingLimit = 2147483647;
    const resolvedLicence = licenceNumber || `PENDING-${Date.now()}`;
    const phone = cleanText(body.phone);
    const email = cleanText(body.email);
    const listingOtpToken = cleanText(body.listing_otp_token);
    const otpChannelInput = cleanText(body.otp_channel || 'phone').toLowerCase();
    const otpChannel = otpChannelInput === 'email' ? 'email' : 'phone';
    const nin = cleanText(body.nin || body.national_id_number);
    const verificationReason = cleanText(body.verification_reason || body.reason).slice(0, 1200);
    const identityDocument = cleanBrokerUpload(body.identity_document || body.national_id_document || body.id_document, 'National ID photo');
    const privacyConsentAccepted = parseBooleanLike(body.privacy_consent_accepted || body.privacy_accepted, false);
    const dataRetentionNoticeAccepted = parseBooleanLike(body.data_retention_notice_accepted || body.data_deletion_notice_accepted, false);
    const districtsCovered = parseCsvList(body.districts_covered);
    const specializations = parseCsvList(body.specializations);

    const errors = [];

    if (!fullName) errors.push('full_name is required');
    if (!phone) errors.push('phone is required');
    if (!email) errors.push('email is required');
    if (!districtsCovered.length) errors.push('districts_covered is required');
    if (!nin) errors.push('national_id_number is required');
    if (!verificationReason) errors.push('verification_reason is required');
    if (!identityDocument) errors.push('national_id_document is required');
    if (!privacyConsentAccepted) errors.push('privacy_consent_accepted is required');
    if (!dataRetentionNoticeAccepted) errors.push('data_retention_notice_accepted is required');

    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (!listingOtpToken) {
      errors.push('listing_otp_token is required. Verify OTP before broker registration');
    } else {
      const verified = verifyListingSubmitToken(listingOtpToken);
      if (!verified.ok) {
        errors.push('listing_otp_token is invalid or expired');
      } else if (verified.channel !== otpChannel) {
        errors.push('listing_otp_token channel does not match otp_channel');
      } else if (verified.channel === 'email') {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || verified.identifier !== normalizedEmail) {
          errors.push('listing_otp_token does not match email');
        }
      } else {
        const normalizedPhone = normalizeUgPhone(phone);
        if (!normalizedPhone || verified.identifier !== normalizedPhone) {
          errors.push('listing_otp_token does not match phone');
        }
      }
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const inserted = await db.query(
      `INSERT INTO agents (
        full_name,
        company_name,
        licence_number,
        registration_status,
        listing_limit,
        phone,
        whatsapp,
        email,
        districts_covered,
        specializations,
        nin,
        area_certificate_url,
        identity_document_name,
        identity_document_url,
        identity_document_type,
        identity_document_uploaded_at,
        verification_reason,
        privacy_consent_accepted,
        privacy_consent_at,
        data_retention_notice_accepted,
        data_retention_notice_at,
        profile_photo_url,
        bio,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),$16,$17,NOW(),$18,NOW(),$19,$20,'pending')
      RETURNING id, status, registration_status, created_at`,
      [
        fullName,
        cleanText(body.company_name) || null,
        resolvedLicence,
        registrationStatus,
        listingLimit,
        phone,
        cleanText(body.whatsapp) || null,
        email || null,
        districtsCovered,
        specializations,
        nin || null,
        cleanText(body.area_certificate_url) || null,
        identityDocument.name,
        identityDocument.data_url || identityDocument.url || null,
        identityDocument.type || null,
        verificationReason,
        privacyConsentAccepted,
        dataRetentionNoticeAccepted,
        cleanText(body.profile_photo_url) || null,
        cleanText(body.bio) || null
      ]
    );

    await logNotification(db, {
      recipientPhone: phone,
      recipientEmail: email,
      channel: 'in_app',
      type: 'new_broker_verification_request',
      status: 'logged',
      payloadSummary: {
        agent_id: inserted.rows[0]?.id,
        full_name: fullName,
        company_name: cleanText(body.company_name) || null,
        districts_covered: districtsCovered,
        national_id_document_uploaded: Boolean(identityDocument),
        privacy_consent_accepted: privacyConsentAccepted,
        data_retention_notice_accepted: dataRetentionNoticeAccepted
      }
    });

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Licence number or contact already registered' });
    }
    return next(error);
  }
});

module.exports = router;
