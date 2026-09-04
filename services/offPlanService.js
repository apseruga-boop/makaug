'use strict';

const { randomUUID, createHash } = require('crypto');

const DEVELOPMENT_STATUSES = ['draft', 'pending_review', 'changes_requested', 'published', 'archived', 'rejected'];
const VERIFICATION_STATUSES = ['needs_verification', 'partially_verified', 'verified'];
const ENQUIRY_CHANNELS = ['whatsapp', 'email', 'call'];
const PUBLIC_COUNTRY_CODES = ['UG', 'KE'];
const JSON_ARRAY_FIELDS = ['unit_types', 'payment_plan', 'images', 'videos', 'floor_plans', 'amenities', 'nearby_places'];
const JSON_OBJECT_FIELDS = ['brochure_settings', 'walkthrough_settings', 'extra_fields'];

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function nullableText(value, max = 4000) {
  const text = cleanText(value, max);
  return text || null;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function nullableUuid(value, label = 'Identifier') {
  const text = nullableText(value, 80);
  if (!text) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw validationError(`${label} must be a valid UUID`);
  }
  return text;
}

function nullableIsoDate(value, label = 'Date') {
  const text = nullableText(value, 30);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw validationError(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw validationError(`${label} is invalid`);
  }
  return text;
}

function nullableTimestamp(value, label = 'Date and time') {
  const text = nullableText(value, 80);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw validationError(`${label} is invalid`);
  return parsed.toISOString();
}

function finiteNumber(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableInteger(value) {
  const number = finiteNumber(value, null);
  return number == null ? null : Math.max(0, Math.round(number));
}

function percentage(value) {
  const number = finiteNumber(value, null);
  if (number == null) return null;
  return Math.max(0, Math.min(100, Math.round(number * 100) / 100));
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return fallback;
  }
}

function jsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function jsonObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function slugify(value) {
  return cleanText(value, 180)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : nullableText(value, 40);
}

function normalizeDevelopmentRow(row = {}) {
  const normalized = { ...row };
  for (const field of JSON_ARRAY_FIELDS) normalized[field] = jsonArray(row[field]);
  for (const field of JSON_OBJECT_FIELDS) normalized[field] = jsonObject(row[field]);
  normalized.construction_progress = finiteNumber(row.construction_progress, null);
  normalized.discount_percentage = finiteNumber(row.discount_percentage, null);
  normalized.latitude = finiteNumber(row.latitude, null);
  normalized.longitude = finiteNumber(row.longitude, null);
  normalized.launch_price_ugx = finiteNumber(row.launch_price_ugx, null);
  normalized.reservation_fee_ugx = finiteNumber(row.reservation_fee_ugx, null);
  normalized.units_total = nullableInteger(row.units_total);
  normalized.units_sold = nullableInteger(row.units_sold);
  normalized.units_available = nullableInteger(row.units_available);
  normalized.payment_plan_months = nullableInteger(row.payment_plan_months);
  normalized.completion_date = dateOnly(row.completion_date);
  if (normalized.units_total != null && normalized.units_sold != null && normalized.units_sold <= normalized.units_total) {
    normalized.units_available = Math.max(0, normalized.units_total - normalized.units_sold);
  }
  if (normalized.units_total && normalized.units_sold != null) {
    normalized.sales_progress = Math.max(0, Math.min(100, Math.round((normalized.units_sold / normalized.units_total) * 1000) / 10));
  } else {
    normalized.sales_progress = null;
  }
  return normalized;
}

function safeDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function money(value) {
  return Math.round(Math.max(0, finiteNumber(value, 0)));
}

