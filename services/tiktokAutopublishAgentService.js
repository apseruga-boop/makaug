'use strict';

const {
  SOCIAL_SEARCH_SOURCE,
  LAUNCH_SOURCE_POST_WINDOW_START,
} = require('./socialSearchSourcedListingsService');
const {
  importTikTokExactVideoPosts,
  TIKTOK_EXACT_VIDEO_URL_PATTERN,
} = require('./socialPlatformPostDiscoveryService');

const LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE = 'sourced_inventory_candidate_v1';
const DEFAULT_HASHTAG = 'ugandarealestate';
const DEFAULT_LIVE_LIMIT = 5;
const DEFAULT_REVIEW_LIMIT = 100;
const MAX_SCAN_LIMIT = 250;
const AGENT_ACTOR_ID = 'tiktok_autopublish_agent';

const REVIEW_STATUSES = [
  'pending',
  'pending_review',
  'test_pending_review',
  'pending_review_hidden',
  'draft',
  'submitted',
  'resubmitted',
  'in_review',
  'under_review',
  'needs_review',
  'awaiting_review',
  'queued',
  'source_review',
  'source_review_required',
  'pending_king_source_review',
  'king_review',
];

const LIVE_STATUSES = ['approved', 'live', 'published'];

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeLimit(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
}

function normalizeHashtag(value = DEFAULT_HASHTAG) {
  const normalized = cleanText(value || DEFAULT_HASHTAG)
    .replace(/^#/, '')
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase();
  return normalized || DEFAULT_HASHTAG;
}

function normalizeUgandanPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^2567\d{8}$/.test(digits)) return `+${digits}`;
  if (/^07\d{8}$/.test(digits)) return `+256${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `+256${digits}`;
  return '';
}

function sourceUrlFromRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return cleanText(extra.source_post_url || extra.source_url || extra.tiktok_url || row.source_url || '');
}

function inferTikTokPostedAtFromVideoUrl(value = '') {
  const match = cleanText(value).match(/\/video\/(\d+)/i);
  if (!match) return '';
  try {
    const unixSeconds = Number(BigInt(match[1]) >> 32n);
    const date = new Date(unixSeconds * 1000);
    const year = date.getUTCFullYear();
    return year >= 2016 && year <= 2036 ? date.toISOString() : '';
  } catch (_) {
    return '';
  }
}

function sourceTextFromRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return cleanText([
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.source_comments,
    row.description,
  ].filter(Boolean).join(' '));
}

function sourcePostedAtFromRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const candidates = [
    extra.first_posted_online_at,
    extra.source_published_at,
    extra.video_published_at,
    extra.platform_posted_at,
    extra.source_posted_at,
    inferTikTokPostedAtFromVideoUrl(sourceUrlFromRow(row)),
  ].map(cleanText).filter(Boolean);
  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return '';
}

function sourceDateIsConfirmed2026(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const status = cleanText(extra.source_post_date_status || extra.original_publish_date_status).toLowerCase();
  const postedAt = sourcePostedAtFromRow(row);
  const parsed = postedAt ? new Date(postedAt) : null;
  if (status === 'confirmed_2026_plus_source_window' || status === 'tiktok_video_id_inferred_2026_source_window') return true;
  if (!parsed || Number.isNaN(parsed.getTime())) return false;
  return parsed >= new Date(LAUNCH_SOURCE_POST_WINDOW_START);
}

function locationIsSpecific(row = {}) {
  const area = cleanText(row.area);
  const district = cleanText(row.district);
  const address = cleanText(row.address);
  if (!area || !district) return false;
  const generic = new Set(['uganda', 'central', 'greater kampala']);
  if (generic.has(area.toLowerCase()) || generic.has(district.toLowerCase())) return false;
  if (area.toLowerCase() === district.toLowerCase() && !address) return false;
  return true;
}

function knownListingType(value = '') {
  return ['sale', 'rent', 'students', 'commercial', 'land'].includes(cleanText(value).toLowerCase());
}

function listingTypeLabel(value = '', row = {}) {
  const type = cleanText(value || row.listing_type).toLowerCase();
  if (type === 'land') return 'Land';
  if (type === 'rent') return row.bedrooms ? `${row.bedrooms}-bed rental` : 'Rental property';
  if (type === 'students') return 'Student property';
  if (type === 'commercial') return 'Commercial property';
  return row.bedrooms ? `${row.bedrooms}-bed house` : 'Property';
}

function titleForApprovedTikTok(row = {}) {
  const area = cleanText(row.area);
  const district = cleanText(row.district);
  const label = listingTypeLabel(row.listing_type, row);
  const action = row.listing_type === 'rent' || row.listing_type === 'students' || row.listing_type === 'commercial'
    ? 'for rent'
    : 'for sale';
  return `${label} ${action} in ${area}, ${district} (TikTok 2026)`;
}

function descriptionForApprovedTikTok(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const sourceUrl = sourceUrlFromRow(row);
  const posted = sourcePostedAtFromRow(row);
  const sourceText = sourceTextFromRow(row);
  const priceLabel = cleanText(extra.source_price_label || extra.price_label || '');
  return [
    `${titleForApprovedTikTok(row)}.`,
    `Location: ${cleanText(row.area)}, ${cleanText(row.district)}${row.address ? ` (${cleanText(row.address)})` : ''}.`,
    posted ? `Source date: ${posted.slice(0, 10)}.` : '',
    priceLabel ? `Source price: ${priceLabel}.` : '',
    sourceText ? `Source evidence: ${sourceText.slice(0, 420)}${sourceText.length > 420 ? '...' : ''}` : '',
    sourceUrl ? `Original TikTok source: ${sourceUrl}` : '',
    'Contact details and exact availability should be confirmed directly with the listed source before viewing.',
  ].filter(Boolean).join(' ');
}

function hardGateTikTokRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const sourceUrl = sourceUrlFromRow(row);
  const sourceText = sourceTextFromRow(row);
  const phone = normalizeUgandanPhone(row.lister_phone || extra.contact_phone || extra.source_phone || extra.whatsapp || '');
  const reasons = [];

  if (!TIKTOK_EXACT_VIDEO_URL_PATTERN.test(sourceUrl)) reasons.push('missing_exact_tiktok_video_url');
  if (!sourceDateIsConfirmed2026(row)) reasons.push('missing_confirmed_2026_source_date');
  if (!phone) reasons.push('missing_source_phone_number');
  if (!locationIsSpecific(row)) reasons.push('missing_specific_area_and_district');
  if (!knownListingType(row.listing_type)) reasons.push('unclear_listing_type');
  if (sourceText.length < 25) reasons.push('missing_caption_transcript_or_visual_text');
  if (Number(row.duplicate_count || 0) > 0) reasons.push('duplicate_source_or_contact_location_match');

  return {
    eligible: reasons.length === 0,
    reasons,
    source_url: sourceUrl,
    phone,
    source_date: sourcePostedAtFromRow(row),
    title: titleForApprovedTikTok(row),
    description: descriptionForApprovedTikTok(row),
    location: [cleanText(row.area), cleanText(row.district)].filter(Boolean).join(', '),
    source_text_length: sourceText.length,
    consent_confirmed: Boolean(extra.consent_confirmed),
    image_rights_confirmed: Boolean(extra.image_rights_confirmed),
  };
}

async function countTikTokReviewQueue(client) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM properties p
     WHERE p.source IN ($1, $2)
       AND LOWER(COALESCE(p.status, p.moderation_stage, '')) = ANY($3::text[])
       AND LOWER(COALESCE(p.extra_fields->>'source_platform', '')) = 'tiktok'`,
    [SOCIAL_SEARCH_SOURCE, LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE, REVIEW_STATUSES]
  );
  return Number(result.rows[0]?.total || 0);
}

