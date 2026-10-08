#!/usr/bin/env node
'use strict';

// READ-ONLY: where the database disagrees with the rate card (config/pricing.js).
//
//   node scripts/pricing-db-drift.js
//
// Compares billing_settings, products, advertising_placements, the
// st_listing.listing_fee_ugx default and open pay_links against PRICING, and
// lists fee-exempt agents with no end date. Prints a diff; exits 1 on drift,
// 0 when everything matches. Only SELECTs: nothing is changed.

const { Client } = require('pg');
const PRICING = require('../config/pricing');
const { getAdvertisingPlacements } = require('../services/advertisingCatalogService');

async function collectDrift(client) {
  const drift = [];
  const add = (area, detail) => drift.push({ area, ...detail });

  const settings = Object.fromEntries((await client.query('SELECT key, value FROM billing_settings')).rows.map((r) => [r.key, r.value]));
  const expected = { lister_fee: PRICING.private_listing.amount_ugx, agent_fee: PRICING.agent_subscription.amount_ugx };
  for (const [key, amount] of Object.entries(expected)) {
    const stored = settings[key]?.monthly_ugx;
    if (stored !== undefined && stored !== null && Number(stored) !== amount) add('billing_settings', { key, field: 'monthly_ugx', db: Number(stored), rate_card: amount });
  }
  if (settings.lister_fee?.free_days !== undefined && Number(settings.lister_fee.free_days) !== PRICING.private_listing.trial_days) {
    add('billing_settings', { key: 'lister_fee', field: 'free_days', db: Number(settings.lister_fee.free_days), rate_card: PRICING.private_listing.trial_days });
  }
  const viewsText = String(settings.lister_views_message?.text || '');
  const literal = viewsText.match(/UGX\s?[\d,]{4,}/);
  if (literal) add('billing_settings', { key: 'lister_views_message', field: 'text', db: literal[0], rate_card: 'use {monthly_fee}' });

  const products = (await client.query('SELECT key, price, active, description, metadata FROM products')).rows;
  for (const row of products) {
    if (row.key === 'listing_boost_basic' && Number(row.price) !== PRICING.boosted.amount_ugx) add('products', { key: row.key, field: 'price', db: Number(row.price), rate_card: PRICING.boosted.amount_ugx });
    if (PRICING.off_sale[row.key] && row.active) add('products', { key: row.key, field: 'active', db: true, rate_card: false });
    if (PRICING.off_sale[row.key] && row.metadata?.status !== PRICING.off_sale[row.key].status) add('products', { key: row.key, field: 'metadata.status', db: row.metadata?.status || null, rate_card: PRICING.off_sale[row.key].status });
    if (/remains free by default/i.test(String(row.description || ''))) add('products', { key: row.key, field: 'description', db: 'contains "Everyone remains Free by default"', rate_card: 'removed' });
  }

  // advertising_placements.base_price_ugx is never shown: catalog keys take the
  // rate card, and any other row goes through the weekly display rule. These
  // are listed for information only and do not count as drift.
  const info = [];
  const catalog = new Map(getAdvertisingPlacements().map((p) => [p.key, p]));
  const placements = (await client.query('SELECT key, base_price_ugx, is_active FROM advertising_placements')).rows;
  for (const row of placements) {
    const shown = catalog.has(row.key) ? catalog.get(row.key).base_price_ugx : PRICING.displayOffer(row.base_price_ugx, 7).price_ugx;
    if ((row.base_price_ugx == null ? null : Number(row.base_price_ugx)) !== shown) {
      info.push({ area: 'advertising_placements', key: row.key, db: row.base_price_ugx == null ? null : Number(row.base_price_ugx), shown: shown ?? 'Price on request' });
    }
  }
  drift.info = info;

  const stDefault = (await client.query(
    `SELECT column_default FROM information_schema.columns WHERE table_name = 'st_listing' AND column_name = 'listing_fee_ugx'`
  )).rows[0]?.column_default;
  const stDefaultAmount = Number(String(stDefault || '').replace(/[^\d]/g, ''));
  if (stDefault && stDefaultAmount !== PRICING.short_stay_host.amount_ugx) add('st_listing', { field: 'listing_fee_ugx default', db: stDefaultAmount, rate_card: PRICING.short_stay_host.amount_ugx });

  const linkAmounts = { listing_fee: PRICING.private_listing.amount_ugx, agent_subscription: PRICING.agent_subscription.amount_ugx, short_term_fee: PRICING.short_stay_host.amount_ugx };
  const links = (await client.query(`SELECT code, purpose, amount_ugx FROM pay_links WHERE status = 'open' ORDER BY created_at`)).rows;
  for (const link of links) {
    const amount = linkAmounts[link.purpose];
    if (amount && Number(link.amount_ugx) % amount !== 0) add('pay_links', { code: link.code, purpose: link.purpose, db: Number(link.amount_ugx), rate_card: amount });
  }

  const exempt = (await client.query(
    `SELECT id, full_name FROM agents WHERE fee_exempt AND fee_exempt_until IS NULL AND removed_at IS NULL ORDER BY full_name`
  ).catch((error) => {
    if (error.code === '42703') return { rows: [{ id: null, full_name: '(migration 190 not applied: agents.fee_exempt_until is missing)' }] };
    throw error;
  })).rows;
  for (const agent of exempt) add('agents', { field: 'fee_exempt_until', id: agent.id, name: agent.full_name, db: null, rate_card: 'an end date' });

  return drift;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const drift = await collectDrift(client);
    await client.query('ROLLBACK');
    console.log(`Rate card ${PRICING.version}: ${drift.length ? `${drift.length} difference(s)` : 'the database matches'}`);
    for (const item of drift) console.log(`  ${JSON.stringify(item)}`);
    if (drift.info?.length) {
      console.log(`Info (not drift: these stored prices are never shown; the rate card or "Price on request" is):`);
      for (const item of drift.info) console.log(`  ${JSON.stringify(item)}`);
    }
    return drift.length ? 1 : 0;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { collectDrift };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error.message || error);
    process.exit(2);
  });
}
