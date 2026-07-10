const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const { cleanText } = require('../middleware/validation');
const { parsePagination, toPagination } = require('../utils/pagination');
const { DISTRICTS, LISTING_TYPES } = require('../utils/constants');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const {
  districtForKnownArea,
  normalizeReviewLocationHierarchy,
  regionForDistrict
} = require('../utils/ugandaLocationHierarchy');
const { addLeadActivity } = require('../services/leadService');
const { buildAutomatedListingReview } = require('../services/listingModerationService');
const { getCachedExternalDuplicateScan } = require('../services/externalDuplicateScanService');
const { getProviderClient, getProviderMeta, getTaskModel } = require('../services/llmProvider');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  importExactSocialSourcePosts,
  runSocialPlatformPostSweep
} = require('../services/socialPlatformPostDiscoveryService');
const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  PROPERTY_SOURCE_REGISTRY_TARGET_COUNT
} = require('../services/propertySourceRegistryService');
const {
  sourceQualitySuppressionForRecord,
  sourceQualitySuppressedSql
} = require('../utils/sourceContentQuality');

const router = express.Router();

router.use(requireStaffAccess);

const PENDING_REVIEW_STATUSES = ['pending', 'pending_review', 'submitted', 'in_review', 'under_review'];
const FINAL_REVIEW_STATUSES = ['approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'declined', 'fraud', 'archived'];
const STAFF_REMOVED_STATUSES = ['deleted', 'rejected', 'declined', 'fraud', 'archived', 'test_pending_review'];
const OPEN_LEAD_STATUSES = ['open', 'new', 'contacted', 'qualified'];
const OPEN_AD_STATUSES = ['new', 'contacted', 'proposal_sent'];
const STAFF_CONTACT_EXPORT_LIMIT = 50;
const STAFF_DASHBOARD_QUEUE_LIMIT = 12;
const STAFF_DASHBOARD_PANEL_LIMIT = 8;
const STAFF_DASHBOARD_QUEUE_SCAN_LIMIT = STAFF_DASHBOARD_QUEUE_LIMIT * 20;
const STAFF_DASHBOARD_PANEL_SCAN_LIMIT = STAFF_DASHBOARD_PANEL_LIMIT * 20;
const STAFF_EXACT_SOCIAL_IMPORT_LIMIT = 500;
const STAFF_FAST_DASHBOARD_CACHE_TTL_MS = Math.max(5000, parseInt(process.env.STAFF_FAST_DASHBOARD_CACHE_TTL_MS || '60000', 10) || 60000);
const STAFF_SOURCE_INTAKE_JOB_TTL_MS = Math.max(300000, parseInt(process.env.STAFF_SOURCE_INTAKE_JOB_TTL_MS || '3600000', 10) || 3600000);
const STAFF_SOURCE_INTAKE_JOB_LIMIT = Math.max(10, parseInt(process.env.STAFF_SOURCE_INTAKE_JOB_LIMIT || '50', 10) || 50);
const STAFF_SOCIAL_SWEEP_SOURCE_LIMIT = Math.max(15, parseInt(process.env.STAFF_SOCIAL_SWEEP_SOURCE_LIMIT || '160', 10) || 160);
const STAFF_SOCIAL_SWEEP_RESULT_LIMIT = Math.max(10, parseInt(process.env.STAFF_SOCIAL_SWEEP_RESULT_LIMIT || '50', 10) || 50);
const STAFF_SOCIAL_SWEEP_PAGE_LIMIT = Math.max(1, parseInt(process.env.STAFF_SOCIAL_SWEEP_PAGE_LIMIT || '6', 10) || 6);
const EXACT_SOCIAL_URL_PATTERN = /https?:\/\/[^\s<>"']*(?:tiktok\.com\/@[^/\s?#]+\/video\/\d+|youtube\.com\/watch\?[^ \n\r\t<>"']*v=|youtube\.com\/shorts\/|youtu\.be\/|instagram\.com\/(?:p|reel|tv)\/|facebook\.com\/.+\/(?:posts|videos|reel)|fb\.watch\/|(?:x|twitter)\.com\/[^/\s?#]+\/status\/\d+)/ig;
const PUBLIC_SUPPRESSED_LISTING_MARKERS = ['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'];
const PUBLIC_SUPPRESSED_DUMMY_TITLES = ['sdgsdgd', 'sgsgsgsgs'];
const STAFF_SOURCE_PRESETS = [
  { label: 'Kampala rentals', value: '#KampalaRentals #HouseForRentUganda #KampalaApartments', language: 'English' },
  { label: 'Student rooms', value: '#MakerereHostel #KyambogoHostel #StudentHostelUganda #RoomsNearCampus', language: 'English' },
  { label: 'Land / plots', value: '#LandForSaleUganda #PlotsForSaleUganda #Ekibanja #Ettaka', language: 'English + Luganda' },
  { label: 'Luganda homes', value: '#Ennyumba #Obupangisa #Amayumba #Muzigo #KampalaRent', language: 'Luganda' },
  { label: 'Swahili homes', value: '#NyumbaUganda #NyumbaYaKupanga #ViwanjaUganda #KodiKampala', language: 'Kiswahili' },
  { label: 'Wakiso growth', value: '#Nansana #Kira #Namugongo #Gayaza #WakisoHomes #WakisoRentals', language: 'Local areas' }
];
const STAFF_SOURCE_MONITOR_GUIDE = {
  title: 'Continuous source monitor',
  status: 'Ready for Render Cron Job and Render Shell trigger',
  dry_run_command: 'npm run inventory:continuous-monitor -- --dry-run',
  confirm_command: 'npm run inventory:continuous-monitor -- --confirm --platforms=youtube,x --youtube-job-mode=channel_uploads --max-sources=15 --max-results=25 --max-pages=1',
  deep_channel_command: 'npm run inventory:sweep-social-platforms -- --platform=youtube --confirm --youtube-job-mode=channel_uploads --published-after=2026-01-01T00:00:00.000Z --max-sources=80 --max-results=50 --max-pages=6',
  broad_search_command: 'npm run inventory:sweep-social-platforms -- --platform=youtube --confirm --youtube-job-mode=search --published-after=2026-01-01T00:00:00.000Z --max-sources=20 --max-results=10 --max-pages=1',
  daily_registry_command: 'npm run inventory:daily-source-sweep -- --confirm',
  high_frequency_cadence: 'Every 10-15 minutes: safe known-channel uploads plus X recent search.',
  deep_channel_cadence: 'Every 1-2 hours: deeper known-channel upload scans for agency sources that post heavily.',
  broad_search_cadence: 'Every 2-4 hours: broader hashtag/search discovery in small batches so YouTube Search quota is protected.',
  daily_registry_cadence: 'Once daily: refresh the source registry and review baseline.',
  render_trigger_path: 'Render Dashboard > project > New > Cron Job, or web service Shell for a one-off run.',
  published_after: '2026-01-01T00:00:00.000Z',
  source_registry_batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  source_registry_target_count: PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
  social_platform_batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  audit_log_action: 'continuous_social_monitor_run',
  auto_live_rule: 'Auto-live only when the source is dated from 2026 onward, location is strong, category is clear, source/contact evidence exists, and duplicate checks pass. Phone number is optional when the source contact path is usable.',
  review_rule: 'If location, category, date, source evidence, or duplicate confidence is weak, the row stays in King/staff review.',
  board_update: 'Staff see the same queue, source registry, cadence, commands, and rules in this dashboard before running any source work.'
};
const staffFastDashboardCache = new Map();
const staffFastDashboardRefreshes = new Map();
const staffSourceIntakeJobs = new Map();

function activeStaffSourceIntakeJob(type = '') {
  const targetType = cleanText(type);
  const activeStatuses = new Set(['queued', 'running']);
  return [...staffSourceIntakeJobs.values()]
    .filter((job) => activeStatuses.has(job.status))
    .find((job) => !targetType || job.type === targetType) || null;
}

function publicStaffSourceIntakeJob(job = {}) {
  const result = job.result && typeof job.result === 'object' ? job.result : {};
  const importResult = result.import_result && typeof result.import_result === 'object' ? result.import_result : result;
  const backlogResult = result.pending_backlog_reprocess_result
    || result.youtube?.pending_backlog_reprocess
    || {};
  const backlogReprocess = backlogResult.reprocess_result || {};
  return {
    async_job: true,
    job_id: job.id || '',
    type: job.type || 'source_intake',
    status: job.status || 'queued',
    created_at: job.createdAt || null,
    started_at: job.startedAt || null,
    finished_at: job.finishedAt || null,
    exact_input_count: job.exactInputCount || result.exact_input_count || 0,
    requested_source_count: job.requestedSourceCount || result.requested_source_count || 0,
    dry_run: job.dryRun === true,
    message: job.message || '',
    error: job.error || '',
    result: job.status === 'completed' ? result : undefined,
    result_summary: job.status === 'completed' ? {
      discovered_posts_count: Number(result.discovered_posts_count || 0),
      auto_live_properties: Number(importResult.auto_live_properties || result.auto_live_properties || 0),
      created_properties: Number(importResult.created_properties || result.created_properties || 0),
      existing_properties: Number(importResult.existing_properties || result.existing_properties || 0),
      review_queue_properties: Number(importResult.review_queue_properties || result.review_queue_properties || 0),
      source_review_count: Number(importResult.source_review_count || result.source_review_count || 0),
      low_signal_source_location_count: Number(importResult.low_signal_source_location_count || result.low_signal_source_location_count || 0),
      source_quality_suppressed_count: Number(importResult.source_quality_suppressed_count || result.source_quality_suppressed_count || 0),
      registry_source_offset: Number(result.registry_rotation?.source_offset ?? result.youtube?.source_offset ?? 0),
      registry_next_source_offset: Number(result.registry_rotation?.youtube?.next_source_offset ?? result.youtube?.next_source_offset ?? 0),
      registry_selected_sources: Number(result.registry_rotation?.youtube?.selected_source_count ?? result.youtube?.selected_source_count ?? 0),
      pending_backlog_rows_considered: Number(backlogResult.rows_considered || 0),
      pending_backlog_video_details_fetched_count: Number(backlogResult.video_details_fetched_count || 0),
      pending_backlog_comment_threads_attempted_count: Number(backlogResult.comment_threads_attempted_count || 0),
      pending_backlog_comment_threads_fetched_count: Number(backlogResult.comment_threads_fetched_count || 0),
      pending_backlog_updated_properties: Number(backlogReprocess.updated_properties || 0),
      pending_backlog_auto_live_properties: Number(backlogReprocess.auto_live_properties || 0),
      pending_backlog_review_queue_properties: Number(backlogReprocess.review_queue_properties || 0),
    } : undefined,
  };
}

function pruneStaffSourceIntakeJobs(now = Date.now()) {
  for (const [jobId, job] of staffSourceIntakeJobs.entries()) {
    const created = new Date(job.createdAt || 0).getTime();
    if (created && now - created > STAFF_SOURCE_INTAKE_JOB_TTL_MS) staffSourceIntakeJobs.delete(jobId);
  }
  while (staffSourceIntakeJobs.size > STAFF_SOURCE_INTAKE_JOB_LIMIT) {
    const oldest = [...staffSourceIntakeJobs.entries()]
      .sort((a, b) => new Date(a[1].createdAt || 0) - new Date(b[1].createdAt || 0))[0];
    if (!oldest) break;
    staffSourceIntakeJobs.delete(oldest[0]);
  }
}

function createStaffSourceIntakeJob({ type = 'exact_social_import', exactInputCount = 0, requestedSourceCount = 0, dryRun = false } = {}) {
  pruneStaffSourceIntakeJobs();
  const id = `staff-source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    type,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exactInputCount,
    requestedSourceCount,
    dryRun,
    message: 'Source intake job accepted. You can keep using the dashboard while makaug imports in the background.',
    result: null,
    error: '',
  };
  staffSourceIntakeJobs.set(id, job);
  return job;
}

function runStaffSourceIntakeJob(jobId, runner) {
  setImmediate(async () => {
    const job = staffSourceIntakeJobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.message = 'Source intake is running in the background.';
    try {
      const result = await runner();
      job.status = 'completed';
      job.result = result;
      job.finishedAt = new Date().toISOString();
      job.message = 'Source intake completed. Review queue counts can be refreshed when you are ready.';
    } catch (error) {
      job.status = 'failed';
      job.error = error.message || 'source_intake_failed';
      job.finishedAt = new Date().toISOString();
      job.message = 'Source intake failed. Check the error before retrying.';
      logger.warn('Staff source intake background job failed', { job_id: jobId, message: job.error });
    } finally {
      pruneStaffSourceIntakeJobs();
    }
  });
}

function boolLike(value) {
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function safeJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function sourceQualitySuppressedFlagSql(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `(
    COALESCE(${prefix}extra_fields->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(${prefix}extra_fields->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )`;
}

function rowSourceQualitySuppressed(row = {}) {
  const extra = safeJsonObject(row.extra_fields, {});
  const sourceQuality = safeJsonObject(extra.source_quality_review, {});
  if (boolLike(sourceQuality.suppressed) || boolLike(extra.source_quality_suppressed)) return true;
  return sourceQualitySuppressionForRecord(row).suppressed;
}

function staffActiveReviewRows(rows = [], limit = STAFF_DASHBOARD_QUEUE_LIMIT) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !rowSourceQualitySuppressed(row))
    .slice(0, limit);
}

function staffSourceMonitorGuide() {
  return {
    ...STAFF_SOURCE_MONITOR_GUIDE,
    cadences: [
      { label: 'Fast monitor', value: STAFF_SOURCE_MONITOR_GUIDE.high_frequency_cadence },
      { label: 'Broad search', value: STAFF_SOURCE_MONITOR_GUIDE.broad_search_cadence },
      { label: 'Registry refresh', value: STAFF_SOURCE_MONITOR_GUIDE.daily_registry_cadence }
    ],
    commands: [
      { label: 'Dry proof', value: STAFF_SOURCE_MONITOR_GUIDE.dry_run_command },
      { label: 'Trigger now', value: STAFF_SOURCE_MONITOR_GUIDE.confirm_command },
      { label: 'Broad YouTube search', value: STAFF_SOURCE_MONITOR_GUIDE.broad_search_command },
      { label: 'Daily registry', value: STAFF_SOURCE_MONITOR_GUIDE.daily_registry_command }
    ]
  };
}

function normalizePhoneLite(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('256')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+256${digits.slice(1)}`;
  if (digits.length === 9) return `+256${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

function toNullableInt(value) {
  if (value == null || value === '') return null;
  const n = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function toNullableFloat(value) {
  if (value == null || value === '') return null;
  const n = parseFloat(String(value).replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function firstNonEmpty(...values) {
  return values.map((value) => cleanText(value)).find(Boolean) || '';
}

function cleanArray(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(/[,;\n]/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function countExactSocialInputs({ posts = [], urls = [], rawText = '' } = {}) {
  const rawMatches = String(rawText || '').match(EXACT_SOCIAL_URL_PATTERN) || [];
  return posts.length + urls.length + rawMatches.length;
}

function boolField(value) {
  if (value === true || value === false) return value;
  const text = String(value || '').trim().toLowerCase();
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return boolLike(text);
}

function staffMetricDefinitions() {
  return {
    total_properties: {
      label: 'Live Properties',
      meaning: 'Listings currently online for customers. Rejected, deleted, archived, hidden, and test rows are excluded from this staff number.',
      action: 'Click to jump to the moderation queue. Use the public website for customer-facing availability.'
    },
    pending_review: {
      label: 'Pending Review',
      meaning: 'Listings not public yet because they still need staff or King moderation.',
      action: 'Open Preview & edit, confirm location/contact/photos/duplicates, then approve live or reject with a reason.'
    },
    my_approvals: {
      label: 'My Approvals',
      meaning: 'Listings this staff account personally approved through the real publish route.',
      action: 'Use this to track your daily contribution. King can audit each approval in moderation history.'
    },
    open_leads: {
      label: 'Open Leads',
      meaning: 'People who asked for property help or listing follow-up and have not been closed.',
      action: 'Claim the lead, call or WhatsApp the person, add a note, then update status after contact.'
    },
    ad_leads: {
      label: 'Ad Leads',
      meaning: 'Businesses or agents interested in paid makaug advertising space.',
      action: 'Claim, contact, record target area/package/budget, then move to proposal sent.'
    },
    whatsapp_human: {
      label: 'WhatsApp Chats',
      meaning: 'Open or recently active WhatsApp conversations available for staff follow-up.',
      action: 'Open the chat, answer the customer, then add notes or move related leads forward.'
    },
    source_duplicates: {
      label: 'Duplicate Risk',
      meaning: 'Pending rows that match another listing by phone, title, address, price/location, or exact social source URL.',
      action: 'Do not approve until you compare the duplicate warning and decide whether to merge, reject, or keep pending.'
    },
    bank_leads: {
      label: 'Bank / Mortgage Leads',
      meaning: 'People who used mortgage, affordability, or bank-finance flows.',
      action: 'Contact with the approved mortgage script and capture which bank/product they need.'
    }
  };
}

function sqlList(values = []) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

function pendingReviewWhere(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `
    LOWER(COALESCE(${prefix}status, '')) NOT IN (${sqlList(FINAL_REVIEW_STATUSES)})
    AND LOWER(COALESCE(${prefix}status, '')) NOT IN (${sqlList(STAFF_REMOVED_STATUSES)})
    AND LOWER(COALESCE(${prefix}moderation_stage, '')) NOT IN (${sqlList(STAFF_REMOVED_STATUSES)})
    AND (
      LOWER(COALESCE(${prefix}status, '')) IN (${sqlList(PENDING_REVIEW_STATUSES)})
      OR LOWER(COALESCE(${prefix}moderation_stage, '')) IN (${sqlList(PENDING_REVIEW_STATUSES)})
    )
  `;
}

function activePendingReviewWhere(alias = 'p') {
  return `
    ${pendingReviewWhere(alias)}
    AND NOT ${sourceQualitySuppressedFlagSql(alias)}
  `;
}

function sourceQualitySuppressedPendingWhere(alias = 'p') {
  return `
    ${pendingReviewWhere(alias)}
    AND ${sourceQualitySuppressedFlagSql(alias)}
  `;
}

function brokerReviewWhere(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `(
    LOWER(COALESCE(${prefix}listed_via, '')) LIKE '%broker%'
    OR LOWER(COALESCE(${prefix}source, '')) LIKE '%broker%'
    OR LOWER(COALESCE(${prefix}lister_type, '')) IN ('agent', 'broker')
    OR ${prefix}agent_id IS NOT NULL
    OR COALESCE(${prefix}extra_fields->>'broker_submission', '') IN ('true', '1', 'yes')
    OR NULLIF(${prefix}extra_fields->>'broker_agent_id', '') IS NOT NULL
  )`;
}

function staffVisiblePropertyWhere(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `
    LOWER(COALESCE(${prefix}status, '')) NOT IN (${sqlList(STAFF_REMOVED_STATUSES)})
    AND LOWER(COALESCE(${prefix}moderation_stage, '')) NOT IN (${sqlList(STAFF_REMOVED_STATUSES)})
  `;
}

function publicCustomerVisiblePropertyWhere(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  const markerFilters = PUBLIC_SUPPRESSED_LISTING_MARKERS.map((marker) => {
    const escaped = String(marker).replace(/'/g, "''");
    return `(COALESCE(${prefix}title, '') NOT ILIKE '%${escaped}%' AND COALESCE(${prefix}description, '') NOT ILIKE '%${escaped}%')`;
  }).join('\n    AND ');
  const dummyTitleFilters = PUBLIC_SUPPRESSED_DUMMY_TITLES.map((title) => {
    const escaped = String(title).replace(/'/g, "''");
    return `LOWER(TRIM(COALESCE(${prefix}title, ''))) <> '${escaped}'`;
  }).join('\n    AND ');

  return `
    ${publicLivePropertyStatusSql(alias)}
    AND ${markerFilters}
    AND ${dummyTitleFilters}
    AND COALESCE(${prefix}source, '') !~* '(qa|test|demo|soft_launch|launch_proof)'
    AND COALESCE(${prefix}listed_via, '') !~* '(qa|test|demo|soft_launch|launch_proof)'
    AND COALESCE(${prefix}lister_name, '') !~* '(qa test delete|qa owner|dummy|sample)'
    AND COALESCE(${prefix}lister_email, '') !~* '(makaug\\.invalid|test@|qa@|dummy|sample)'
    AND COALESCE(${prefix}inquiry_reference, '') !~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    AND COALESCE(${prefix}extra_fields->>'qa_test_delete', '') !~* '^(true|1|yes)$'
    AND COALESCE(${prefix}extra_fields->>'soft_launch_test', '') !~* '^(true|1|yes)$'
    AND COALESCE(${prefix}extra_fields->>'is_test', '') !~* '^(true|1|yes)$'
    AND COALESCE(${prefix}extra_fields->>'launch_proof', '') !~* '^(true|1|yes)$'
    AND COALESCE(${prefix}extra_fields->>'non_public_test', '') !~* '^(true|1|yes)$'
  `;
}

function actorId(req) {
  return req.userAuth?.id || req.staffAuth?.userId || null;
}

function staffProfile(user = {}) {
  return user.profile_data && typeof user.profile_data === 'object' && !Array.isArray(user.profile_data)
    ? user.profile_data
    : {};
}

function publicStaffUser(user = {}) {
  const profile = staffProfile(user);
  const paymentProfile = safeJsonObject(profile.payment_profile, {});
  const channelAccess = profile.channel_access && typeof profile.channel_access === 'object' && !Array.isArray(profile.channel_access)
    ? profile.channel_access
    : {
      listings: true,
      leads: true,
      advertising: true,
      whatsapp: true,
      social_media: true,
      ai_assistant: true
    };
  const permissions = profile.permissions && typeof profile.permissions === 'object' && !Array.isArray(profile.permissions)
    ? profile.permissions
    : {
      listing_moderation: true,
      lead_generation: true,
      advertising_sales: true,
      whatsapp_conversations: true,
      training_library: true,
      ai_assistant: true,
      financial_admin: false,
      user_admin: false,
      system_settings: false
    };
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    preferred_contact_channel: user.preferred_contact_channel || 'whatsapp',
    preferred_language: user.preferred_language || 'en',
    staff_code: profile.staff_code || profile.employee_number || '',
    personal_email: profile.personal_email || '',
    payment_profile: {
      simba_account: firstNonEmpty(paymentProfile.simba_account, profile.simba_account, profile.simba_pay_id),
      payment_provider: firstNonEmpty(paymentProfile.payment_provider, profile.payment_provider, profile.mobile_money_provider, 'mobile_money'),
      mobile_money_name: firstNonEmpty(paymentProfile.mobile_money_name, profile.mobile_money_name),
      mobile_money_phone: firstNonEmpty(paymentProfile.mobile_money_phone, profile.mobile_money_phone, user.phone),
      bank_name: firstNonEmpty(paymentProfile.bank_name, profile.bank_name),
      bank_account_name: firstNonEmpty(paymentProfile.bank_account_name, profile.bank_account_name),
      bank_account_last4: firstNonEmpty(paymentProfile.bank_account_last4, profile.bank_account_last4),
      payout_notes: firstNonEmpty(paymentProfile.payout_notes, profile.payout_notes)
    },
    channel_access: channelAccess,
    permissions
  };
}

function safeNumber(row, key) {
  return Number(row?.[key] || 0) || 0;
}

async function safeOne(sql, params = [], fallback = {}) {
  try {
    const result = await db.query(sql, params);
    return result.rows[0] || fallback;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Staff dashboard query failed', { message: error.message });
    }
    return fallback;
  }
}

async function safeRows(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Staff dashboard rows query failed', { message: error.message });
    }
    return [];
  }
}

async function logStaffActivity(req, action, { targetType = null, targetId = null, metadata = {} } = {}) {
  const staffUserId = actorId(req);
  const payload = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  await db.query(
    `INSERT INTO staff_activity_logs (staff_user_id, action, target_type, target_id, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [staffUserId, action, targetType, targetId ? String(targetId) : null, JSON.stringify(payload)]
  ).catch(async (error) => {
    if (!['42P01', '42703'].includes(error.code)) throw error;
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1,$2,$3::jsonb)`,
      [staffUserId || 'staff_user', action, JSON.stringify({ target_type: targetType, target_id: targetId, ...payload })]
    ).catch(() => {});
  });
}

function logStaffActivityInBackground(req, action, options = {}) {
  logStaffActivity(req, action, options).catch((error) => {
    logger.warn('Staff activity background log failed', {
      action,
      target_id: options?.targetId || null,
      message: error.message
    });
  });
}

function trainingGuide() {
  return {
    moderation: {
      goal: 'Only accurate, contactable, non-duplicate listings should go live.',
      steps: [
        'Open Preview & edit before any approval. Do not approve from the queue card.',
        'Confirm location from strongest evidence first: address/map pin, source caption, phone conversation, then extracted area.',
        'Fix hierarchy before saving: Nansana belongs to Wakiso, Masindi belongs to Masindi, Arua City/Pokea belongs to Arua.',
        'Check title, listing type, property type, price, title type, contact number, description, image rights, and duplicate warnings.',
        'Approve only after preview is saved. Reject when ownership, contact path, source evidence, or location cannot be confirmed.'
      ]
    },
    source_intake: {
      goal: 'Bring TikTok, YouTube, Facebook, X/Twitter, student housing, and WhatsApp source leads into one shared queue without duplicates.',
      steps: [
        'Continuous monitor runs from Render: fast channel-upload sweeps every 10-15 minutes, broader hashtag/search sweeps every 2-4 hours, and source-registry refresh once daily.',
        'Paste exact post/video links or copied source text into Source intake.',
        'Preview first. The preview shows how many rows are new, existing, duplicates, source-review only, or queue-ready.',
        'Queue only exact property posts with a location, source/contact route, and usable evidence. Source pages alone stay in source review.',
        'After queueing, all staff see the same moderation queue. Whoever cleans it first should save notes so nobody duplicates work.',
        'If a duplicate warning appears, compare source URL, title, phone, area, price, and image evidence before publishing.'
      ]
    },
    leads: {
      goal: 'Turn customer demand into a contacted lead, then into a viewing, broker handoff, or saved requirement.',
      steps: [
        'Open leads with high priority, overdue status, or WhatsApp no-match first.',
        'Claim means the lead is assigned to you and marked contacted. Add a note after every call or WhatsApp.',
        'Ask for desired location, budget, property type, timing, and whether they want rent, sale, land, student, commercial, or bank finance.',
        'Match customers to approved live listings only. Never promise a pending listing is available.',
        'Close only after outcome is known: contacted, qualified, lost, or handed to King/admin.'
      ]
    },
    advertising: {
      goal: 'Sell makaug advertising space while keeping payment confirmation with King/admin.',
      steps: [
        'Record business name, phone, target district/area, product interest, package, budget, and next follow-up.',
        'Available products: sponsored search space, student page space, land/commercial placements, broker spotlight, WhatsApp sponsored matches, and homepage/category slots.',
        'Move to contacted after first call, proposal_sent after package/price is sent, and won only when King/admin confirms payment proof.',
        'Do not mark paid, discount, or refund from staff dashboard.'
      ]
    },
    whatsapp: {
      goal: 'Make WhatsApp conversations human-readable and actioned quickly.',
      steps: [
        'Open conversations marked needs_human, escalated, hot, or open with recent customer messages.',
        'Use the WhatsApp link to respond, then create or update the matching lead/listing note.',
        'Escalate fraud, deposit, payment, legal, abuse, or safety questions to King/admin.',
        'If AI gave no results, capture the customer requirement and create a lead instead of leaving the chat idle.'
      ]
    },
    bank_leads: {
      goal: 'Capture mortgage and bank-finance demand for follow-up and future lender partnerships.',
      steps: [
        'Ask property price, deposit available, term length, household income range, preferred bank, and target area.',
        'Do not promise approval. Explain that makaug records the request and prepares the bank/mortgage callback path.',
        'Tag the lead as mortgage/bank finance and add next follow-up.'
      ]
    },
    scripts: {
      goal: 'Keep staff responses consistent.',
      steps: [
        'Listing check: Hello, this is makaug.com. I am checking your property so we only publish accurate information. Please confirm exact area, district, price, contact number, and image permission.',
        'Buyer lead: Hello, this is makaug.com. I saw your property request. Which area, budget, property type, and timeline should I use to match you with live listings?',
        'Advertising: makaug can place sponsored space across search, student pages, land/commercial pages, broker spotlight, and WhatsApp sponsored matches. Which area and budget should we prepare?',
        'Bank lead: makaug can record your mortgage or bank-finance request. Please share property price, deposit, term, income range, and preferred bank if any.'
      ]
    },
    videos: [
      { title: 'Moderation walkthrough', url: '/assets/docs/field-agent/makaug-field-agent-training-deck.pptx' },
      { title: 'Field agent welcome pack', url: '/assets/docs/field-agent/makaug-field-agent-welcome-pack.pptx' }
    ]
  };
}

function staffFastDashboardCacheKey(req) {
  return String(actorId(req) || req.userAuth?.email || req.userAuth?.phone || 'staff');
}

function cloneDashboardPayload(payload = {}) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function clearStaffFastDashboardCache() {
  staffFastDashboardCache.clear();
}

function refreshStaffFastDashboardCache(req, cacheKey) {
  if (staffFastDashboardRefreshes.has(cacheKey)) return;
  const refresh = buildDashboardFastPayload(req)
    .then((payload) => {
      staffFastDashboardCache.set(cacheKey, { at: Date.now(), payload: cloneDashboardPayload(payload) });
    })
    .catch((error) => logger.warn('Staff fast dashboard cache refresh failed', { message: error.message }))
    .finally(() => staffFastDashboardRefreshes.delete(cacheKey));
  staffFastDashboardRefreshes.set(cacheKey, refresh);
}

async function dashboardFastPayload(req) {
  const cacheKey = staffFastDashboardCacheKey(req);
  const cached = staffFastDashboardCache.get(cacheKey);
  const now = Date.now();
  if (cached?.payload) {
    if (now - cached.at > STAFF_FAST_DASHBOARD_CACHE_TTL_MS) {
      refreshStaffFastDashboardCache(req, cacheKey);
    }
    return {
      ...cloneDashboardPayload(cached.payload),
      cache: {
        status: now - cached.at > STAFF_FAST_DASHBOARD_CACHE_TTL_MS ? 'stale_refreshing' : 'hit',
        age_ms: now - cached.at,
        ttl_ms: STAFF_FAST_DASHBOARD_CACHE_TTL_MS
      }
    };
  }
  const payload = await buildDashboardFastPayload(req);
  staffFastDashboardCache.set(cacheKey, { at: Date.now(), payload: cloneDashboardPayload(payload) });
  return {
    ...payload,
    cache: { status: 'miss', age_ms: 0, ttl_ms: STAFF_FAST_DASHBOARD_CACHE_TTL_MS }
  };
}

async function buildDashboardFastPayload(req) {
  const staffId = actorId(req);
  const [
    listingSummary,
    myModeration,
    leadSummary,
    adSummary,
    whatsappSummary,
    sourceSummary,
    mortgageSummary,
    paymentSummary
  ] = await Promise.all([
    safeOne(
      `SELECT
         COUNT(*)::int AS database_total,
         COUNT(*) FILTER (WHERE ${staffVisiblePropertyWhere('p')})::int AS staff_visible_total,
         COUNT(*) FILTER (WHERE ${activePendingReviewWhere('p')})::int AS pending_review,
         COUNT(*) FILTER (WHERE ${activePendingReviewWhere('p')} AND ${brokerReviewWhere('p')})::int AS broker_pending_review,
         COUNT(*) FILTER (WHERE ${sourceQualitySuppressedPendingWhere('p')})::int AS source_quality_suppressed_pending,
         COUNT(*) FILTER (WHERE ${publicCustomerVisiblePropertyWhere('p')})::int AS live,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, '')) IN (${sqlList(STAFF_REMOVED_STATUSES)}))::int AS staff_removed,
         COUNT(*) FILTER (WHERE ${staffVisiblePropertyWhere('p')} AND COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$')::int AS found_online,
         COUNT(*) FILTER (WHERE ${staffVisiblePropertyWhere('p')} AND LOWER(COALESCE(p.source, p.listed_via, '')) IN ('website','web'))::int AS website_submitted
       FROM properties p`,
      [],
      { database_total: 0, staff_visible_total: 0, pending_review: 0, broker_pending_review: 0, source_quality_suppressed_pending: 0, live: 0, staff_removed: 0, found_online: 0, website_submitted: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total_actions,
         COUNT(*) FILTER (WHERE status_to IN ('approved','live','published'))::int AS approvals,
         COUNT(*) FILTER (WHERE status_to = 'rejected')::int AS rejections,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS actions_24h
       FROM property_moderation_events
       WHERE actor_id = $1`,
      [staffId],
      { total_actions: 0, approvals: 0, rejections: 0, actions_24h: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE lead_status = ANY($1::text[]))::int AS open,
         COUNT(*) FILTER (WHERE assigned_to_user_id = $2)::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE priority IN ('high','urgent') OR lead_score >= 50)::int AS hot,
         COUNT(*) FILTER (WHERE next_follow_up_at < NOW() AND lead_status = 'open')::int AS overdue
       FROM leads`,
      [OPEN_LEAD_STATUSES, staffId],
      { open: 0, assigned_to_me: 0, hot: 0, overdue: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE status = ANY($1::text[]))::int AS open_inquiries,
         COUNT(*) FILTER (WHERE assigned_to_user_id = $2)::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE status = 'won')::int AS won_inquiries,
         COALESCE(SUM(estimated_value_ugx) FILTER (WHERE status IN ('proposal_sent','won')), 0)::bigint AS staff_visible_pipeline_ugx
       FROM advertising_inquiries`,
      [OPEN_AD_STATUSES, staffId],
      { open_inquiries: 0, assigned_to_me: 0, won_inquiries: 0, staff_visible_pipeline_ugx: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('needs_human','escalated'))::int AS needs_human,
         COUNT(*) FILTER (WHERE status IN ('open','ai_active','awaiting_customer','needs_human','escalated'))::int AS open,
         COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '7 days')::int AS active_7d,
         COUNT(*) FILTER (WHERE assigned_to = $1)::int AS assigned_to_me
       FROM whatsapp_conversation_state`,
      [staffId],
      { needs_human: 0, open: 0, active_7d: 0, assigned_to_me: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total_sources,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'tiktok')::int AS tiktok_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'youtube')::int AS youtube_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'facebook')::int AS facebook_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'x' OR platform ILIKE 'twitter')::int AS x_sources,
         COUNT(*) FILTER (WHERE can_contact_directly = true)::int AS direct_contact_sources
       FROM property_source_registry`,
      [],
      { total_sources: 0, active_sources: 0, tiktok_sources: 0, youtube_sources: 0, facebook_sources: 0, x_sources: 0, direct_contact_sources: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7_days,
         COUNT(*) FILTER (WHERE user_phone IS NOT NULL AND user_phone <> '')::int AS with_phone
       FROM mortgage_enquiries`,
      [],
      { total: 0, last_7_days: 0, with_phone: 0 }
    ),
    safeOne(
      `SELECT
         (SELECT COUNT(*)::int FROM payment_links WHERE status IN ('created','pending','sent')) AS open_payment_links,
         (SELECT COUNT(*)::int FROM invoices WHERE status IN ('draft','sent','unpaid','pending')) AS open_invoices,
         (SELECT COUNT(*)::int FROM invoices WHERE status = 'paid') AS paid_invoices
       `,
      [],
      { open_payment_links: 0, open_invoices: 0, paid_invoices: 0 }
    )
  ]);

  return {
    staff: publicStaffUser(req.userAuth),
    partial: true,
    deferred_dashboard_endpoint: '/api/staff/dashboard?panels=1',
    summary: {
      listings: listingSummary,
      my_moderation: myModeration,
      leads: leadSummary,
      advertising: adSummary,
      whatsapp: { ...whatsappSummary, bridge: { status: 'loading' } },
      sources: sourceSummary,
      duplicates: { possible_duplicates: 0 },
      bank_leads: mortgageSummary,
      payments: paymentSummary,
      definitions: staffMetricDefinitions()
    },
    review_queue: [],
    leads: [],
    advertising_inquiries: [],
    whatsapp_conversations: [],
    source_intake: {
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      summary: sourceSummary,
      possible_duplicates: 0,
      monitor: staffSourceMonitorGuide(),
      source_presets: STAFF_SOURCE_PRESETS,
      source_registry: [],
      queued_found_online: [],
      exact_import_endpoint: '/api/staff/source-intake/exact-social/import',
      sweep_endpoint: '/api/staff/source-intake/social-sweep'
    },
    bank_leads: { summary: mortgageSummary, rows: [] },
    payments: {
      summary: paymentSummary,
      staff_payment_profile: publicStaffUser(req.userAuth).payment_profile,
      note: 'Staff can save their payout details here. Payment confirmation, paid invoices, discounts, and refunds remain King/admin controlled.'
    },
    recent_activity: [],
    training: trainingGuide(),
    ai: {
      provider: getProviderMeta(),
      assistant_endpoint: '/api/staff/assistant/query'
    }
  };
}

async function dashboardPayload(req) {
  const staffId = actorId(req);
  const queueLimit = STAFF_DASHBOARD_QUEUE_LIMIT;
  const panelLimit = STAFF_DASHBOARD_PANEL_LIMIT;
  const [
    listingSummary,
    myModeration,
    leadSummary,
    adSummary,
    whatsappSummary,
    recentActivity,
    reviewRows,
    brokerReviewRows,
    leadRows,
    adRows,
    whatsappRows,
    whatsappBridge,
    sourceSummary,
    duplicateSummary,
    sourceRows,
    sourceQueueRows,
    mortgageSummary,
    mortgageRows,
    paymentSummary
  ] = await Promise.all([
    safeOne(
      `SELECT
         COUNT(*)::int AS database_total,
         COUNT(*) FILTER (WHERE ${staffVisiblePropertyWhere('p')})::int AS staff_visible_total,
         COUNT(*) FILTER (WHERE ${activePendingReviewWhere('p')})::int AS pending_review,
         COUNT(*) FILTER (WHERE ${sourceQualitySuppressedPendingWhere('p')})::int AS source_quality_suppressed_pending,
         COUNT(*) FILTER (WHERE ${publicCustomerVisiblePropertyWhere('p')})::int AS live,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, '')) IN (${sqlList(STAFF_REMOVED_STATUSES)}))::int AS staff_removed,
         COUNT(*) FILTER (WHERE ${staffVisiblePropertyWhere('p')} AND COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$')::int AS found_online,
         COUNT(*) FILTER (WHERE ${staffVisiblePropertyWhere('p')} AND LOWER(COALESCE(p.source, p.listed_via, '')) IN ('website','web'))::int AS website_submitted
       FROM properties p`,
      [],
      { database_total: 0, staff_visible_total: 0, pending_review: 0, source_quality_suppressed_pending: 0, live: 0, staff_removed: 0, found_online: 0, website_submitted: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total_actions,
         COUNT(*) FILTER (WHERE status_to IN ('approved','live','published'))::int AS approvals,
         COUNT(*) FILTER (WHERE status_to = 'rejected')::int AS rejections,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS actions_24h
       FROM property_moderation_events
       WHERE actor_id = $1`,
      [staffId],
      { total_actions: 0, approvals: 0, rejections: 0, actions_24h: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE lead_status = ANY($1::text[]))::int AS open,
         COUNT(*) FILTER (WHERE assigned_to_user_id = $2)::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE priority IN ('high','urgent') OR lead_score >= 50)::int AS hot,
         COUNT(*) FILTER (WHERE next_follow_up_at < NOW() AND lead_status = 'open')::int AS overdue
       FROM leads`,
      [OPEN_LEAD_STATUSES, staffId],
      { open: 0, assigned_to_me: 0, hot: 0, overdue: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE status = ANY($1::text[]))::int AS open_inquiries,
         COUNT(*) FILTER (WHERE assigned_to_user_id = $2)::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE status = 'won')::int AS won_inquiries,
         COALESCE(SUM(estimated_value_ugx) FILTER (WHERE status IN ('proposal_sent','won')), 0)::bigint AS staff_visible_pipeline_ugx
       FROM advertising_inquiries`,
      [OPEN_AD_STATUSES, staffId],
      { open_inquiries: 0, assigned_to_me: 0, won_inquiries: 0, staff_visible_pipeline_ugx: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('needs_human','escalated'))::int AS needs_human,
         COUNT(*) FILTER (WHERE status IN ('open','ai_active','awaiting_customer','needs_human','escalated'))::int AS open,
         COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '7 days')::int AS active_7d,
         COUNT(*) FILTER (WHERE assigned_to = $1)::int AS assigned_to_me
       FROM whatsapp_conversation_state`,
      [staffId],
      { needs_human: 0, open: 0, active_7d: 0, assigned_to_me: 0 }
    ),
    safeRows(
      `SELECT id, action, target_type, target_id, metadata, created_at
       FROM staff_activity_logs
       WHERE staff_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [staffId, panelLimit]
    ),
    safeRows(
      `SELECT p.id, p.title, p.description, p.listing_type, p.property_type, p.district, p.area, p.address,
              p.price, p.price_period, p.bedrooms, p.bathrooms, p.title_type,
              p.status, p.moderation_stage, p.moderation_reason, p.created_at, p.updated_at,
              p.inquiry_reference, p.lister_name, p.lister_phone, p.lister_email, p.source, p.listed_via,
              p.lister_type, p.agent_id, p.extra_fields,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_platform', p.extra_fields->>'source_badge', p.source, p.listed_via) AS source_platform,
              0::int AS duplicate_count,
              img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC LIMIT 1
       ) img ON true
       WHERE ${pendingReviewWhere('p')}
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      [STAFF_DASHBOARD_QUEUE_SCAN_LIMIT]
    ),
    safeRows(
      `SELECT p.id, p.title, p.description, p.listing_type, p.property_type, p.district, p.area, p.address,
              p.price, p.price_period, p.bedrooms, p.bathrooms, p.title_type,
              p.status, p.moderation_stage, p.moderation_reason, p.created_at, p.updated_at,
              p.inquiry_reference, p.lister_name, p.lister_phone, p.lister_email, p.source, p.listed_via,
              p.lister_type, p.agent_id, p.extra_fields,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_platform', p.extra_fields->>'source_badge', p.source, p.listed_via) AS source_platform,
              0::int AS duplicate_count,
              img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC LIMIT 1
       ) img ON true
       WHERE ${pendingReviewWhere('p')}
         AND ${brokerReviewWhere('p')}
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      [STAFF_DASHBOARD_QUEUE_SCAN_LIMIT]
    ),
    safeRows(
      `SELECT l.*, c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email, c.whatsapp AS contact_whatsapp, p.title AS listing_title
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       LEFT JOIN properties p ON p.id = l.listing_id
       WHERE l.assigned_to_user_id = $1 OR l.lead_status = ANY($2::text[])
       ORDER BY CASE WHEN l.assigned_to_user_id = $1 THEN 0 ELSE 1 END, l.created_at DESC
       LIMIT $3`,
      [staffId, OPEN_LEAD_STATUSES, panelLimit]
    ),
    safeRows(
      `SELECT id, full_name, business_name, email, phone, product_interests, target_locations,
              target_listing_types, budget_ugx, status, estimated_value_ugx, assigned_to_user_id,
              internal_notes, created_at, updated_at
       FROM advertising_inquiries
       WHERE assigned_to_user_id = $1 OR status = ANY($2::text[])
       ORDER BY CASE WHEN assigned_to_user_id = $1 THEN 0 ELSE 1 END, created_at DESC
       LIMIT $3`,
      [staffId, OPEN_AD_STATUSES, panelLimit]
    ),
    safeRows(
      `WITH latest_message AS (
         SELECT DISTINCT ON (m.user_phone)
                m.user_phone,
                m.message_type,
                m.payload,
                m.created_at
         FROM whatsapp_messages m
         ORDER BY m.user_phone, m.created_at DESC
       ),
       latest_intent AS (
         SELECT DISTINCT ON (i.user_phone)
                i.user_phone,
                i.detected_intent,
                i.language,
                i.created_at
         FROM whatsapp_intent_logs i
         ORDER BY i.user_phone, i.created_at DESC
       )
       SELECT c.phone::text AS phone,
              c.status::text AS status,
              c.category::text AS category,
              c.priority::text AS priority,
              c.assigned_to::text AS assigned_to,
              LEFT(COALESCE(
                lm.payload->>'effectiveBody',
                lm.payload->>'body',
                lm.payload->>'text',
                lm.payload->>'reply',
                c.last_summary,
                lm.message_type,
                'WhatsApp conversation'
              ), 240) AS latest_preview,
              li.detected_intent::text AS last_intent,
              COALESCE(li.language, 'en')::text AS preferred_language,
              c.last_message_at,
              c.last_inbound_at,
              c.last_outbound_at,
              c.last_ai_reply_at,
              c.last_human_reply_at,
              c.metadata,
              c.updated_at
       FROM whatsapp_conversation_state c
       LEFT JOIN latest_message lm ON lm.user_phone = c.phone
       LEFT JOIN latest_intent li ON li.user_phone = c.phone
       WHERE c.assigned_to::text = $1::text
          OR c.status IN ('needs_human','escalated','open','ai_active','awaiting_customer')
       ORDER BY COALESCE(c.last_message_at, lm.created_at, c.updated_at) DESC
       LIMIT $2`,
      [staffId, panelLimit]
    ),
    safeOne(
      `SELECT status, operator_name, unread_count, last_error, last_seen_at,
              EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS age_seconds
       FROM whatsapp_web_bridge_clients
       ORDER BY last_seen_at DESC
       LIMIT 1`,
      [],
      { status: 'unknown', operator_name: '', unread_count: 0, last_error: '', last_seen_at: null, age_seconds: null }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total_sources,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'tiktok')::int AS tiktok_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'youtube')::int AS youtube_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'facebook')::int AS facebook_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'x' OR platform ILIKE 'twitter')::int AS x_sources,
         COUNT(*) FILTER (WHERE can_contact_directly = true)::int AS direct_contact_sources
       FROM property_source_registry`,
      [],
      { total_sources: 0, active_sources: 0, tiktok_sources: 0, youtube_sources: 0, facebook_sources: 0, x_sources: 0, direct_contact_sources: 0 }
    ),
    safeOne(
      `WITH pending AS (
         SELECT
           NULLIF(lister_phone, '') AS lister_phone,
           NULLIF(LOWER(COALESCE(title, '')), '') AS normalized_title,
           NULLIF(COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', ''), '') AS source_url
         FROM properties p
         WHERE ${activePendingReviewWhere('p')}
       ),
       duplicate_keys AS (
         SELECT lister_phone AS duplicate_key FROM pending WHERE lister_phone IS NOT NULL GROUP BY lister_phone HAVING COUNT(*) > 1
         UNION
         SELECT normalized_title AS duplicate_key FROM pending WHERE normalized_title IS NOT NULL GROUP BY normalized_title HAVING COUNT(*) > 1
         UNION
         SELECT source_url AS duplicate_key FROM pending WHERE source_url IS NOT NULL GROUP BY source_url HAVING COUNT(*) > 1
       )
       SELECT COUNT(*)::int AS possible_duplicates
       FROM duplicate_keys`,
      [],
      { possible_duplicates: 0 }
    ),
    safeRows(
      `SELECT id, source_name, platform, source_type, source_url, handle, contact_phone, contact_phone_alt,
              contact_email, districts, listing_types, status, trust_level, consent_status, scrape_policy,
              can_contact_directly, last_seen_at, last_checked_at, notes
       FROM property_source_registry
       WHERE status IN ('active','candidate','review_needed')
       ORDER BY COALESCE(last_seen_at, last_checked_at, created_at) DESC
       LIMIT $1`,
      [panelLimit]
    ),
    safeRows(
      `SELECT p.id, p.title, p.area, p.district, p.status, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url') AS source_url,
              p.lister_phone,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name
       FROM properties p
       WHERE ${pendingReviewWhere('p')}
         AND (
           COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
           OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', '') <> ''
         )
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      [STAFF_DASHBOARD_PANEL_SCAN_LIMIT]
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7_days,
         COUNT(*) FILTER (WHERE user_phone IS NOT NULL AND user_phone <> '')::int AS with_phone
       FROM mortgage_enquiries`,
      [],
      { total: 0, last_7_days: 0, with_phone: 0 }
    ),
    safeRows(
      `SELECT id, user_phone, property_price, property_purpose, deposit_percent, term_years,
              household_income, payload, created_at
       FROM mortgage_enquiries
       ORDER BY created_at DESC
       LIMIT $1`,
      [panelLimit]
    ),
    safeOne(
      `SELECT
         (SELECT COUNT(*)::int FROM payment_links WHERE status IN ('created','pending','sent')) AS open_payment_links,
         (SELECT COUNT(*)::int FROM invoices WHERE status IN ('draft','sent','unpaid','pending')) AS open_invoices,
         (SELECT COUNT(*)::int FROM invoices WHERE status = 'paid') AS paid_invoices
       `,
      [],
      { open_payment_links: 0, open_invoices: 0, paid_invoices: 0 }
    )
  ]);

  const activeReviewRows = staffActiveReviewRows(reviewRows, queueLimit);
  const activeBrokerReviewRows = staffActiveReviewRows(brokerReviewRows, queueLimit);
  const activeSourceQueueRows = staffActiveReviewRows(sourceQueueRows, panelLimit);

  return {
    staff: publicStaffUser(req.userAuth),
    summary: {
      listings: listingSummary,
      my_moderation: myModeration,
      leads: leadSummary,
      advertising: adSummary,
      whatsapp: { ...whatsappSummary, bridge: whatsappBridge },
      sources: sourceSummary,
      duplicates: duplicateSummary,
      bank_leads: mortgageSummary,
      payments: paymentSummary,
      definitions: staffMetricDefinitions()
    },
    review_queue: activeReviewRows,
    broker_review_queue: activeBrokerReviewRows,
    leads: leadRows,
    advertising_inquiries: adRows,
    whatsapp_conversations: whatsappRows,
    source_intake: {
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      summary: sourceSummary,
      possible_duplicates: safeNumber(duplicateSummary, 'possible_duplicates'),
      source_quality_suppressed: {
        pending_count: safeNumber(listingSummary, 'source_quality_suppressed_pending'),
        hidden_from_active_review: true,
        reason: 'Construction tutorials, design showcases, building-cost videos, and similar non-listing source posts are filtered out of the active moderator queue.'
      },
      monitor: staffSourceMonitorGuide(),
      source_presets: STAFF_SOURCE_PRESETS,
      source_registry: sourceRows,
      queued_found_online: activeSourceQueueRows,
      exact_import_endpoint: '/api/staff/source-intake/exact-social/import',
      sweep_endpoint: '/api/staff/source-intake/social-sweep'
    },
    bank_leads: {
      summary: mortgageSummary,
      rows: mortgageRows
    },
    payments: {
      summary: paymentSummary,
      staff_payment_profile: publicStaffUser(req.userAuth).payment_profile,
      note: 'Staff can save their payout details here. Payment confirmation, paid invoices, discounts, and refunds remain King/admin controlled.'
    },
    recent_activity: recentActivity,
    training: trainingGuide(),
    ai: {
      provider: getProviderMeta(),
      assistant_endpoint: '/api/staff/assistant/query'
    }
  };
}

async function dashboardPanelsPayload(req) {
  const queueLimit = STAFF_DASHBOARD_QUEUE_LIMIT;
  const panelLimit = STAFF_DASHBOARD_PANEL_LIMIT;
  const [reviewRows, brokerReviewRows, sourceQueueRows] = await Promise.all([
    safeRows(
      `SELECT p.id, p.title, p.description, p.listing_type, p.property_type, p.district, p.area, p.address,
              p.price, p.price_period, p.bedrooms, p.bathrooms, p.title_type,
              p.status, p.moderation_stage, p.moderation_reason, p.created_at, p.updated_at,
              p.inquiry_reference, p.lister_name, p.lister_phone, p.lister_email, p.source, p.listed_via,
              p.lister_type, p.agent_id, p.extra_fields,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_platform', p.extra_fields->>'source_badge', p.source, p.listed_via) AS source_platform,
              0::int AS duplicate_count,
              img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC LIMIT 1
       ) img ON true
       WHERE ${pendingReviewWhere('p')}
         AND NOT ${sourceQualitySuppressedFlagSql('p')}
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      [STAFF_DASHBOARD_QUEUE_SCAN_LIMIT]
    ),
    safeRows(
      `SELECT p.id, p.title, p.description, p.listing_type, p.property_type, p.district, p.area, p.address,
              p.price, p.price_period, p.bedrooms, p.bathrooms, p.title_type,
              p.status, p.moderation_stage, p.moderation_reason, p.created_at, p.updated_at,
              p.inquiry_reference, p.lister_name, p.lister_phone, p.lister_email, p.source, p.listed_via,
              p.lister_type, p.agent_id, p.extra_fields,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_platform', p.extra_fields->>'source_badge', p.source, p.listed_via) AS source_platform,
              0::int AS duplicate_count,
              img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC LIMIT 1
       ) img ON true
       WHERE ${pendingReviewWhere('p')}
         AND NOT ${sourceQualitySuppressedFlagSql('p')}
         AND ${brokerReviewWhere('p')}
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      [STAFF_DASHBOARD_QUEUE_SCAN_LIMIT]
    ),
    safeRows(
      `SELECT p.id, p.title, p.area, p.district, p.status, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url') AS source_url,
              p.lister_phone,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name,
              p.extra_fields
       FROM properties p
       WHERE ${pendingReviewWhere('p')}
         AND NOT ${sourceQualitySuppressedFlagSql('p')}
         AND (
           COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
           OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', '') <> ''
         )
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      [STAFF_DASHBOARD_PANEL_SCAN_LIMIT]
    )
  ]);

  return {
    staff: publicStaffUser(req.userAuth),
    panel_payload: true,
    review_queue: staffActiveReviewRows(reviewRows, queueLimit),
    broker_review_queue: staffActiveReviewRows(brokerReviewRows, queueLimit),
    source_intake: {
      queued_found_online: staffActiveReviewRows(sourceQueueRows, panelLimit)
    }
  };
}