function buildOffPlanPaymentSchedule(input = {}) {
  const price = money(input.price_ugx ?? input.price);
  const currency = cleanText(input.currency || 'UGX', 3).toUpperCase() || 'UGX';
  const months = Math.max(1, Math.min(120, nullableInteger(input.months) || 1));
  const depositPercent = percentage(input.deposit_percent ?? input.depositPercent) || 0;
  const reservationFee = Math.min(price, money(input.reservation_fee_ugx ?? input.reservationFee));
  const depositAmount = money(price * depositPercent / 100);
  const upfrontAmount = Math.min(price, Math.max(reservationFee, depositAmount));
  const balance = Math.max(0, price - upfrontAmount);
  const startDate = safeDate(input.start_date || input.startDate, new Date());
  const baseInstalment = months ? Math.floor(balance / months) : balance;
  const remainder = balance - (baseInstalment * months);
  const instalments = [];
  for (let index = 1; index <= months; index += 1) {
    instalments.push({
      number: index,
      due_date: addMonths(startDate, index).toISOString().slice(0, 10),
      amount: baseInstalment + (index === months ? remainder : 0),
      currency
    });
  }
  return {
    price,
    currency,
    months,
    deposit_percent: depositPercent,
    reservation_fee: reservationFee,
    upfront_amount: upfrontAmount,
    balance,
    monthly_amount: instalments[0]?.amount || 0,
    total_payable: upfrontAmount + instalments.reduce((total, item) => total + item.amount, 0),
    start_date: startDate.toISOString().slice(0, 10),
    instalments
  };
}

function publicationBlockers(raw = {}) {
  const row = normalizeDevelopmentRow(raw);
  const blockers = [];
  if (!cleanText(row.name, 220)) blockers.push('Project name is required.');
  if (!cleanText(row.developer_name, 220)) blockers.push('Verified developer name is required.');
  if (cleanText(row.description, 10000).length < 80) blockers.push('A verified project description of at least 80 characters is required.');
  if (!cleanText(row.area, 140) || !cleanText(row.district, 140)) blockers.push('Area and district are required.');
  if (row.latitude == null || row.longitude == null) blockers.push('A verified map pin is required.');
  if (!row.completion_date) blockers.push('Expected completion date is required.');
  if (row.construction_progress == null) blockers.push('Construction progress percentage is required.');
  if (row.units_total == null || row.units_sold == null) blockers.push('Total units and units sold are required.');
  if (row.units_total != null && row.units_sold != null && row.units_sold > row.units_total) blockers.push('Units sold cannot exceed total units.');
  if (!row.unit_types.length) blockers.push('At least one unit type is required.');
  if (row.unit_types.some((unit) => !(finiteNumber(unit.price_ugx, 0) > 0))) blockers.push('Every unit type needs a verified UGX price.');
  if (!(finiteNumber(row.launch_price_ugx, 0) > 0)) blockers.push('A verified starting price in UGX is required.');
  if (!row.payment_plan.length || !(row.payment_plan_months > 0)) blockers.push('A verified payment plan and payment period are required.');
  if (row.images.filter((image) => cleanText(image?.url, 2000) && cleanText(image?.caption, 300)).length < 3) blockers.push('At least three labelled project images are required.');
  if (row.verification_status !== 'verified') blockers.push('Staff verification must be marked complete.');
  return Array.from(new Set(blockers));
}

function isPublicationReady(raw = {}) {
  const row = normalizeDevelopmentRow(raw);
  return PUBLIC_COUNTRY_CODES.includes(row.country_code)
    && row.status === 'published'
    && row.verification_status === 'verified'
    && publicationBlockers(row).length === 0;
}