async function loadTikTokCandidates(client, limit) {
  const result = await client.query(
    `WITH pending_tiktok AS (
       SELECT
         p.id::text AS id,
         p.title,
         p.description,
         p.listing_type,
         p.property_type,
         p.district,
         p.area,
         p.address,
         p.price,
         p.price_period,
         p.bedrooms,
         p.bathrooms,
         p.lister_name,
         p.lister_phone,
         p.lister_email,
         p.status,
         p.moderation_stage,
         p.source,
         p.listed_via,
         p.created_at,
         p.updated_at,
         COALESCE(p.extra_fields, '{}'::jsonb) AS extra_fields,
         COALESCE(p.extra_fields->>'source_post_url', p.extra_fields->>'source_url', p.extra_fields->>'tiktok_url', '') AS source_url
       FROM properties p
       WHERE p.source IN ($1, $2)
         AND LOWER(COALESCE(p.status, p.moderation_stage, '')) = ANY($3::text[])
         AND LOWER(COALESCE(p.extra_fields->>'source_platform', '')) = 'tiktok'
         AND COALESCE(p.extra_fields->>'source_post_url', p.extra_fields->>'source_url', p.extra_fields->>'tiktok_url', '') ~* $4
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $5
     )
     SELECT
       p.*,
       (
         SELECT COUNT(*)::int
         FROM properties d
         WHERE d.id::text <> p.id
           AND COALESCE(d.status, '') <> 'deleted'
           AND (
             COALESCE(d.extra_fields->>'source_post_url', d.extra_fields->>'source_url', d.extra_fields->>'tiktok_url', '') = p.source_url
             OR (
               REGEXP_REPLACE(COALESCE(d.lister_phone, d.extra_fields->>'contact_phone', ''), '\\D', '', 'g') <> ''
               AND REGEXP_REPLACE(COALESCE(d.lister_phone, d.extra_fields->>'contact_phone', ''), '\\D', '', 'g')
                 = REGEXP_REPLACE(COALESCE(p.lister_phone, p.extra_fields->>'contact_phone', ''), '\\D', '', 'g')
               AND LOWER(COALESCE(d.area, '')) = LOWER(COALESCE(p.area, ''))
               AND LOWER(COALESCE(d.district, '')) = LOWER(COALESCE(p.district, ''))
               AND LOWER(COALESCE(d.status, d.moderation_stage, '')) = ANY($6::text[])
             )
           )
       ) AS duplicate_count
     FROM pending_tiktok p`,
    [
      SOCIAL_SEARCH_SOURCE,
      LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE,
      REVIEW_STATUSES,
      'tiktok\\.com/@[^/]+/video/[0-9]+',
      limit,
      LIVE_STATUSES,
    ]
  );
  return result.rows;
}