function normalizeStaffListingPatch(existing = {}, patch = {}) {
  const normalized = safeJsonObject(patch, {});
  if (!Object.prototype.hasOwnProperty.call(normalized, 'listing_type')) {
    const typeAlias = normalized.listingType ?? normalized.type ?? normalized.category;
    if (typeAlias != null) normalized.listing_type = typeAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalized, 'latitude')) {
    const latAlias = normalized.lat;
    if (latAlias != null) normalized.latitude = latAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalized, 'longitude')) {
    const lngAlias = normalized.lng ?? normalized.lon ?? normalized.long;
    if (lngAlias != null) normalized.longitude = lngAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalized, 'land_title_available')) {
    const landTitleAlias = normalized.landTitleAvailable ?? normalized.title_available ?? normalized.titleAvailable;
    if (landTitleAlias != null) normalized.land_title_available = landTitleAlias;
  }
  const currentExtra = safeJsonObject(existing.extra_fields, {});
  const base = {
    area: Object.prototype.hasOwnProperty.call(normalized, 'area') ? cleanText(normalized.area) : cleanText(existing.area),
    district: Object.prototype.hasOwnProperty.call(normalized, 'district') ? cleanText(normalized.district) : cleanText(existing.district),
    region: Object.prototype.hasOwnProperty.call(normalized, 'region') ? cleanText(normalized.region) : cleanText(currentExtra.region),
    city: Object.prototype.hasOwnProperty.call(normalized, 'city') ? cleanText(normalized.city) : cleanText(currentExtra.city),
    neighborhood: Object.prototype.hasOwnProperty.call(normalized, 'neighborhood') ? cleanText(normalized.neighborhood) : cleanText(currentExtra.neighborhood)
  };

  const knownAreaDistrict = districtForKnownArea(base.area) || districtForKnownArea(base.neighborhood) || districtForKnownArea(base.city);
  const callerSuppliedDistrict = Object.prototype.hasOwnProperty.call(normalized, 'district');
  const errors = [];
  if (knownAreaDistrict && base.district && base.district !== knownAreaDistrict && callerSuppliedDistrict) {
    errors.push(`${base.area || base.neighborhood || base.city} belongs to ${knownAreaDistrict}, not ${base.district}`);
  } else if (knownAreaDistrict && (!base.district || base.district !== knownAreaDistrict)) {
    normalized.district = knownAreaDistrict;
    base.district = knownAreaDistrict;
  }
  if (base.district && DISTRICTS.includes(base.district) && !base.region) {
    normalized.region = regionForDistrict(base.district);
    base.region = normalized.region;
  }
  const hierarchy = normalizeReviewLocationHierarchy(base);
  errors.push(...hierarchy.errors);

  const listingTypeRaw = cleanText(normalized.listing_type || normalized.listingType || normalized.type || normalized.category);
  if (listingTypeRaw) {
    const listingType = listingTypeRaw.toLowerCase() === 'students' ? 'student' : listingTypeRaw.toLowerCase();
    if (!LISTING_TYPES.includes(listingType)) errors.push('listing_type must be sale, rent, land, commercial, or student');
    normalized.listing_type = listingType;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'district') && normalized.district && !DISTRICTS.includes(cleanText(normalized.district))) {
    errors.push('district must be one of Uganda\'s valid districts');
  }

  return {
    patch: normalized,
    hierarchy,
    errors: [...new Set(errors)]
  };
}

