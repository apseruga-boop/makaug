'use strict';

// Puts a found-online nightly or short-stay advert into st_listing.
// The row waits in the short-stay moderation queue. Nothing here sends a
// message, email, or payment chase. Found-online sources are never contacted.

const { pricePlausibility } = require('../utils/pricePlausibility');
const { FOUND_ONLINE_LABEL } = require('./freeCategoryHashtagSources');

const MESSAGING_POLICY = 'found_online_never_message';

function compact(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value = '') {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function nightlyAmount(item = {}) {
  const price = Number(item.price);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(price);
}

function placeTypeFor(item = {}) {
  const text = [item.title, item.description, item.sourceText].map(compact).join(' ').toLowerCase();
  if (/\bshared\b/.test(text)) return 'shared_room';
  if (/\b(private room|room only|single room)\b/.test(text)) return 'private_room';
  return 'entire_place';
}

function buildFoundOnlineShortStayRecord(item = {}, agent = {}) {
  const nightly = nightlyAmount(item);
  const plausibility = pricePlausibility({
    listing_type: 'short_term',
    price_period: 'night',
    price: nightly || null,
  });
  const implausible = nightly > 0 && plausibility.plausible === false;
  const sourceUrl = compact(item.sourceUrl || item.source_url || item.postUrl || '');
  const title = compact(item.title || item.sourceTitle || 'Short stay found online').slice(0, 160);
  const description = compact(item.description || item.sourceText || item.caption || title);
  const safeDescription = description.length >= 20
    ? description
    : `${description || title} Found online. Pending short-stay moderation.`.trim();
  const hostName = compact(agent.name || item.sourceAgent?.name || FOUND_ONLINE_LABEL).slice(0, 120) || FOUND_ONLINE_LABEL;
  return {
    title,
    description: safeDescription.slice(0, 6000),
    district: compact(item.district || item.province || ''),
    area: compact(item.area || ''),
    address: compact(item.address || '') || null,
    latitude: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
    longitude: Number.isFinite(Number(item.lng)) ? Number(item.lng) : null,
    place_type: placeTypeFor(item),
    property_type: compact(item.subtype || item.property_type || '') || null,
    bedrooms: Math.max(0, Number(item.beds || item.bedrooms || 1) || 1),
    beds: Math.max(1, Number(item.beds || 1) || 1),
    bathrooms: Math.max(0, Number(item.baths || item.bathrooms || 1) || 1),
    max_guests: 2,
    base_nightly_ugx: implausible ? 0 : nightly,
    host_name: hostName,
    host_phone: '',
    host_whatsapp: null,
    host_email: null,
    host_type: 'owner',
    status: 'pending',
    moderation_stage: 'submitted',
    source: 'imported',
    listed_via: 'import',
    listing_fee_ugx: 0,
    listing_fee_status: 'waived',
    found_online_label: FOUND_ONLINE_LABEL,
    do_not_message: true,
    source_url: sourceUrl,
    extra_fields: {
      found_online_label: FOUND_ONLINE_LABEL,
      source_labels: [FOUND_ONLINE_LABEL],
      do_not_message: true,
      messaging_policy: MESSAGING_POLICY,
      price_on_application: implausible || nightly <= 0,
      price_label: implausible || nightly <= 0 ? 'POA' : null,
      price_review: implausible ? 'implausible' : null,
      implausible_price_raw: implausible ? { price: nightly, reason: plausibility.reason } : null,
      source_url: sourceUrl,
      source_platform: compact(item.sourcePlatform || item.source_platform || agent.platform || ''),
      source_key: compact(item.agentKey || item.source_key || ''),
      source_listing_key: compact(item.key || ''),
      imported_at: new Date().toISOString(),
    },
    moderation_notes: 'Found online. Pending short-stay moderation. Do not message this source.',
  };
}

async function existingShortStayForSource(client, sourceUrl, sourceKey) {
  if (!sourceUrl && !sourceKey) return null;
  const result = await client.query(
    `SELECT id::text AS id, reference, slug, status, moderation_stage, source
     FROM st_listing
     WHERE source = 'imported'
       AND (
         ($1 <> '' AND extra_fields->>'source_url' = $1)
         OR ($2 <> '' AND extra_fields->>'source_listing_key' = $2)
       )
     ORDER BY created_at DESC
     LIMIT 1`,
    [sourceUrl || '', sourceKey || '']
  );
  return result.rows[0] || null;
}

async function insertFoundOnlineShortStayListing(client, item = {}, agent = {}) {
  const record = buildFoundOnlineShortStayRecord(item, agent);
  const existing = await existingShortStayForSource(client, record.source_url, record.extra_fields.source_listing_key);
  if (existing) {
    return {
      already_present: true,
      destination: 'st_listing',
      id: existing.id,
      reference: existing.reference,
      slug: existing.slug,
      status: existing.status,
      moderation_stage: existing.moderation_stage,
      source: 'imported',
      found_online_label: FOUND_ONLINE_LABEL,
      do_not_message: true,
      title: record.title,
      source_url: record.source_url,
    };
  }
  const refResult = await client.query("SELECT nextval('st_listing_reference_seq') AS n");
  const reference = `ST-${String(refResult.rows[0].n).padStart(6, '0')}`;
  const slug = `${slugify(record.title) || 'short-stay'}-${reference.toLowerCase()}`;
  const inserted = await client.query(
    `INSERT INTO st_listing (
       reference, slug, title, description, district, area, address, latitude, longitude,
       place_type, property_type, bedrooms, beds, bathrooms, max_guests,
       base_nightly_ugx, host_name, host_phone, host_whatsapp, host_email, host_type,
       status, moderation_stage, source, listed_via, listing_fee_ugx, listing_fee_status,
       extra_fields, moderation_notes, acquisition_notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,
       $10,$11,$12,$13,$14,$15,
       $16,$17,$18,$19,$20,$21,
       $22,$23,$24,$25,$26,$27,
       $28::jsonb,$29,$30
     )
     RETURNING id::text AS id, reference, slug, status, moderation_stage, source`,
    [
      reference,
      slug,
      record.title,
      record.description,
      record.district,
      record.area,
      record.address,
      record.latitude,
      record.longitude,
      record.place_type,
      record.property_type,
      record.bedrooms,
      record.beds,
      record.bathrooms,
      record.max_guests,
      record.base_nightly_ugx,
      record.host_name,
      record.host_phone,
      record.host_whatsapp,
      record.host_email,
      record.host_type,
      record.status,
      record.moderation_stage,
      record.source,
      record.listed_via,
      record.listing_fee_ugx,
      record.listing_fee_status,
      JSON.stringify(record.extra_fields),
      record.moderation_notes,
      record.moderation_notes,
    ]
  );
  const row = inserted.rows[0];
  return {
    already_present: false,
    destination: 'st_listing',
    id: row.id,
    reference: row.reference,
    slug: row.slug,
    status: row.status,
    moderation_stage: row.moderation_stage,
    source: row.source,
    found_online_label: FOUND_ONLINE_LABEL,
    do_not_message: true,
    title: record.title,
    source_url: record.source_url,
    price_on_application: record.extra_fields.price_on_application === true,
    messaging_policy: MESSAGING_POLICY,
  };
}

module.exports = {
  MESSAGING_POLICY,
  buildFoundOnlineShortStayRecord,
  insertFoundOnlineShortStayListing,
};