function publicPreviewBlockers(raw = {}) {
  const row = normalizeDevelopmentRow(raw);
  const blockers = [];
  if (row.verification_status !== 'partially_verified') blockers.push('Preview projects must be marked partially verified.');
  if (row.extra_fields?.public_preview_approved !== true) blockers.push('Public preview approval is required.');
  if (!cleanText(row.name, 220)) blockers.push('Project name is required.');
  const isMakaugManagedOverseas = row.country_code !== 'UG'
    && row.extra_fields?.contact_mode === 'makaug_managed'
    && row.extra_fields?.source_documents_verified === true;
  if ((!row.source_agent_id && !isMakaugManagedOverseas) || !cleanText(row.source_display_name, 220)) blockers.push('An attributed source is required.');
  if (cleanText(row.description, 10000).length < 80) blockers.push('A source-labelled project description is required.');
  if (!cleanText(row.area, 140) || !cleanText(row.district, 140)) blockers.push('Area and district are required.');
  if (row.latitude == null || row.longitude == null) blockers.push('An area map point is required.');
  if (!row.unit_types.length) blockers.push('At least one unit type is required.');
  const pricedUnits = row.unit_types.filter((unit) => finiteNumber(unit.price_original, 0) > 0);
  if (!pricedUnits.length) blockers.push('At least one unit type needs its original source price.');
  if (pricedUnits.some((unit) => !cleanText(unit.price_original_currency, 3))) blockers.push('Every supplied source price needs its original currency.');
  if (pricedUnits.some((unit) => !(finiteNumber(unit.price_ugx, 0) > 0))) blockers.push('Every supplied source price needs an indicative UGX conversion.');
  if (!(finiteNumber(row.launch_price_ugx, 0) > 0)) blockers.push('An indicative starting price in UGX is required.');
  if (!row.payment_plan.length || !(row.payment_plan_months > 0)) blockers.push('The supplied payment period is required.');
  if (row.images.filter((image) => cleanText(image?.url, 2000) && cleanText(image?.caption, 300)).length < 3) blockers.push('At least three labelled project images are required.');
  return Array.from(new Set(blockers));
}

function isPubliclyVisible(raw = {}) {
  const row = normalizeDevelopmentRow(raw);
  if (!PUBLIC_COUNTRY_CODES.includes(row.country_code) || row.status !== 'published') return false;
  return isPublicationReady(row) || publicPreviewBlockers(row).length === 0;
}

function normalizeWritePayload(input = {}, { partial = false } = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const payload = {};
  const assign = (key, transform) => {
    if (partial && !Object.prototype.hasOwnProperty.call(value, key)) return;
    payload[key] = transform(value[key]);
  };
  assign('country_code', (item) => {
    const countryCode = cleanText(item || 'UG', 2).toUpperCase() || 'UG';
    if (!PUBLIC_COUNTRY_CODES.includes(countryCode)) throw validationError('Country must be Uganda or Kenya');
    return countryCode;
  });
  assign('name', (item) => cleanText(item, 220));
  assign('slug', (item) => slugify(item || value.name));
  assign('developer_name', (item) => nullableText(item, 220));
  assign('source_agent_id', (item) => nullableUuid(item, 'Source agent ID'));
  assign('source_display_name', (item) => nullableText(item, 220));
  assign('status', (item) => DEVELOPMENT_STATUSES.includes(cleanText(item).toLowerCase()) ? cleanText(item).toLowerCase() : 'pending_review');
  assign('verification_status', (item) => VERIFICATION_STATUSES.includes(cleanText(item).toLowerCase()) ? cleanText(item).toLowerCase() : 'needs_verification');
  assign('description', (item) => cleanText(item, 20000));
  assign('area', (item) => nullableText(item, 140));
  assign('district', (item) => nullableText(item, 140));
  assign('address', (item) => nullableText(item, 800));
  assign('latitude', (item) => finiteNumber(item, null));
  assign('longitude', (item) => finiteNumber(item, null));
  assign('project_type', (item) => cleanText(item || 'development', 80) || 'development');
  assign('completion_date', (item) => nullableIsoDate(item, 'Completion date'));
  assign('construction_started_at', (item) => nullableIsoDate(item, 'Construction start date'));
  assign('construction_progress', percentage);
  assign('units_total', nullableInteger);
  assign('units_sold', nullableInteger);
  assign('units_available', nullableInteger);
  assign('launch_price_ugx', nullableInteger);
  assign('original_currency', (item) => cleanText(item || 'UGX', 3).toUpperCase() || 'UGX');
  assign('reservation_fee_ugx', nullableInteger);
  assign('discount_percentage', percentage);
  assign('payment_plan_months', nullableInteger);
  for (const key of JSON_ARRAY_FIELDS) assign(key, jsonArray);
  for (const key of JSON_OBJECT_FIELDS) assign(key, jsonObject);
  return payload;
}

