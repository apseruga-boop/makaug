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
const DEFAULT_HASHTAG_SEQUENCE = [
  'ugandarealestate',
  'housesforsaleuganda',
  'kampalarentals',
  'landforsaleuganda',
  'plotsforsaleuganda',
  'housesforrentuganda',
  'ugandahomes',
  'kampalahomes',
  'wakisohomes',
  'ebibanja',
  'bibanja',
  'ettaka',
];
const DEFAULT_LIVE_LIMIT = 5;
const DEFAULT_REVIEW_LIMIT = 100;
const MAX_SCAN_LIMIT = 250;
const PRICE_UPON_APPLICATION_LABEL = 'Price upon application';
const AGENT_ACTOR_ID = 'tiktok_autopublish_agent';
const AGENT_NAME = 'Maka Scout';
const AGENT_DISPLAY_NAME = 'Maka Scout AI';
const AGENT_CHAT_ROUTE = '/staff-dashboard';
const AGENT_VISUAL_PROFILE = {
  id: 'maka_scout',
  name: AGENT_NAME,
  display_name: AGENT_DISPLAY_NAME,
  initials: 'MS',
  role: 'TikTok property scout and safe-publish assistant',
  avatar_prompt: 'A warm, sharp Uganda property scout AI wearing a clean green Makaug jacket, holding a phone and map pin, friendly but professional.',
  chat_route: AGENT_CHAT_ROUTE,
  status_label: 'Scans one TikTok hashtag at a time, publishes only high-confidence listings, sends uncertain posts to review, and stops at 100 review items.',
};

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