async function publishTikTokCandidate(client, row, decision, { dryRun = false } = {}) {
  if (dryRun) {
    return {
      id: row.id,
      title: decision.title,
      source_url: decision.source_url,
      location: decision.location,
      dry_run: true,
    };
  }

  const extraPatch = {
    tiktok_ai_agent: {
      status: 'approved_live',
      approved_at: new Date().toISOString(),
      actor: AGENT_ACTOR_ID,
      source_url: decision.source_url,
      source_date: decision.source_date,
      source_date_method: 'stored_platform_date_or_tiktok_video_id_timestamp',
      source_text_length: decision.source_text_length,
      checks: {
        exact_tiktok_video_url: true,
        source_date_2026_plus: true,
        phone_number_present: true,
        specific_location_present: true,
        listing_type_clear: true,
        duplicate_safe: true,
      },
    },
    found_online_location_confirmed: true,
    found_online_approval_policy: 'tiktok_ai_agent_exact_post_2026_phone_location_duplicate_gate',
    found_online_non_location_checks_overridden: false,
  };

  const result = await client.query(
    `UPDATE properties
     SET title = $2,
         description = $3,
         status = 'approved',
         moderation_stage = 'approved',
         reviewed_at = NOW(),
         approved_at = COALESCE(approved_at, NOW()),
         moderation_reason = $4,
         moderation_notes = $5,
         extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $6::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id::text AS id, title, status, moderation_stage, approved_at`,
    [
      row.id,
      decision.title,
      decision.description,
      'TikTok AI autopublish agent approved only after exact URL, 2026 date, phone, specific location, listing type, source text, and duplicate checks passed.',
      `Autopublished from exact TikTok source: ${decision.source_url}`,
      JSON.stringify(extraPatch),
    ]
  );

  await client.query(
    `INSERT INTO property_moderation_events (
       property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
     ) VALUES ($1, $2, $3, $4, 'approved', $5::jsonb, $6, $7, $8::jsonb)`,
    [
      row.id,
      AGENT_ACTOR_ID,
      'tiktok_ai_autopublish_agent_approved',
      row.status || row.moderation_stage || 'pending',
      JSON.stringify({
        exact_tiktok_video_url: true,
        confirmed_2026_source_date: true,
        phone_number_present: true,
        specific_location_present: true,
        listing_type_clear: true,
        duplicate_safe: true,
      }),
      'AI agent approved a high-confidence TikTok property source.',
      decision.description,
      JSON.stringify({
        source_url: decision.source_url,
        source_date: decision.source_date,
        location: decision.location,
        phone_present: Boolean(decision.phone),
      }),
    ]
  );

  return {
    id: result.rows[0]?.id || row.id,
    title: result.rows[0]?.title || decision.title,
    status: result.rows[0]?.status || 'approved',
    moderation_stage: result.rows[0]?.moderation_stage || 'approved',
    property_url: `/property/${result.rows[0]?.id || row.id}`,
    source_url: decision.source_url,
    location: decision.location,
    approved_at: result.rows[0]?.approved_at || null,
  };
}