function managedSelect() {
  return `SELECT d.*,
    a.id AS source_agent_profile_id,
    CASE WHEN a.status = 'approved' THEN a.full_name ELSE NULL END AS source_agent_name,
    CASE WHEN a.status = 'approved' THEN a.company_name ELSE NULL END AS source_agent_company,
    CASE WHEN a.status = 'approved' THEN a.profile_photo_url ELSE NULL END AS source_agent_profile_photo_url,
    a.status AS source_agent_status,
    (SELECT COUNT(*)::int FROM off_plan_enquiries e WHERE e.development_id = d.id) AS enquiry_count,
    (SELECT COUNT(*)::int FROM off_plan_walkthrough_jobs w WHERE w.development_id = d.id) AS walkthrough_job_count
    FROM off_plan_developments d
    LEFT JOIN agents a ON a.id = d.source_agent_id`;
}

function publicSelect() {
  return `SELECT d.*,
    a.id AS source_agent_profile_id,
    CASE WHEN a.status = 'approved' THEN a.full_name ELSE NULL END AS source_agent_name,
    CASE WHEN a.status = 'approved' THEN a.company_name ELSE NULL END AS source_agent_company,
    CASE WHEN a.status = 'approved' THEN a.profile_photo_url ELSE NULL END AS source_agent_profile_photo_url,
    CASE WHEN a.status = 'approved' THEN a.bio ELSE NULL END AS source_agent_bio,
    CASE WHEN a.status = 'approved' THEN a.whatsapp ELSE NULL END AS source_agent_whatsapp,
    CASE WHEN a.status = 'approved' THEN a.phone ELSE NULL END AS source_agent_phone,
    CASE WHEN a.status = 'approved' THEN a.email ELSE NULL END AS source_agent_email,
    a.status AS source_agent_status
    FROM off_plan_developments d
    LEFT JOIN agents a ON a.id = d.source_agent_id`;
}

async function listPublicDevelopments(db, query = {}) {
  const requestedCountry = cleanText(query.country_code || query.country || 'UG', 2).toUpperCase();
  const countryCode = PUBLIC_COUNTRY_CODES.includes(requestedCountry) ? requestedCountry : 'UG';
  const values = [countryCode];
  const filters = [`d.country_code = $1`, `d.status = 'published'`, `(d.verification_status = 'verified' OR (d.verification_status = 'partially_verified' AND d.extra_fields->>'public_preview_approved' = 'true'))`];
  const add = (sql, value) => {
    values.push(value);
    filters.push(sql.replace('?', `$${values.length}`));
  };
  const search = cleanText(query.q || query.search, 160);
  if (search) add(`CONCAT_WS(' ', d.name, d.developer_name, d.area, d.district, d.description) ILIKE ?`, `%${search}%`);
  if (query.district) add(`LOWER(d.district) = LOWER(?)`, cleanText(query.district, 140));
  if (query.area) add(`LOWER(d.area) = LOWER(?)`, cleanText(query.area, 140));
  if (finiteNumber(query.max_price_ugx, null) != null) add(`d.launch_price_ugx <= ?`, money(query.max_price_ugx));
  if (finiteNumber(query.min_price_ugx, null) != null) add(`d.launch_price_ugx >= ?`, money(query.min_price_ugx));
  if (query.project_type) add(`LOWER(d.project_type) LIKE LOWER(?)`, `%${cleanText(query.project_type, 80)}%`);
  if (nullableInteger(query.bedrooms) != null) add(`EXISTS (SELECT 1 FROM jsonb_array_elements(d.unit_types) unit WHERE (unit->>'bedrooms') ~ '^\\d+$' AND (unit->>'bedrooms')::int = ?)`, nullableInteger(query.bedrooms));
  if (nullableInteger(query.payment_months) != null) add(`d.payment_plan_months >= ?`, nullableInteger(query.payment_months));
  if (nullableInteger(query.max_payment_months) != null) add(`d.payment_plan_months <= ?`, nullableInteger(query.max_payment_months));
  if (nullableInteger(query.completion_year) != null) add(`EXTRACT(YEAR FROM d.completion_date)::int = ?`, nullableInteger(query.completion_year));
  const limit = Math.max(1, Math.min(60, nullableInteger(query.limit) || 24));
  const result = await db.query(
    `${publicSelect()} WHERE ${filters.join(' AND ')} ORDER BY d.published_at DESC NULLS LAST, d.created_at DESC LIMIT ${limit}`,
    values
  );
  return result.rows.map(normalizeDevelopmentRow).filter(isPubliclyVisible);
}