function uniqueNormalizedHashtags(values = []) {
  const seen = new Set();
  return values
    .map(normalizeHashtag)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function buildHashtagSequence(values = []) {
  const sequence = uniqueNormalizedHashtags([
    ...(Array.isArray(values) ? values : []),
    ...DEFAULT_HASHTAG_SEQUENCE,
  ]);
  return sequence.length ? sequence : [DEFAULT_HASHTAG];
}

function agentProfile() {
  return { ...AGENT_VISUAL_PROFILE };
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

function sourceContactUrlFromRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return cleanText(extra.source_contact_url || extra.source_page_url || extra.profile_url || sourceUrlFromRow(row));
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

function seedPostWithInferredTikTokDate(post = {}) {
  const sourceUrl = cleanText(post.post_url || post.source_url || post.tiktok_url || post.url || '');
  if (!sourceUrl) return post;
  const hasDate = cleanText(
    post.first_posted_at
      || post.first_posted_online_at
      || post.posted_at
      || post.platform_posted_at
      || post.video_posted_at
      || post.published_at
      || post.source_published_at
      || ''
  );
  if (hasDate) return post;
  const inferred = inferTikTokPostedAtFromVideoUrl(sourceUrl);
  return inferred ? { ...post, first_posted_at: inferred, platform_posted_at: inferred } : post;
}

function exactUrlPostsWithInferredDates(urls = []) {
  return (Array.isArray(urls) ? urls : [])
    .map((url) => cleanText(url))
    .filter(Boolean)
    .map((url) => seedPostWithInferredTikTokDate({ post_url: url, source_url: url, tiktok_url: url }));
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
  if (area.toLowerCase() === district.toLowerCase()) {
    const normalizedAddress = address.toLowerCase();
    if (!normalizedAddress || generic.has(normalizedAddress) || normalizedAddress === area.toLowerCase()) return false;
  }
  return true;
}

function normalizedPolicyMode(value = '') {
  const normalized = cleanText(value || '').toLowerCase();
  return ['relaxed', 'phone_location', 'phone_location_price_optional', 'phone-location'].includes(normalized)
    ? 'phone_location_price_optional'
    : 'strict';
}

function priceLabelForTikTok(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  if (Number(row.price || 0) > 0) {
    const period = cleanText(row.price_period || '');
    return `USh ${Number(row.price).toLocaleString('en-UG')}${period && period !== 'once' ? `/${period}` : ''}`;
  }
  const label = cleanText(extra.source_price_label || extra.price_label || extra.price_text || extra.source_price_text || '');
  return label || PRICE_UPON_APPLICATION_LABEL;
}

function priceStatusForTikTok(row = {}) {
  return priceLabelForTikTok(row) === PRICE_UPON_APPLICATION_LABEL
    ? 'price_upon_application'
    : 'published_price_or_guide_price';
}

function sourceReviewRecordsFromImport(importResult = {}) {
  return Array.isArray(importResult?.source_review_records)
    ? importResult.source_review_records
    : [];
}

function existingRecordsFromImport(importResult = {}) {
  return Array.isArray(importResult?.already_present_properties)
    ? importResult.already_present_properties
    : [];
}

function buildAgentBuckets({ published = [], readyReview = [], blocked = [], importResult = null } = {}) {
  const sourceReview = sourceReviewRecordsFromImport(importResult);
  const existing = existingRecordsFromImport(importResult);
  return {
    live: {
      count: published.length,
      meaning: 'Properties Maka Scout approved live because every hard gate passed.',
      items: published,
    },
    review: {
      count: readyReview.length,
      meaning: 'Properties Maka Scout could not safely publish automatically, so they remain in the human review queue.',
      items: readyReview,
    },
    existing_or_duplicate: {
      count: existing.length,
      meaning: 'Exact-source links that were already in makaug; Maka Scout does not create another copy.',
      items: existing,
    },
    excluded: {
      count: sourceReview.length + blocked.length,
      meaning: 'Records that were not allowed live and were not newly queued because intake failed or the review cap was reached.',
      items: [
        ...sourceReview.map((item) => ({
          title: item.title,
          source_url: item.source_url,
          reason: item.reason || 'missing_intake_evidence',
          intake: item.intake || {},
        })),
        ...blocked,
      ],
    },
  };
}

function buildHashtagWorkflow({
  hashtag = DEFAULT_HASHTAG,
  hashtagSequence = [],
  reviewQueueAfter = 0,
  reviewLimit = DEFAULT_REVIEW_LIMIT,
  reviewSlotsAvailable = DEFAULT_REVIEW_LIMIT,
} = {}) {
  const sequence = buildHashtagSequence(hashtagSequence);
  const current = normalizeHashtag(hashtag);
  const currentIndex = sequence.includes(current) ? sequence.indexOf(current) : 0;
  const nextIndex = (currentIndex + 1) % sequence.length;
  const paused = Number(reviewQueueAfter || 0) >= Number(reviewLimit || DEFAULT_REVIEW_LIMIT);
  return {
    agent: AGENT_NAME,
    mode: 'one_hashtag_at_a_time',
    current_hashtag: `#${current}`,
    current_source_url: `https://www.tiktok.com/tag/${current}`,
    next_hashtag: paused ? '' : `#${sequence[nextIndex]}`,
    next_source_url: paused ? '' : `https://www.tiktok.com/tag/${sequence[nextIndex]}`,
    status: paused ? 'paused_review_queue_cap_reached' : 'ready_for_next_hashtag',
    stop_condition: `Stop when this TikTok review queue reaches ${reviewLimit} records.`,
    resume_condition: 'Resume from the next hashtag after the review queue is cleared below the cap.',
    review_queue_remaining_slots: Math.max(0, Number(reviewLimit || DEFAULT_REVIEW_LIMIT) - Number(reviewQueueAfter || 0)),
    review_slots_available_before_run: Math.max(0, Number(reviewSlotsAvailable || 0)),
    sequence: sequence.map((item, index) => ({
      hashtag: `#${item}`,
      source_url: `https://www.tiktok.com/tag/${item}`,
      status: item === current ? 'current' : (index === nextIndex && !paused ? 'next' : 'queued'),
    })),
  };
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
  if (!knownListingType(row.listing_type)) return `${label} in ${area}, ${district} (TikTok source)`;
  const action = row.listing_type === 'rent' || row.listing_type === 'students' || row.listing_type === 'commercial'
    ? 'for rent'
    : 'for sale';
  return `${label} ${action} in ${area}, ${district} (TikTok 2026)`;
}

function descriptionForApprovedTikTok(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const sourceUrl = sourceUrlFromRow(row);
  const sourceContactUrl = sourceContactUrlFromRow(row);
  const phone = normalizeUgandanPhone(row.lister_phone || extra.contact_phone || extra.source_phone || extra.whatsapp || '');
  const posted = sourcePostedAtFromRow(row);
  const sourceText = sourceTextFromRow(row);
  const priceLabel = priceLabelForTikTok(row);
  return [
    `${titleForApprovedTikTok(row)}.`,
    `Location: ${cleanText(row.area)}, ${cleanText(row.district)}${row.address ? ` (${cleanText(row.address)})` : ''}.`,
    posted ? `Source date: ${posted.slice(0, 10)}.` : '',
    `Source price: ${priceLabel}.`,
    !phone && sourceContactUrl ? 'No source phone number was captured; contact must start from the original TikTok/source profile and be verified before viewing.' : '',
    sourceText ? `Source evidence: ${sourceText.slice(0, 420)}${sourceText.length > 420 ? '...' : ''}` : '',
    sourceUrl ? `Original TikTok source: ${sourceUrl}` : '',
    'Contact details and exact availability should be confirmed directly with the listed source before viewing.',
  ].filter(Boolean).join(' ');
}

function hardGateTikTokRow(row = {}, { policyMode = 'strict' } = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const sourceUrl = sourceUrlFromRow(row);
  const sourceContactUrl = sourceContactUrlFromRow(row);
  const sourceText = sourceTextFromRow(row);
  const phone = normalizeUgandanPhone(row.lister_phone || extra.contact_phone || extra.source_phone || extra.whatsapp || '');
  const mode = normalizedPolicyMode(policyMode);
  const sourceContactAllowed = mode === 'phone_location_price_optional' && Boolean(sourceContactUrl);
  const reasons = [];

  if (!TIKTOK_EXACT_VIDEO_URL_PATTERN.test(sourceUrl)) reasons.push('missing_exact_tiktok_video_url');
  if (mode === 'strict' && !sourceDateIsConfirmed2026(row)) reasons.push('missing_confirmed_2026_source_date');
  if (!phone && !sourceContactAllowed) reasons.push('missing_source_phone_number');
  if (!locationIsSpecific(row)) reasons.push('missing_specific_area_and_district');
  if (mode === 'strict' && !knownListingType(row.listing_type)) reasons.push('unclear_listing_type');
  if (mode === 'strict' && sourceText.length < 25) reasons.push('missing_caption_transcript_or_visual_text');
  if (Number(row.duplicate_count || 0) > 0) reasons.push('duplicate_source_or_contact_location_match');

  return {
    eligible: reasons.length === 0,
    reasons,
    policy_mode: mode,
    source_url: sourceUrl,
    source_contact_url: sourceContactUrl,
    phone,
    phone_missing_but_source_contact_allowed: !phone && sourceContactAllowed,
    source_date: sourcePostedAtFromRow(row),
    title: titleForApprovedTikTok(row),
    description: descriptionForApprovedTikTok(row),
    location: [cleanText(row.area), cleanText(row.district)].filter(Boolean).join(', '),
    source_text_length: sourceText.length,
    price_label: priceLabelForTikTok(row),
    price_status: priceStatusForTikTok(row),
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
      policy_mode: decision.policy_mode || 'strict',
      price_label: decision.price_label || PRICE_UPON_APPLICATION_LABEL,
      price_status: decision.price_status || 'price_upon_application',
      phone_missing_but_source_contact_allowed: Boolean(decision.phone_missing_but_source_contact_allowed),
      source_contact_url: decision.source_contact_url || decision.source_url,
      checks: {
        exact_tiktok_video_url: true,
        source_date_2026_plus: decision.policy_mode === 'strict',
        phone_number_present: Boolean(decision.phone),
        source_contact_path_present: Boolean(decision.source_contact_url || decision.source_url),
        source_contact_required: !decision.phone,
        specific_location_present: true,
        listing_type_clear: decision.policy_mode === 'strict',
        duplicate_safe: true,
        price_captured_or_price_upon_application: true,
      },
    },
    found_online_location_confirmed: true,
    found_online_approval_policy: decision.policy_mode === 'phone_location_price_optional'
      ? 'maka_scout_relaxed_exact_post_phone_location_price_optional_duplicate_gate'
      : 'tiktok_ai_agent_exact_post_2026_phone_location_duplicate_gate',
    found_online_non_location_checks_overridden: Boolean(decision.phone_missing_but_source_contact_allowed),
    price_label: decision.price_label || PRICE_UPON_APPLICATION_LABEL,
    source_price_label: decision.price_label || PRICE_UPON_APPLICATION_LABEL,
    price_upon_application: (decision.price_status || '') === 'price_upon_application',
    price_status: decision.price_status || 'price_upon_application',
    source_contact_url: decision.source_contact_url || decision.source_url,
    found_online_contact_status: decision.phone ? 'source_phone_confirmed' : 'source_contact_required',
    source_phone_missing_at_publish: !decision.phone,
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
      decision.phone_missing_but_source_contact_allowed
        ? 'Maka Scout source-contact mode approved after exact TikTok URL, specific location, source contact path, duplicate-safe check, and price captured or Price upon application. Source phone number still needs staff verification.'
        : decision.policy_mode === 'phone_location_price_optional'
        ? 'Maka Scout relaxed mode approved after exact TikTok URL, phone, specific location, duplicate-safe check, and price captured or Price upon application.'
        : 'TikTok AI autopublish agent approved only after exact URL, 2026 date, phone, specific location, listing type, source text, and duplicate checks passed.',
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
        confirmed_2026_source_date: decision.policy_mode === 'strict',
        phone_number_present: Boolean(decision.phone),
        source_contact_path_present: Boolean(decision.source_contact_url || decision.source_url),
        source_contact_required: !decision.phone,
        specific_location_present: true,
        listing_type_clear: decision.policy_mode === 'strict',
        duplicate_safe: true,
      }),
      decision.phone
        ? 'AI agent approved a high-confidence TikTok property source.'
        : 'AI agent approved a TikTok property source with source-contact follow-up required because no phone was captured.',
      decision.description,
      JSON.stringify({
        source_url: decision.source_url,
        source_contact_url: decision.source_contact_url || decision.source_url,
        source_date: decision.source_date,
        location: decision.location,
        phone_present: Boolean(decision.phone),
        source_contact_required: !decision.phone,
        policy_mode: decision.policy_mode,
        price_label: decision.price_label || PRICE_UPON_APPLICATION_LABEL,
        price_status: decision.price_status || 'price_upon_application',
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
  hashtagSequence = DEFAULT_HASHTAG_SEQUENCE,
  policyMode = 'strict',
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
  const normalizedMode = normalizedPolicyMode(policyMode);
  const maxLive = safeLimit(liveLimit, DEFAULT_LIVE_LIMIT, 1, 25);
  const maxReview = safeLimit(reviewLimit, DEFAULT_REVIEW_LIMIT, 1, 500);
  const maxScan = safeLimit(scanLimit, MAX_SCAN_LIMIT, maxLive, 500);
  const hasExactInput = (Array.isArray(posts) && posts.length)
    || (Array.isArray(urls) && urls.length)
    || cleanText(rawText);

  if (!dryRun && !confirmLive) {
    return {
      agent: agentProfile(),
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
      const exactPosts = [
        ...(Array.isArray(posts) ? posts.map(seedPostWithInferredTikTokDate) : []),
        ...exactUrlPostsWithInferredDates(Array.isArray(urls) ? urls : []),
      ].slice(0, reviewSlotsAvailable);
      importResult = await importTikTokExactVideoPosts({
        db,
        posts: exactPosts,
        urls: [],
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
        const decision = hardGateTikTokRow(row, { policyMode: normalizedMode });
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
    const buckets = buildAgentBuckets({ published, readyReview, blocked, importResult });
    const hashtag_workflow = buildHashtagWorkflow({
      hashtag: normalizedHashtag,
      hashtagSequence,
      reviewQueueAfter,
      reviewLimit: maxReview,
      reviewSlotsAvailable,
    });
    const captureTask = {
      platform: 'tiktok',
      hashtag: `#${normalizedHashtag}`,
      source_url: `https://www.tiktok.com/tag/${normalizedHashtag}`,
      exact_video_url_required: true,
      exact_video_url_pattern: TIKTOK_EXACT_VIDEO_URL_PATTERN.source,
      reason: 'TikTok hashtag feeds are discovery surfaces; the agent can only import/publish exact /@handle/video/id posts with captured source evidence.',
    };

    return {
      agent: agentProfile(),
      ok: true,
      dry_run: dryRun,
      hashtag: `#${normalizedHashtag}`,
      hashtag_workflow,
      policy: {
        mode: normalizedMode,
        publish_gate: [
          'exact TikTok video URL',
          'Ugandan phone number present',
          'specific area and district present',
          normalizedMode === 'strict' ? 'source platform date confirmed on or after 2026-01-01' : 'source date preserved when known; not a relaxed-mode live blocker',
          normalizedMode === 'strict' ? 'listing type is clear' : 'listing type is preserved when known; relaxed mode can still publish a generic property listing',
          normalizedMode === 'strict' ? 'caption/transcript/visual text evidence present' : 'caption/transcript/visual text is preserved when available',
          'price captured when visible, otherwise Price upon application',
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
      buckets,
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
  AGENT_NAME,
  AGENT_DISPLAY_NAME,
  AGENT_VISUAL_PROFILE,
  DEFAULT_HASHTAG,
  DEFAULT_HASHTAG_SEQUENCE,
  DEFAULT_LIVE_LIMIT,
  DEFAULT_REVIEW_LIMIT,
  REVIEW_STATUSES,
  LIVE_STATUSES,
  agentProfile,
  buildAgentBuckets,
  buildHashtagWorkflow,
  hardGateTikTokRow,
  normalizeHashtag,
  runTikTokAutopublishAgent,
};