async function updateStaffEditableListing(req, propertyId, listingPatch = {}, reviewPatch = {}) {
  const existingResult = await db.query('SELECT * FROM properties WHERE id = $1 LIMIT 1', [propertyId]);
  if (!existingResult.rows.length) {
    const error = new Error('Property not found');
    error.status = 404;
    throw error;
  }
  const existing = existingResult.rows[0];
  const { patch, hierarchy, errors } = normalizeStaffListingPatch(existing, listingPatch);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.status = 400;
    error.details = errors;
    throw error;
  }

  const setParts = [];
  const values = [propertyId];
  const changed = [];
  const add = (column, value, cast = '') => {
    values.push(value);
    setParts.push(`${column} = $${values.length}${cast}`);
    changed.push(column);
  };
  const fieldMap = {
    title: (value) => cleanText(value),
    description: (value) => cleanText(value),
    listing_type: (value) => cleanText(value).toLowerCase(),
    area: (value) => cleanText(value),
    district: (value) => cleanText(value),
    address: (value) => cleanText(value) || null,
    price: (value) => toNullableInt(value),
    price_period: (value) => cleanText(value) || null,
    property_type: (value) => cleanText(value) || null,
    title_type: (value) => cleanText(value) || null,
    bedrooms: (value) => toNullableInt(value),
    bathrooms: (value) => toNullableInt(value),
    lister_name: (value) => cleanText(value) || null,
    lister_phone: (value) => normalizePhoneLite(value) || null,
    lister_email: (value) => cleanText(value).toLowerCase() || null,
    latitude: (value) => toNullableFloat(value),
    longitude: (value) => toNullableFloat(value),
    nearest_university: (value) => cleanText(value) || null,
    distance_to_uni_km: (value) => toNullableFloat(value),
    room_type: (value) => cleanText(value) || null,
    students_welcome: (value) => boolField(value)
  };

  Object.entries(fieldMap).forEach(([key, transform]) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    const value = transform(patch[key]);
    if (['title', 'description', 'area', 'district', 'listing_type'].includes(key) && !value) return;
    add(key, value);
  });

  const extraPatch = {};
  [
    'region',
    'city',
    'neighborhood',
    'street_name',
    'location_note',
    'source_url',
    'source_platform',
    'geocoding_provider',
    'place_id',
    'location_confidence',
    'map_pin_source',
    'nearest_university',
    'distance_to_uni_km',
    'room_type',
    'room_arrangement',
    'gender_pref',
    'student_room_label'
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(patch, key)) extraPatch[key] = cleanText(patch[key]) || null;
  });
  if (Object.prototype.hasOwnProperty.call(patch, 'land_title_available')) {
    extraPatch.land_title_available = cleanText(patch.land_title_available) || null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'student_universities')) {
    extraPatch.student_universities = cleanArray(patch.student_universities);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'students_welcome')) {
    extraPatch.students_welcome = boolField(patch.students_welcome);
  }
  if (hierarchy.region) extraPatch.region = hierarchy.region;
  if (hierarchy.city) extraPatch.city = hierarchy.city;
  if (hierarchy.neighborhood) extraPatch.neighborhood = hierarchy.neighborhood;
  if (Object.prototype.hasOwnProperty.call(patch, 'amenities')) {
    values.push(JSON.stringify(cleanArray(patch.amenities)));
    setParts.push(`amenities = $${values.length}::jsonb`);
    changed.push('amenities');
  }
  const warningOverrides = safeJsonObject(reviewPatch.warning_overrides, null);
  if (warningOverrides) {
    extraPatch.review_warning_overrides = warningOverrides;
    extraPatch.staff_review_warning_overrides = warningOverrides;
    extraPatch.staff_review_warning_overrides_at = new Date().toISOString();
    extraPatch.staff_review_warning_overrides_by = actorId(req);
  }
  if (Object.keys(extraPatch).length) {
    const latitude = toNullableFloat(patch.latitude ?? patch.lat);
    const longitude = toNullableFloat(patch.longitude ?? patch.lng ?? patch.lon ?? patch.long);
    const resolvedLocationLabel = firstNonEmpty(
      [extraPatch.street_name, extraPatch.neighborhood || patch.area, extraPatch.city, patch.district].filter(Boolean).join(', '),
      patch.address,
      existing.address
    );
    extraPatch.staff_location_reviewed_at = new Date().toISOString();
    extraPatch.staff_location_reviewed_by = actorId(req);
    extraPatch.staff_review_public_listing_facts = {
      title: cleanText(patch.title),
      listing_type: cleanText(patch.listing_type),
      region: cleanText(extraPatch.region),
      district: cleanText(patch.district),
      city: cleanText(extraPatch.city),
      neighborhood: cleanText(extraPatch.neighborhood),
      area: cleanText(patch.area),
      address: cleanText(patch.address),
      street_name: cleanText(extraPatch.street_name),
      property_type: cleanText(patch.property_type),
      title_type: cleanText(patch.title_type),
      land_title_available: cleanText(extraPatch.land_title_available),
      lister_phone: normalizePhoneLite(patch.lister_phone),
      nearest_university: cleanText(extraPatch.nearest_university),
      distance_to_uni_km: toNullableFloat(extraPatch.distance_to_uni_km),
      room_type: cleanText(extraPatch.room_type),
      room_arrangement: cleanText(extraPatch.room_arrangement),
      gender_pref: cleanText(extraPatch.gender_pref),
      student_universities: cleanArray(extraPatch.student_universities),
      price: toNullableInt(patch.price),
      price_period: cleanText(patch.price_period),
      latitude,
      longitude
    };
    if (resolvedLocationLabel) extraPatch.resolved_location_label = resolvedLocationLabel;
    if (latitude != null && longitude != null) {
      extraPatch.map_pin_confirmed = true;
      extraPatch.map_pin_source = cleanText(extraPatch.map_pin_source) || 'staff_review';
      extraPatch.map_pin_confirmed_at = new Date().toISOString();
    }
    values.push(JSON.stringify(extraPatch));
    setParts.push(`extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $${values.length}::jsonb`);
    changed.push('extra_fields');
  }

  const checklist = safeJsonObject(reviewPatch.checklist, null);
  if (checklist) {
    add('moderation_checklist', JSON.stringify(checklist), '::jsonb');
  }
  const notes = cleanText(reviewPatch.notes || reviewPatch.review_notes);
  if (notes) add('moderation_notes', notes);
  const reason = cleanText(reviewPatch.reason);
  if (reason) add('moderation_reason', reason);
  const stage = cleanText(reviewPatch.stage) || 'in_review';
  add('moderation_stage', stage);

  if (!setParts.length) return { changed_fields: [], property: existing };

  const updated = await db.query(
    `UPDATE properties
     SET ${setParts.join(', ')}, reviewed_by = COALESCE($${values.length + 1}::uuid, reviewed_by), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [...values, actorId(req)]
  );
  await db.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, checklist, delivery)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      propertyId,
      actorId(req),
      'staff_listing_preview_saved',
      reason || null,
      notes || null,
      JSON.stringify(checklist || {}),
      JSON.stringify({ changed_fields: changed, hierarchy, warning_override_count: warningOverrides ? Object.keys(warningOverrides).length : 0 })
    ]
  ).catch(() => {});
  await logStaffActivity(req, 'staff_listing_preview_saved', {
    targetType: 'property',
    targetId: propertyId,
    metadata: { changed_fields: changed, hierarchy }
  });
  return { changed_fields: changed, property: updated.rows[0] };
}

async function loadStaffPropertyPreview(propertyId) {
  const property = await safeOne(
    `SELECT p.*
     FROM properties p
     WHERE p.id::text = $1 OR p.inquiry_reference = $1
     LIMIT 1`,
    [cleanText(propertyId)],
    null
  );
  if (!property) return null;
  const [images, duplicates, events, previousListerListings, reusedImages, idNumberMatches, matchingUsers] = await Promise.all([
    safeRows(
      `SELECT id, url, is_primary, sort_order, slot_key, room_label, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [property.id]
    ),
    safeRows(
      `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.address, p.price, p.status, p.lister_phone,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') AS source_url,
              p.created_at
       FROM properties p
       WHERE p.id <> $1
         AND LOWER(COALESCE(p.status, '')) NOT IN (${sqlList(STAFF_REMOVED_STATUSES)})
         AND LOWER(COALESCE(p.moderation_stage, '')) NOT IN (${sqlList(STAFF_REMOVED_STATUSES)})
         AND NOT ${sourceQualitySuppressedSql('p')}
         AND (
           (COALESCE($2::text, '') <> '' AND p.lister_phone = $2)
           OR LOWER(COALESCE(p.title, '')) = LOWER(COALESCE($3::text, ''))
           OR (
             COALESCE($4::text, '') <> ''
             AND COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') = $4
           )
           OR (
             COALESCE($5::text, '') <> ''
             AND COALESCE($6::text, '') <> ''
             AND LOWER(COALESCE(p.area, '')) = LOWER($5)
             AND p.district = $6
             AND COALESCE(p.price, 0) = COALESCE($7::bigint, 0)
           )
         )
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [
        property.id,
        property.lister_phone || null,
        property.title || '',
        firstNonEmpty(property.extra_fields?.source_url, property.extra_fields?.source_post_url),
        property.area || '',
        property.district || '',
        property.price || 0
      ]
    ),
    safeRows(
      `SELECT id, actor_id, action, status_from, status_to, reason, notes, created_at
       FROM property_moderation_events
       WHERE property_id = $1
       ORDER BY created_at DESC
      LIMIT 30`,
      [property.id]
    ),
    safeRows(
      `SELECT id, title, listing_type, district, area, price, status, created_at
       FROM properties
       WHERE id <> $1
         AND (
           ($2::text IS NOT NULL AND lister_phone = $2)
           OR ($3::text IS NOT NULL AND LOWER(COALESCE(lister_email, '')) = LOWER($3))
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [property.id, property.lister_phone || null, property.lister_email || null]
    ),
    safeRows(
      `SELECT DISTINCT p.id, p.title, p.status, i.url
       FROM property_images current_i
       JOIN property_images i ON i.url = current_i.url AND i.property_id <> current_i.property_id
       JOIN properties p ON p.id = i.property_id
       WHERE current_i.property_id = $1
       ORDER BY p.title ASC
       LIMIT 20`,
      [property.id]
    ),
    safeRows(
      `SELECT id, title, lister_name, lister_phone, lister_email, status, created_at
       FROM properties
       WHERE id <> $1
         AND $2::text IS NOT NULL
         AND id_number = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [property.id, property.id_number || null]
    ),
    safeRows(
      `SELECT id, first_name, last_name, phone, email, role, status, created_at
       FROM users
       WHERE ($1::text IS NOT NULL AND phone = $1)
          OR ($2::text IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER($2))
       ORDER BY created_at DESC
       LIMIT 20`,
      [property.lister_phone || null, property.lister_email || null]
    )
  ]);
  const extra = safeJsonObject(property.extra_fields, {});
  const sourceUrl = firstNonEmpty(extra.source_url, extra.source_post_url, extra.tiktok_url, extra.youtube_url, extra.video_url);
  const automatedReview = buildAutomatedListingReview({
    listing: property,
    images,
    previousListerListings,
    likelyDuplicates: duplicates,
    reusedImages,
    idNumberMatches,
    matchingUsers,
    externalDuplicateScan: getCachedExternalDuplicateScan(property)
  });
  return {
    ...property,
    images,
    duplicate_review: {
      count: duplicates.length,
      rows: duplicates,
      must_check_before_approval: duplicates.length > 0
    },
    source_evidence: {
      platform: firstNonEmpty(extra.source_platform, extra.source_badge, property.source, property.listed_via),
      source_url: sourceUrl,
      source_contact_url: firstNonEmpty(extra.source_contact_url, extra.source_channel_url),
      source_name: firstNonEmpty(extra.source_name, extra.public_display_name, property.lister_name),
      first_posted_online: firstNonEmpty(extra.first_posted_online_label, extra.source_published_label, extra.first_posted_online_at)
    },
    location_review: {
      region: firstNonEmpty(extra.region, regionForDistrict(property.district)),
      city: firstNonEmpty(extra.city),
      neighborhood: firstNonEmpty(extra.neighborhood),
      known_area_district: districtForKnownArea(property.area) || '',
      warnings: districtForKnownArea(property.area) && districtForKnownArea(property.area) !== property.district
        ? [`${property.area} belongs to ${districtForKnownArea(property.area)}, not ${property.district}`]
        : []
    },
    review: {
      checklist: automatedReview.checklist || safeJsonObject(property.moderation_checklist, {}),
      checklist_items: automatedReview.checks || [],
      notes: property.moderation_notes || '',
      reason: property.moderation_reason || extra.moderation_reason || '',
      warning_overrides: safeJsonObject(extra.review_warning_overrides, {}),
      automated: automatedReview
    },
    events
  };
}

function extractQuestionFilter(question = '') {
  const lower = String(question || '').toLowerCase();
  const district = DISTRICTS.find((item) => lower.includes(item.toLowerCase())) || '';
  const quoted = question.match(/["']([^"']{2,60})["']/)?.[1] || '';
  const locationMatches = [...String(question || '').matchAll(/\b(?:in|around|near|at)\s+([a-z][a-z\s-]{2,60})/gi)];
  const rawLocation = quoted || locationMatches.at(-1)?.[1] || '';
  let area = cleanText(rawLocation)
    .split(/\b(?:as|with|who|that|are|is|have|has|looking|want|need|needing|csv|download|phone|phones|number|numbers|contact|contacts|people|properties|property|houses|house|land|rent|sale|area|district|website|uganda)\b/i)[0]
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (district && area.toLowerCase().includes(district.toLowerCase())) area = '';
  const limitMatch = question.match(/\b(?:top|first|limit|show)\s+(\d{1,3})\b/i)
    || question.match(/\b(\d{1,3})\s+(?:phone|phones|number|numbers|contact|contacts|rows|people)\b/i);
  return {
    district,
    area: area && area.length > 2 ? area : '',
    limit: Math.min(STAFF_CONTACT_EXPORT_LIMIT, Math.max(1, parseInt(limitMatch?.[1] || STAFF_CONTACT_EXPORT_LIMIT, 10) || STAFF_CONTACT_EXPORT_LIMIT))
  };
}

function wantsContactExport(question = '') {
  return /\b(phone|phones|number|numbers|contact|contacts|whatsapp|email|emails|download|csv|list)\b/i.test(question);
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function contactsCsv(rows = []) {
  const headers = ['source', 'name', 'phone', 'email', 'location', 'label', 'reference', 'status'];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))
  ].join('\n');
}

function normalizeContactRow(row = {}) {
  return {
    source: row.source || '',
    name: row.name || '',
    phone: normalizePhoneLite(row.phone || row.whatsapp || ''),
    email: row.email || '',
    location: row.location || '',
    label: row.label || '',
    reference: row.reference || '',
    status: row.status || ''
  };
}

async function collectStaffContactRows(question = '') {
  const filter = extractQuestionFilter(question);
  const like = `%${filter.area || filter.district || ''}%`;
  const params = [filter.area || filter.district || '', like, filter.limit];
  const [listingRows, leadRows, propertyLeadRows, mortgageRows, whatsappRows, adRows] = await Promise.all([
    safeRows(
      `SELECT 'property_listing' AS source, id::text AS reference, COALESCE(lister_name, title) AS name,
              lister_phone AS phone, lister_email AS email,
              CONCAT_WS(', ', NULLIF(area, ''), NULLIF(district, '')) AS location,
              title AS label, status
       FROM properties p
       WHERE ${publicCustomerVisiblePropertyWhere('p')}
         AND (COALESCE(lister_phone, '') <> '' OR COALESCE(lister_email, '') <> '')
         AND ($1::text = '' OR area ILIKE $2 OR district ILIKE $2 OR address ILIKE $2 OR title ILIKE $2)
       ORDER BY approved_at DESC NULLS LAST, updated_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'lead' AS source, l.id::text AS reference, COALESCE(c.name, 'Lead contact') AS name,
              COALESCE(c.phone, c.whatsapp) AS phone, c.email AS email,
              COALESCE(NULLIF(l.location, ''), l.metadata->>'preferred_area', '') AS location,
              COALESCE(l.message, l.lead_type, 'Lead') AS label, l.lead_status AS status
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       WHERE (COALESCE(c.phone, c.whatsapp, c.email, '') <> '')
         AND ($1::text = '' OR l.location ILIKE $2 OR l.message ILIKE $2 OR l.metadata->>'preferred_area' ILIKE $2)
       ORDER BY l.created_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'property_lead' AS source, id::text AS reference, COALESCE(name, 'Property lead') AS name,
              phone, email, preferred_area AS location,
              COALESCE(notes, purpose, category, 'Property lead') AS label, 'open' AS status
       FROM property_leads
       WHERE (COALESCE(phone, email, '') <> '')
         AND ($1::text = '' OR preferred_area ILIKE $2 OR notes ILIKE $2 OR category ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'mortgage_enquiry' AS source, id::text AS reference, 'Mortgage lead' AS name,
              user_phone AS phone, '' AS email,
              COALESCE(payload->>'location', payload->>'preferred_area', '') AS location,
              CONCAT_WS(' ', property_purpose, property_price::text) AS label, 'open' AS status
       FROM mortgage_enquiries
       WHERE COALESCE(user_phone, '') <> ''
         AND ($1::text = '' OR payload->>'location' ILIKE $2 OR payload->>'preferred_area' ILIKE $2 OR property_purpose ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'whatsapp_conversation' AS source, phone AS reference, 'WhatsApp contact' AS name,
              phone, '' AS email, COALESCE(metadata->>'location', metadata->>'preferred_area', '') AS location,
              COALESCE(last_summary, category, 'WhatsApp conversation') AS label, status
       FROM whatsapp_conversation_state
       WHERE COALESCE(phone, '') <> ''
         AND ($1::text = '' OR last_summary ILIKE $2 OR category ILIKE $2 OR metadata->>'location' ILIKE $2)
       ORDER BY COALESCE(last_message_at, updated_at) DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'advertising_inquiry' AS source, id::text AS reference, COALESCE(full_name, business_name, 'Advertiser') AS name,
              phone, email, COALESCE(target_locations::text, '') AS location,
              COALESCE(product_interests::text, 'Advertising inquiry') AS label, status
       FROM advertising_inquiries
       WHERE COALESCE(phone, email, '') <> ''
         AND ($1::text = '' OR full_name ILIKE $2 OR business_name ILIKE $2 OR target_locations::text ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      params
    )
  ]);
  const seen = new Set();
  const rows = [...listingRows, ...leadRows, ...propertyLeadRows, ...mortgageRows, ...whatsappRows, ...adRows]
    .map(normalizeContactRow)
    .filter((row) => row.phone || row.email)
    .filter((row) => {
      const key = `${row.source}:${row.phone || row.email}:${row.reference}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, filter.limit);
  return { rows, filter };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    logStaffActivity(req, 'staff_dashboard_opened', { metadata: { role: req.userAuth?.role } })
      .catch((error) => logger.warn('Staff dashboard activity log failed', { message: error.message }));
    const fast = boolLike(req.query?.fast || req.query?.light);
    const panels = boolLike(req.query?.panels);
    if (fast) return res.json({ ok: true, data: await dashboardFastPayload(req) });
    if (panels) return res.json({ ok: true, data: await dashboardPanelsPayload(req) });
    return res.json({ ok: true, data: await dashboardPayload(req) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/profile', async (req, res, next) => {
  try {
    const userId = actorId(req);
    const currentProfile = staffProfile(req.userAuth);
    const firstName = cleanText(req.body.first_name || req.body.firstName);
    const lastName = cleanText(req.body.last_name || req.body.lastName);
    const phone = normalizePhoneLite(req.body.phone);
    const personalEmail = cleanText(req.body.personal_email || req.body.personalEmail).toLowerCase();
    const paymentProfile = {
      simba_account: cleanText(req.body.simba_account || req.body.simbaAccount),
      payment_provider: cleanText(req.body.payment_provider || req.body.paymentProvider || 'mobile_money'),
      mobile_money_name: cleanText(req.body.mobile_money_name || req.body.mobileMoneyName),
      mobile_money_phone: normalizePhoneLite(req.body.mobile_money_phone || req.body.mobileMoneyPhone || phone || req.userAuth.phone),
      bank_name: cleanText(req.body.bank_name || req.body.bankName),
      bank_account_name: cleanText(req.body.bank_account_name || req.body.bankAccountName),
      bank_account_last4: cleanText(req.body.bank_account_last4 || req.body.bankAccountLast4).replace(/\D/g, '').slice(-4),
      payout_notes: cleanText(req.body.payout_notes || req.body.payoutNotes)
    };
    const profilePatch = {
      ...currentProfile,
      personal_email: personalEmail || currentProfile.personal_email || '',
      payment_profile: {
        ...safeJsonObject(currentProfile.payment_profile, {}),
        ...paymentProfile
      },
      staff_settings_updated_at: new Date().toISOString()
    };
    const updated = await db.query(
      `UPDATE users
       SET first_name = COALESCE(NULLIF($2, ''), first_name),
           last_name = COALESCE(NULLIF($3, ''), last_name),
           phone = COALESCE(NULLIF($4, ''), phone),
           profile_data = COALESCE(profile_data, '{}'::jsonb) || $5::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, preferred_language, preferred_contact_channel, profile_data`,
      [userId, firstName, lastName, phone, JSON.stringify(profilePatch)]
    );
    req.userAuth = updated.rows[0] || req.userAuth;
    await logStaffActivity(req, 'staff_profile_saved', {
      targetType: 'staff_profile',
      targetId: userId,
      metadata: { has_payment_profile: true, has_personal_email: !!personalEmail }
    });
    return res.json({ ok: true, data: publicStaffUser(req.userAuth) });
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/:id/preview', async (req, res, next) => {
  try {
    const preview = await loadStaffPropertyPreview(req.params.id);
    if (!preview) return res.status(404).json({ ok: false, error: 'Property not found' });
    await logStaffActivity(req, 'staff_listing_preview_opened', {
      targetType: 'property',
      targetId: preview.id,
      metadata: { duplicate_count: preview.duplicate_review?.count || 0 }
    });
    return res.json({ ok: true, data: preview });
  } catch (error) {
    return next(error);
  }
});

router.patch('/properties/:id/review', async (req, res, next) => {
  try {
    const listingPatch = safeJsonObject(req.body.listing, req.body || {});
    const reviewPatch = {
      checklist: safeJsonObject(req.body.checklist, {}),
      notes: req.body.notes || req.body.review_notes,
      reason: req.body.reason,
      stage: req.body.stage || 'in_review',
      warning_overrides: safeJsonObject(req.body.warning_overrides, {})
    };
    const saved = await updateStaffEditableListing(req, req.params.id, listingPatch, reviewPatch);
    const preview = await loadStaffPropertyPreview(req.params.id);
    return res.json({ ok: true, data: preview, changed_fields: saved.changed_fields || [] });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message, details: error.details || undefined });
    }
    return next(error);
  }
});

router.post('/source-intake/exact-social/import', async (req, res, next) => {
  try {
    const inputPosts = Array.isArray(req.body?.posts) ? req.body.posts : (Array.isArray(req.body) ? req.body : []);
    const inputUrls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const rawText = cleanText(req.body?.raw_text || req.body?.rawText || req.body?.text || '');
    const dryRun = req.body?.dry_run !== false && req.body?.dryRun !== false;
    const asyncJob = !dryRun && (
      req.body?.async_job === true
      || req.body?.asyncJob === true
      || req.body?.background === true
    );
    const exactInputCount = countExactSocialInputs({ posts: inputPosts, urls: inputUrls, rawText });
    if (!exactInputCount) {
      return res.status(400).json({
        ok: false,
        error: 'Paste at least one exact social post/video URL before importing.'
      });
    }
    if (exactInputCount > STAFF_EXACT_SOCIAL_IMPORT_LIMIT) {
      return res.status(400).json({
        ok: false,
        error: `Staff exact social import is capped at ${STAFF_EXACT_SOCIAL_IMPORT_LIMIT} posts per batch.`
      });
    }
    const fetchOembed = req.body?.fetch_oembed !== false && req.body?.fetchOembed !== false;
    const fetchPublicMetadata = req.body?.fetch_public_metadata !== false && req.body?.fetchPublicMetadata !== false;
    const importPayload = {
      db,
      posts: inputPosts.slice(0, STAFF_EXACT_SOCIAL_IMPORT_LIMIT),
      urls: inputUrls.slice(0, STAFF_EXACT_SOCIAL_IMPORT_LIMIT),
      rawText,
      dryRun,
      fetchOembed,
      fetchPublicMetadata
    };
    const runImport = async () => {
      const result = await importExactSocialSourcePosts(importPayload);
      const responseData = {
        ...result,
        exact_input_count: exactInputCount,
        metadata_skipped_for_large_batch: !fetchOembed && !fetchPublicMetadata
      };
      if (!dryRun) clearStaffFastDashboardCache();
      await logStaffActivity(req, dryRun ? 'staff_social_import_previewed' : 'staff_social_import_queued', {
        targetType: 'source_intake',
        metadata: {
          batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
          dry_run: dryRun,
          async_job: asyncJob,
          exact_input_count: exactInputCount,
          exact_social_url_count: result.exact_social_url_count || 0,
          metadata_fetch_count: result.metadata_fetch_count || 0,
          created_properties: result.created_properties || 0,
          existing_properties: result.existing_properties || 0,
          review_queue_properties: result.review_queue_properties || 0,
          source_review_count: result.source_review_count || 0
        }
      });
      return responseData;
    };
    if (asyncJob) {
      const job = createStaffSourceIntakeJob({
        type: 'exact_social_import',
        exactInputCount,
        dryRun
      });
      runStaffSourceIntakeJob(job.id, runImport);
      await logStaffActivity(req, 'staff_social_import_job_accepted', {
        targetType: 'source_intake',
        targetId: job.id,
        metadata: {
          batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
          dry_run: dryRun,
          exact_input_count: exactInputCount,
          metadata_fetch_enabled: fetchOembed || fetchPublicMetadata
        }
      });
      return res.status(202).json({ ok: true, data: publicStaffSourceIntakeJob(job) });
    }
    return res.json({ ok: true, data: await runImport() });
  } catch (error) {
    return next(error);
  }
});

router.get('/source-intake/jobs/:jobId', async (req, res) => {
  pruneStaffSourceIntakeJobs();
  const job = staffSourceIntakeJobs.get(cleanText(req.params.jobId));
  if (!job) {
    return res.status(404).json({ ok: false, error: 'Source intake job not found or already expired.' });
  }
  return res.json({ ok: true, data: publicStaffSourceIntakeJob(job) });
});

router.post('/source-intake/social-sweep', async (req, res, next) => {
  try {
    const platform = cleanText(req.body?.platform || 'all').toLowerCase() || 'all';
    const focus = cleanText(req.body?.focus || req.body?.sweep_focus || req.body?.sweepFocus || '');
    const dryRun = req.body?.dry_run !== false && req.body?.dryRun !== false;
    const asyncJob = !dryRun && req.body?.async_job !== false && req.body?.asyncJob !== false && req.body?.background !== false;
    const maxSources = Math.min(
      STAFF_SOCIAL_SWEEP_SOURCE_LIMIT,
      Math.max(1, parseInt(req.body?.max_sources || req.body?.maxSources || (dryRun ? 12 : 50), 10) || (dryRun ? 12 : 50))
    );
    const youtubeJobMode = cleanText(req.body?.youtube_job_mode || req.body?.youtubeJobMode || 'channel_uploads') || 'channel_uploads';
    const sweepPayload = {
      db,
      platform,
      focus,
      dryRun,
      maxSources,
      sourceOffset: Math.max(0, parseInt(req.body?.source_offset || req.body?.sourceOffset || 0, 10) || 0),
      maxResultsPerSource: Math.min(
        STAFF_SOCIAL_SWEEP_RESULT_LIMIT,
        Math.max(1, parseInt(req.body?.max_results || req.body?.maxResults || (dryRun ? 10 : 25), 10) || (dryRun ? 10 : 25))
      ),
      maxPagesPerSource: Math.min(
        STAFF_SOCIAL_SWEEP_PAGE_LIMIT,
        Math.max(1, parseInt(req.body?.max_pages || req.body?.maxPages || (dryRun ? 1 : 2), 10) || (dryRun ? 1 : 2))
      ),
      searchMode: cleanText(req.body?.x_search_mode || req.body?.xSearchMode || 'all'),
      lookbackDays: Math.max(0, parseInt(req.body?.lookback_days || req.body?.lookbackDays || 0, 10) || 0),
      publishedAfter: cleanText(req.body?.published_after || req.body?.publishedAfter || '2026-01-01T00:00:00.000Z'),
      youtubeJobMode
    };
    const runSweep = async () => {
      const result = await runSocialPlatformPostSweep(sweepPayload);
      const responseData = {
        ...result,
        requested_source_count: maxSources,
      };
      if (!dryRun) clearStaffFastDashboardCache();
      await logStaffActivity(req, dryRun ? 'staff_social_sweep_previewed' : 'staff_social_sweep_run', {
        targetType: 'source_intake',
        metadata: {
          batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
          platform,
          focus,
          youtube_job_mode: youtubeJobMode,
          dry_run: dryRun,
          async_job: asyncJob,
          max_sources: maxSources,
          max_results_per_source: sweepPayload.maxResultsPerSource,
          max_pages_per_source: sweepPayload.maxPagesPerSource,
          source_offset: sweepPayload.sourceOffset,
          discovered_posts_count: result.discovered_posts_count || 0,
          created_properties: result.import_result?.created_properties || 0,
          auto_live_properties: result.import_result?.auto_live_properties || 0,
          existing_properties: result.import_result?.existing_properties || 0
        }
      });
      return responseData;
    };
    if (asyncJob) {
      const activeSweep = activeStaffSourceIntakeJob('social_sweep');
      if (activeSweep) {
        activeSweep.message = 'A social sweep is already queued or running. Poll this job before launching another sweep.';
        logStaffActivityInBackground(req, 'staff_social_sweep_job_reused', {
          targetType: 'source_intake',
          targetId: activeSweep.id,
          metadata: {
            batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
            platform,
            focus,
            youtube_job_mode: youtubeJobMode,
            max_sources: maxSources,
            reason: 'social_sweep_already_running'
          }
        });
        return res.status(202).json({
          ok: true,
          data: {
            ...publicStaffSourceIntakeJob(activeSweep),
            already_running: true,
            reused_existing_job: true,
          }
        });
      }
      const job = createStaffSourceIntakeJob({
        type: 'social_sweep',
        requestedSourceCount: maxSources,
        dryRun
      });
      runStaffSourceIntakeJob(job.id, runSweep);
      logStaffActivityInBackground(req, 'staff_social_sweep_job_accepted', {
        targetType: 'source_intake',
        targetId: job.id,
        metadata: {
          batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
          platform,
          focus,
          youtube_job_mode: youtubeJobMode,
          max_sources: maxSources,
          max_results_per_source: sweepPayload.maxResultsPerSource,
          max_pages_per_source: sweepPayload.maxPagesPerSource,
          source_offset: sweepPayload.sourceOffset,
        }
      });
      return res.status(202).json({ ok: true, data: publicStaffSourceIntakeJob(job) });
    }
    return res.json({ ok: true, data: await runSweep() });
  } catch (error) {
    return next(error);
  }
});

router.patch('/leads/:id', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const previous = await db.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!previous.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });

    const updates = [];
    const values = [];
    const add = (field, value, cast = '') => {
      values.push(value);
      updates.push(`${field} = $${values.length}${cast}`);
    };
    ['lead_status', 'lifecycle_stage', 'priority', 'sla_status', 'outcome', 'lost_reason'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) add(field, cleanText(req.body[field]) || null);
    });
    if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_me')) {
      add('assigned_to_user_id', req.body.assigned_to_me === false ? null : actorId(req));
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_user_id')) {
      const requestedAssignee = cleanText(req.body.assigned_to_user_id) || null;
      if (requestedAssignee && requestedAssignee !== actorId(req)) {
        return res.status(403).json({ ok: false, error: 'Moderators can only assign a lead to themselves from this dashboard' });
      }
      add('assigned_to_user_id', requestedAssignee);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'next_follow_up_at')) add('next_follow_up_at', cleanText(req.body.next_follow_up_at) || null, '::timestamptz');
    if (Object.prototype.hasOwnProperty.call(req.body, 'last_contacted_at')) add('last_contacted_at', cleanText(req.body.last_contacted_at) || null, '::timestamptz');
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No lead updates provided' });

    values.push(leadId);
    const updated = await db.query(
      `UPDATE leads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    await addLeadActivity(db, {
      leadId,
      actorUserId: actorId(req),
      actorType: 'moderator',
      activityType: 'staff_lead_update',
      oldStatus: previous.rows[0].lead_status,
      newStatus: updated.rows[0].lead_status,
      message: cleanText(req.body.note) || 'Lead updated by staff',
      metadata: { changed_fields: updates.map((item) => item.split(' = ')[0]) }
    });
    await logStaffActivity(req, 'staff_lead_updated', { targetType: 'lead', targetId: leadId, metadata: { changed_fields: updates.map((item) => item.split(' = ')[0]) } });
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/leads/:id/activities', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const found = await db.query('SELECT id FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const activity = await addLeadActivity(db, {
      leadId,
      actorUserId: actorId(req),
      actorType: 'moderator',
      activityType: cleanText(req.body.activity_type || req.body.activityType) || 'note',
      message: cleanText(req.body.message || req.body.note) || null,
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    });
    await logStaffActivity(req, 'staff_lead_activity_added', { targetType: 'lead', targetId: leadId, metadata: { activity_id: activity?.id || null } });
    return res.status(201).json({ ok: true, data: activity });
  } catch (error) {
    return next(error);
  }
});

router.patch('/advertising/inquiries/:id', async (req, res, next) => {
  try {
    const inquiryId = req.params.id;
    const allowedStatuses = ['new', 'contacted', 'proposal_sent', 'won', 'lost', 'archived'];
    const status = req.body.status ? cleanText(req.body.status).toLowerCase() : undefined;
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid inquiry status' });
    }
    const updates = [];
    const values = [];
    const add = (column, value, cast = '') => {
      values.push(value);
      updates.push(`${column} = $${values.length}${cast}`);
    };
    if (status) add('status', status);
    if (Object.prototype.hasOwnProperty.call(req.body, 'internal_notes')) add('internal_notes', cleanText(req.body.internal_notes) || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'estimated_value_ugx')) add('estimated_value_ugx', Math.max(0, parseInt(req.body.estimated_value_ugx, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_me')) add('assigned_to_user_id', req.body.assigned_to_me === false ? null : actorId(req));
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No updates provided' });

    values.push(inquiryId);
    const updated = await db.query(
      `UPDATE advertising_inquiries
       SET ${updates.join(', ')}, last_staff_action_at = NOW(), updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Advertising inquiry not found' });
    await logStaffActivity(req, 'staff_advertising_inquiry_updated', { targetType: 'advertising_inquiry', targetId: inquiryId, metadata: { status: updated.rows[0].status } });
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/assistant/query', async (req, res, next) => {
  try {
    const question = cleanText(req.body.question || req.body.prompt);
    if (!question) return res.status(400).json({ ok: false, error: 'question is required' });

    if (wantsContactExport(question)) {
      const { rows: contacts, filter } = await collectStaffContactRows(question);
      const csv = contactsCsv(contacts);
      const answer = contacts.length
        ? [
          `Found ${contacts.length} staff-accessible contact${contacts.length === 1 ? '' : 's'}${filter.area || filter.district ? ` matching ${filter.area || filter.district}` : ''}.`,
          `Sources include live listing owners, CRM leads, WhatsApp conversations, mortgage/bank enquiries, property leads, and advertising inquiries where contact details exist.`,
          `Showing the first ${contacts.length}; use Copy CSV to download/share the working list.`
        ].join(' ')
        : 'No matching staff-accessible contact rows were found. Try a wider location, ask for all open leads, or check whether the record has a phone/email saved.';
      await logStaffActivity(req, 'staff_ai_contact_lookup', {
        targetType: 'staff_ai',
        metadata: {
          question,
          area: filter.area || null,
          district: filter.district || null,
          returned_contacts: contacts.length
        }
      });
      return res.json({
        ok: true,
        data: {
          answer,
          model: 'staff_contact_export_v1',
          provider: getProviderMeta(),
          contacts,
          csv,
          csv_filename: `makaug-staff-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
          contact_count: contacts.length,
          filter
        }
      });
    }

    const areaMatch = question.match(/\b(?:in|around|near|for)\s+([a-z][a-z\s-]{2,40})/i);
    const area = cleanText(areaMatch?.[1] || '').replace(/\b(properties|property|houses|land|rent|sale|area|district)\b/gi, '').trim();
    const [demandRows, listingRows, whatsappRows, sourceRows, adRows, bankRows] = await Promise.all([
      safeRows(
        `SELECT
           COALESCE(NULLIF(location, ''), metadata->>'preferred_area', 'Unknown') AS location,
           COUNT(*)::int AS lead_count,
           COUNT(*) FILTER (WHERE lead_status = 'open')::int AS open_count,
           COUNT(*) FILTER (WHERE priority IN ('high','urgent') OR lead_score >= 50)::int AS hot_count,
           COALESCE(AVG(budget), 0)::bigint AS avg_budget
         FROM leads
         WHERE ($1::text = '' OR location ILIKE $2 OR metadata->>'preferred_area' ILIKE $2 OR message ILIKE $2)
         GROUP BY 1
         ORDER BY lead_count DESC, location ASC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT
           COALESCE(NULLIF(area, ''), NULLIF(district, ''), 'Unknown') AS location,
           COUNT(*) FILTER (WHERE ${publicCustomerVisiblePropertyWhere('p')})::int AS live_listings,
           COUNT(*) FILTER (WHERE ${activePendingReviewWhere('p')})::int AS pending_review,
           COUNT(*) FILTER (WHERE COALESCE(lister_phone, '') <> '')::int AS listings_with_phone
         FROM properties p
         WHERE ($1::text = '' OR p.area ILIKE $2 OR p.district ILIKE $2 OR p.address ILIKE $2)
         GROUP BY 1
         ORDER BY live_listings DESC, pending_review DESC, location ASC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT category, status, COUNT(*)::int AS count
         FROM whatsapp_conversation_state
         WHERE ($1::text = '' OR last_summary ILIKE $2 OR category ILIKE $2 OR metadata->>'location' ILIKE $2)
         GROUP BY category, status
         ORDER BY count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT platform, status, COUNT(*)::int AS count
         FROM property_source_registry
         WHERE ($1::text = '' OR source_name ILIKE $2 OR source_url ILIKE $2 OR array_to_string(districts, ', ') ILIKE $2)
         GROUP BY platform, status
         ORDER BY count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(estimated_value_ugx), 0)::bigint AS pipeline_ugx
         FROM advertising_inquiries
         WHERE ($1::text = '' OR target_locations::text ILIKE $2 OR business_name ILIKE $2 OR message ILIKE $2)
         GROUP BY status
         ORDER BY count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT COALESCE(payload->>'preferred_area', payload->>'location', 'Unknown') AS location,
                COUNT(*)::int AS mortgage_count,
                COUNT(*) FILTER (WHERE user_phone IS NOT NULL AND user_phone <> '')::int AS with_phone
         FROM mortgage_enquiries
         WHERE ($1::text = '' OR payload->>'preferred_area' ILIKE $2 OR payload->>'location' ILIKE $2 OR property_purpose ILIKE $2)
         GROUP BY 1
         ORDER BY mortgage_count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      )
    ]);
    const context = {
      question,
      area: area || null,
      demand: demandRows,
      listings: listingRows,
      whatsapp: whatsappRows,
      sources: sourceRows,
      advertising: adRows,
      bank_mortgage: bankRows,
      metric_definitions: staffMetricDefinitions()
    };
    let answer = [
      area ? `For ${area}, I found these staff-safe signals:` : 'Here are the staff-safe makaug signals I can share:',
      `Leads: ${demandRows.reduce((total, row) => total + safeNumber(row, 'lead_count'), 0)} captured in the matching demand sample.`,
      `Live listings: ${listingRows.reduce((total, row) => total + safeNumber(row, 'live_listings'), 0)} in the matching listing sample.`,
      `Pending moderation: ${listingRows.reduce((total, row) => total + safeNumber(row, 'pending_review'), 0)}.`,
      `WhatsApp open/needs-human signals: ${whatsappRows.reduce((total, row) => total + safeNumber(row, 'count'), 0)}.`
    ].join(' ');
    let model = 'staff_safe_template';
    const client = getProviderClient();
    if (client) {
      model = getTaskModel('staff_assistant', 'gpt-4.1-mini');
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You are the makaug staff data assistant. Answer from the provided JSON only. Be concise and action-oriented. Staff can use operational contact data only through the explicit contact export mode; do not invent phone numbers. Do not expose owner financials, secrets, admin API keys, passwords, discounts, refunds, or platform owner-only controls.'
          },
          { role: 'user', content: JSON.stringify(context) }
        ]
      });
      answer = cleanText(completion?.choices?.[0]?.message?.content || answer) || answer;
    }
    await logStaffActivity(req, 'staff_ai_question_answered', { targetType: 'staff_ai', metadata: { question, area: area || null, model } });
    return res.json({ ok: true, data: { answer, model, context, provider: getProviderMeta() } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