async function getPublicDevelopment(db, slug, countryCode = 'UG') {
  const requestedCountry = cleanText(countryCode, 2).toUpperCase();
  const normalizedCountry = PUBLIC_COUNTRY_CODES.includes(requestedCountry) ? requestedCountry : 'UG';
  const result = await db.query(
    `${publicSelect()} WHERE d.country_code = $1 AND d.slug = $2 AND d.status = 'published' AND (d.verification_status = 'verified' OR (d.verification_status = 'partially_verified' AND d.extra_fields->>'public_preview_approved' = 'true')) LIMIT 1`,
    [normalizedCountry, slugify(slug)]
  );
  const development = result.rows[0] ? normalizeDevelopmentRow(result.rows[0]) : null;
  return development && isPubliclyVisible(development) ? development : null;
}

async function listManagedDevelopments(db, query = {}) {
  const values = [];
  const filters = [];
  const requestedCountry = cleanText(query.country_code || query.country, 2).toUpperCase();
  if (PUBLIC_COUNTRY_CODES.includes(requestedCountry)) {
    values.push(requestedCountry);
    filters.push(`d.country_code = $${values.length}`);
  } else {
    filters.push(`d.country_code = ANY(ARRAY['UG','KE'])`);
  }
  if (query.status && DEVELOPMENT_STATUSES.includes(cleanText(query.status).toLowerCase())) {
    values.push(cleanText(query.status).toLowerCase());
    filters.push(`d.status = $${values.length}`);
  }
  const search = cleanText(query.q || query.search, 160);
  if (search) {
    values.push(`%${search}%`);
    filters.push(`CONCAT_WS(' ', d.name, d.developer_name, d.area, d.district, d.source_display_name) ILIKE $${values.length}`);
  }
  const result = await db.query(`${managedSelect()} WHERE ${filters.join(' AND ')} ORDER BY d.updated_at DESC LIMIT 200`, values);
  return result.rows.map((row) => ({ ...normalizeDevelopmentRow(row), publication_blockers: publicationBlockers(row) }));
}

async function getManagedDevelopment(db, id) {
  const result = await db.query(`${managedSelect()} WHERE d.id = $1 LIMIT 1`, [id]);
  return result.rows[0] ? { ...normalizeDevelopmentRow(result.rows[0]), publication_blockers: publicationBlockers(result.rows[0]) } : null;
}