async function markReadyReviewDecision(client, row, decision, { dryRun = false } = {}) {
  const payload = {
    status: 'ready_review',
    reviewed_at: new Date().toISOString(),
    actor: AGENT_ACTOR_ID,
    source_url: decision.source_url,
    reasons: decision.reasons,
  };

  if (!dryRun) {
    await client.query(
      `UPDATE properties
       SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object('tiktok_ai_agent', $2::jsonb),
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, JSON.stringify(payload)]
    );
  }

  return {
    id: row.id,
    title: row.title,
    source_url: decision.source_url,
    location: decision.location,
    reasons: decision.reasons,
    review_url: `/admin/property-review/${row.id}`,
  };
}

async function runTikTokAutopublishAgent({
  db,
  hashtag = DEFAULT_HASHTAG,
  liveLimit = DEFAULT_LIVE_LIMIT,
  reviewLimit = DEFAULT_REVIEW_LIMIT,
  scanLimit = MAX_SCAN_LIMIT,
  dryRun = true,
  confirmLive = false,
  posts = [],
  urls = [],
  rawText = '',
  fetchOembed = true,
} = {}) {
  if (!db?.pool) throw new Error('db.pool is required');

  const normalizedHashtag = normalizeHashtag(hashtag);
  const maxLive = safeLimit(liveLimit, DEFAULT_LIVE_LIMIT, 1, 25);
  const maxReview = safeLimit(reviewLimit, DEFAULT_REVIEW_LIMIT, 1, 500);
  const maxScan = safeLimit(scanLimit, MAX_SCAN_LIMIT, maxLive, 500);
  const hasExactInput = (Array.isArray(posts) && posts.length)
    || (Array.isArray(urls) && urls.length)
    || cleanText(rawText);

  if (!dryRun && !confirmLive) {
    return {
      ok: false,
      dry_run: false,
      error: 'confirm_live_required',
      message: 'Set confirm_live=true to let the TikTok AI agent publish passing listings.',
    };
  }

  const client = await db.pool.connect();
  try {
    const reviewQueueBefore = await countTikTokReviewQueue(client);
    const reviewSlotsAvailable = Math.max(0, maxReview - reviewQueueBefore);
    let importResult = null;

    if (hasExactInput && reviewSlotsAvailable > 0) {
      importResult = await importTikTokExactVideoPosts({
        db,
        posts: Array.isArray(posts) ? posts.slice(0, reviewSlotsAvailable) : [],
        urls: Array.isArray(urls) ? urls.slice(0, reviewSlotsAvailable) : [],
        rawText,
        dryRun,
        fetchOembed,
      });
    }

    const candidates = await loadTikTokCandidates(client, maxScan);
    const published = [];
    const readyReview = [];
    const blocked = [];

    await client.query('BEGIN');
    try {
      for (const row of candidates) {
        const decision = hardGateTikTokRow(row);
        if (decision.eligible && published.length < maxLive) {
          published.push(await publishTikTokCandidate(client, row, decision, { dryRun }));
        } else {
          const reviewItem = await markReadyReviewDecision(client, row, decision, { dryRun });
          if (readyReview.length < maxReview) readyReview.push(reviewItem);
          else blocked.push({ ...reviewItem, reasons: ['review_queue_cap_reached', ...reviewItem.reasons] });
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const reviewQueueAfter = dryRun ? reviewQueueBefore : await countTikTokReviewQueue(client);
    const captureTask = {
      platform: 'tiktok',
      hashtag: `#${normalizedHashtag}`,
      source_url: `https://www.tiktok.com/tag/${normalizedHashtag}`,
      exact_video_url_required: true,
      exact_video_url_pattern: TIKTOK_EXACT_VIDEO_URL_PATTERN.source,
      reason: 'TikTok hashtag feeds are discovery surfaces; the agent can only import/publish exact /@handle/video/id posts with captured source evidence.',
    };

    return {
      ok: true,
      dry_run: dryRun,
      hashtag: `#${normalizedHashtag}`,
      policy: {
        publish_gate: [
          'exact TikTok video URL',
          'source platform date confirmed on or after 2026-01-01',
          'Ugandan phone number present',
          'specific area and district present',
          'listing type is clear',
          'caption/transcript/visual text evidence present',
          'no exact-source or live contact/location duplicate',
        ],
        review_queue_cap: maxReview,
        live_limit: maxLive,
      },
      review_queue_before: reviewQueueBefore,
      review_slots_available: reviewSlotsAvailable,
      review_queue_after: reviewQueueAfter,
      exact_input_received: Boolean(hasExactInput),
      import_result: importResult,
      scanned_candidates: candidates.length,
      published_live_count: published.length,
      ready_review_count: readyReview.length,
      blocked_count: blocked.length,
      published_live: published,
      ready_review: readyReview,
      blocked,
      capture_task: captureTask,
      not_100_percent_reason: published.length < maxLive
        ? `Only ${published.length} TikTok records passed all live-publish gates. Need ${maxLive}.`
        : '',
    };
  } finally {
    client.release();
  }
}

module.exports = {
  AGENT_ACTOR_ID,
  DEFAULT_HASHTAG,
  DEFAULT_LIVE_LIMIT,
  DEFAULT_REVIEW_LIMIT,
  REVIEW_STATUSES,
  LIVE_STATUSES,
  hardGateTikTokRow,
  normalizeHashtag,
  runTikTokAutopublishAgent,
};
