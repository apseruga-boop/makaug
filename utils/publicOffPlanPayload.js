'use strict';

// What an anonymous visitor may see of an off-plan development (C3, 10 Oct 2026).
//
// /api/off-plan returned the whole row (55 keys): staff user ids (created_by,
// updated_by, verified_by), the developer brochure's private storage key and
// hash (extra_fields.source_brochure), internal extraction notes and
// facts_to_confirm, who approved the public preview, and, on a makaug-managed
// project, the source agent's phone, email, WhatsApp and ids. This is an
// explicit allow-list: a field reaches the public only if it is named here.

const TOP_LEVEL_KEYS = [
  'id', 'slug', 'name', 'developer_name', 'country_code', 'status', 'verification_status',
  'description', 'area', 'district', 'address', 'latitude', 'longitude', 'project_type',
  'completion_date', 'construction_started_at', 'construction_progress',
  'units_total', 'units_sold', 'units_available', 'sales_progress',
  'launch_price_ugx', 'original_currency', 'reservation_fee_ugx', 'discount_percentage',
  'payment_plan_months', 'unit_types', 'payment_plan', 'images', 'videos', 'floor_plans',
  'amenities', 'nearby_places', 'source_display_name', 'walkthrough_output_video_url',
  'published_at', 'verified_at', 'updated_at', 'canonical_location_id'
];

const EXTRA_KEYS = [
  'area_overview', 'country_name', 'country_slug', 'region', 'market_summary', 'makaug_service_steps',
  'official_buyer_guidance', 'overseas_finance_policy', 'payment_terms_note', 'public_path',
  'map_precision', 'contact_mode', 'roi_projections', 'reservation_fee_original'
];

// Keys that never appear inside public arrays/objects (images, unit types, ...).
const NESTED_PRIVATE_KEY_RE = /(_by$|storage_ref|storage_key|sha256|facts_to_confirm|brochure_extraction|source_document|confirmed_source)/i;

function scrubNested(value, depth = 0) {
  if (depth > 6) return undefined;
  if (Array.isArray(value)) return value.map((item) => scrubNested(item, depth + 1)).filter((item) => item !== undefined);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !NESTED_PRIVATE_KEY_RE.test(key))
      .map(([key, item]) => [key, scrubNested(item, depth + 1)])
      .filter(([, item]) => item !== undefined));
  }
  return value;
}

function publicOffPlanPayload(development) {
  if (!development || typeof development !== 'object') return development;
  const out = {};
  for (const key of TOP_LEVEL_KEYS) {
    if (development[key] !== undefined) out[key] = scrubNested(development[key]);
  }
  const extra = development.extra_fields && typeof development.extra_fields === 'object' ? development.extra_fields : {};
  out.extra_fields = {};
  for (const key of EXTRA_KEYS) {
    if (extra[key] !== undefined) out.extra_fields[key] = scrubNested(extra[key]);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (/^price_fx_/.test(key)) out.extra_fields[key] = scrubNested(value);
  }
  // The project contact. A makaug-managed project shows only makaug. Otherwise
  // the approved agent's public name, company and photo, and a link to their
  // public profile; never their phone, email, WhatsApp or ids.
  const managed = extra.contact_mode === 'makaug_managed';
  const approvedAgent = String(development.source_agent_status || '').toLowerCase() === 'approved';
  if (!managed && approvedAgent && development.source_agent_name) {
    out.source_agent_name = development.source_agent_name;
    if (development.source_agent_company) out.source_agent_company = development.source_agent_company;
    if (development.source_agent_profile_photo_url) out.source_agent_profile_photo_url = development.source_agent_profile_photo_url;
    const agentId = development.source_agent_profile_id || development.source_agent_id;
    if (agentId) out.source_agent_public_path = `/agents/${encodeURIComponent(String(agentId))}`;
  }
  if (managed) delete out.source_display_name;
  return out;
}

module.exports = { publicOffPlanPayload, TOP_LEVEL_KEYS, EXTRA_KEYS };