async function writeDevelopment(db, input, { id = null, actorId = null, actorRole = null } = {}) {
  const payload = normalizeWritePayload(input, { partial: Boolean(id) });
  if (payload.status === 'published') {
    const error = new Error('Use the review status action to publish a verified project');
    error.status = 400;
    throw error;
  }
  if (!id && payload.verification_status === 'verified') {
    payload.verification_status = 'needs_verification';
  }
  if (!id && (!payload.name || !payload.slug)) {
    const error = new Error('Project name is required');
    error.status = 400;
    throw error;
  }
  if (id && !Object.keys(payload).length) return getManagedDevelopment(db, id);
  if (id) {
    const fields = [];
    const values = [id];
    for (const [key, value] of Object.entries(payload)) {
      values.push(JSON_ARRAY_FIELDS.includes(key) || JSON_OBJECT_FIELDS.includes(key) ? JSON.stringify(value) : value);
      fields.push(`${key} = $${values.length}${JSON_ARRAY_FIELDS.includes(key) || JSON_OBJECT_FIELDS.includes(key) ? '::jsonb' : ''}`);
    }
    values.push(actorId);
    fields.push(`updated_by = $${values.length}`, 'updated_at = NOW()');
    if (payload.verification_status === 'verified') {
      fields.push(`verified_by = $${values.length}`, 'verified_at = NOW()');
    } else if (Object.prototype.hasOwnProperty.call(payload, 'verification_status')) {
      fields.push('verified_by = NULL', 'verified_at = NULL');
    }
    const result = await db.query(`UPDATE off_plan_developments SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, values);
    if (result.rows[0]) await recordEvent(db, { developmentId: id, action: payload.verification_status === 'verified' ? 'verification_completed' : 'project_updated', actorId, actorRole, payload: { fields: Object.keys(payload) } });
    return result.rows[0] ? { ...normalizeDevelopmentRow(result.rows[0]), publication_blockers: publicationBlockers(result.rows[0]) } : null;
  }
  const columns = Object.keys(payload);
  const values = Object.values(payload).map((value, index) => JSON_ARRAY_FIELDS.includes(columns[index]) || JSON_OBJECT_FIELDS.includes(columns[index]) ? JSON.stringify(value) : value);
  columns.push('created_by', 'updated_by');
  values.push(actorId, actorId);
  const placeholders = columns.map((key, index) => `$${index + 1}${JSON_ARRAY_FIELDS.includes(key) || JSON_OBJECT_FIELDS.includes(key) ? '::jsonb' : ''}`);
  const result = await db.query(`INSERT INTO off_plan_developments (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`, values);
  await recordEvent(db, { developmentId: result.rows[0].id, action: 'project_created_for_review', actorId, actorRole, payload: { source_display_name: result.rows[0].source_display_name || null } });
  return { ...normalizeDevelopmentRow(result.rows[0]), publication_blockers: publicationBlockers(result.rows[0]) };
}

async function setDevelopmentStatus(db, id, status, { actorId = null, actorRole = null } = {}) {
  const requested = cleanText(status).toLowerCase();
  if (!DEVELOPMENT_STATUSES.includes(requested)) {
    const error = new Error('Invalid development status');
    error.status = 400;
    throw error;
  }
  const existing = await getManagedDevelopment(db, id);
  if (!existing) return null;
  const blockers = requested === 'published' ? publicationBlockers(existing) : [];
  if (blockers.length) {
    const error = new Error('Project cannot be published until verification is complete');
    error.status = 409;
    error.details = blockers;
    throw error;
  }
  const result = await db.query(
    `UPDATE off_plan_developments SET status = $2, published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END, updated_by = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, requested, actorId]
  );
  await recordEvent(db, { developmentId: id, action: `status_${requested}`, actorId, actorRole, payload: { previous_status: existing.status } });
  return result.rows[0] ? { ...normalizeDevelopmentRow(result.rows[0]), publication_blockers: publicationBlockers(result.rows[0]) } : null;
}

async function deleteArchivedDevelopment(db, id, { actorId = null, actorRole = null } = {}) {
  const existing = await getManagedDevelopment(db, id);
  if (!existing) return null;
  if (existing.status !== 'archived') {
    const error = new Error('Archive the project before permanently deleting it');
    error.status = 409;
    throw error;
  }
  const result = await db.query(
    `DELETE FROM off_plan_developments WHERE id = $1 AND status = 'archived' RETURNING *`,
    [id]
  );
  const deleted = result.rows[0] || null;
  if (deleted) {
    await recordEvent(db, {
      action: 'project_deleted',
      actorId,
      actorRole,
      payload: {
        deleted_development_id: deleted.id,
        name: deleted.name,
        slug: deleted.slug,
        previous_status: deleted.status
      }
    });
  }
  return deleted ? normalizeDevelopmentRow(deleted) : null;
}

async function recordEvent(db, { developmentId = null, enquiryId = null, action, actorId = null, actorRole = null, payload = {} } = {}) {
  return db.query(
    `INSERT INTO off_plan_development_events (development_id, enquiry_id, action, actor_id, actor_role, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
    [developmentId, enquiryId, cleanText(action, 100), actorId, nullableText(actorRole, 80), JSON.stringify(jsonObject(payload))]
  );
}

function enquiryExternalKey(input = {}) {
  if (input.external_key) return cleanText(input.external_key, 220);
  const raw = [input.preferred_contact_channel, input.phone, input.email, input.message, new Date().toISOString().slice(0, 10)].join('|');
  return `offplan:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

async function createEnquiry(db, input = {}) {
  const channel = cleanText(input.preferred_contact_channel || input.channel).toLowerCase();
  if (!ENQUIRY_CHANNELS.includes(channel)) {
    const error = new Error('Choose WhatsApp, email, or call');
    error.status = 400;
    throw error;
  }
  const name = cleanText(input.name || 'WhatsApp customer', 180);
  const phone = nullableText(input.phone, 80);
  const email = nullableText(input.email, 260);
  if (!name) {
    const error = new Error('Name is required');
    error.status = 400;
    throw error;
  }
  if (channel === 'email' && !email) {
    const error = new Error('Email is required for email contact');
    error.status = 400;
    throw error;
  }
  if (['whatsapp', 'call'].includes(channel) && !phone) {
    const error = new Error('Phone number is required');
    error.status = 400;
    throw error;
  }
  const externalKey = enquiryExternalKey({ ...input, preferred_contact_channel: channel });
  const result = await db.query(
    `INSERT INTO off_plan_enquiries (development_id, enquiry_type, preferred_contact_channel, name, phone, email, requested_callback_at, message, source_path, external_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (external_key) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      input.development_id || null,
      cleanText(input.enquiry_type || 'project_interest', 40),
      channel,
      name,
      phone,
      email,
      nullableTimestamp(input.requested_callback_at, 'Requested callback time'),
      nullableText(input.message, 4000),
      nullableText(input.source_path, 1000),
      externalKey,
      JSON.stringify(jsonObject(input.metadata))
    ]
  );
  const enquiry = result.rows[0] || null;
  if (enquiry) {
    await recordEvent(db, {
      developmentId: enquiry.development_id,
      enquiryId: enquiry.id,
      action: 'enquiry_received',
      actorRole: 'customer',
      payload: { preferred_contact_channel: channel, enquiry_type: enquiry.enquiry_type, source_path: enquiry.source_path }
    });
  }
  return enquiry;
}

async function updateEnquiryDelivery(db, id, delivery = {}) {
  const result = await db.query(
    `UPDATE off_plan_enquiries SET notification_delivery = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(jsonObject(delivery))]
  );
  const enquiry = result.rows[0] || null;
  if (enquiry) await recordEvent(db, { developmentId: enquiry.development_id, enquiryId: enquiry.id, action: 'enquiry_notification_attempted', actorRole: 'system', payload: { delivered: delivery.delivered === true, deliveries: jsonArray(delivery.deliveries) } });
  return enquiry;
}

async function listEnquiries(db, query = {}) {
  const values = [];
  const filters = [];
  if (query.status) {
    values.push(cleanText(query.status, 40));
    filters.push(`e.status = $${values.length}`);
  }
  const result = await db.query(
    `SELECT e.*, d.name AS development_name, d.slug AS development_slug FROM off_plan_enquiries e LEFT JOIN off_plan_developments d ON d.id = e.development_id ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY e.created_at DESC LIMIT 200`,
    values
  );
  return result.rows;
}

async function updateEnquiryStatus(db, id, status, actorId = null) {
  const cleanStatus = cleanText(status).toLowerCase();
  if (!['new', 'contacted', 'qualified', 'closed', 'spam'].includes(cleanStatus)) {
    const error = new Error('Invalid enquiry status');
    error.status = 400;
    throw error;
  }
  const result = await db.query(`UPDATE off_plan_enquiries SET status = $2, assigned_to = COALESCE(assigned_to, $3), updated_at = NOW() WHERE id = $1 RETURNING *`, [id, cleanStatus, actorId]);
  if (result.rows[0]) await recordEvent(db, { enquiryId: id, action: `enquiry_${cleanStatus}`, actorId, payload: {} });
  return result.rows[0] || null;
}

async function createWalkthroughJob(db, developmentId, input = {}, { actorId = null, actorRole = null } = {}) {
  const floorPlanUrl = cleanText(input.floor_plan_url, 2000);
  if (!/^https?:\/\//i.test(floorPlanUrl) && !floorPlanUrl.startsWith('/assets/')) {
    const error = new Error('A valid floor-plan URL is required');
    error.status = 400;
    throw error;
  }
  const cameraBrief = {
    route: jsonArray(input.route).length ? jsonArray(input.route) : ['entrance', 'living area', 'kitchen', 'bedrooms', 'outdoor area'],
    narration: cleanText(input.narration, 2000),
    disclaimer: 'Concept walkthrough - final construction and finishes may differ.',
    generated_at: new Date().toISOString()
  };
  const result = await db.query(
    `INSERT INTO off_plan_walkthrough_jobs (development_id, floor_plan_url, status, render_engine, camera_brief, settings, requested_by) VALUES ($1,$2,'brief_ready',$3,$4::jsonb,$5::jsonb,$6) RETURNING *`,
    [developmentId, cleanText(floorPlanUrl, 2000), cleanText(input.render_engine || 'external_3d_pipeline', 80), JSON.stringify(cameraBrief), JSON.stringify(jsonObject(input.settings)), actorId]
  );
  await recordEvent(db, { developmentId, action: 'walkthrough_brief_created', actorId, actorRole, payload: { walkthrough_job_id: result.rows[0]?.id || null } });
  return result.rows[0] || null;
}

async function updateWalkthroughJob(db, id, input = {}, { actorId = null, actorRole = null } = {}) {
  const status = cleanText(input.status).toLowerCase();
  if (!['brief_ready', 'render_requested', 'draft_ready', 'approved', 'failed', 'cancelled'].includes(status)) {
    const error = new Error('Invalid walkthrough status');
    error.status = 400;
    throw error;
  }
  if (['draft_ready', 'approved'].includes(status) && !/^https?:\/\//i.test(cleanText(input.output_video_url, 2000))) {
    const error = new Error('A hosted walkthrough video URL is required');
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `UPDATE off_plan_walkthrough_jobs SET status = $2, output_video_url = NULLIF($3, ''), error_message = NULLIF($4, ''), reviewed_by = $5, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status, cleanText(input.output_video_url, 2000), cleanText(input.error_message, 2000), actorId]
  );
  const job = result.rows[0] || null;
  if (job) await recordEvent(db, { developmentId: job.development_id, action: `walkthrough_${status}`, actorId, actorRole, payload: { walkthrough_job_id: id } });
  return job;
}

module.exports = {
  DEVELOPMENT_STATUSES,
  VERIFICATION_STATUSES,
  buildOffPlanPaymentSchedule,
  createEnquiry,
  createWalkthroughJob,
  deleteArchivedDevelopment,
  getManagedDevelopment,
  getPublicDevelopment,
  listEnquiries,
  listManagedDevelopments,
  listPublicDevelopments,
  isPublicationReady,
  isPubliclyVisible,
  normalizeDevelopmentRow,
  normalizeWritePayload,
  publicationBlockers,
  publicPreviewBlockers,
  recordEvent,
  setDevelopmentStatus,
  slugify,
  updateEnquiryDelivery,
  updateEnquiryStatus,
  updateWalkthroughJob,
  writeDevelopment
};
