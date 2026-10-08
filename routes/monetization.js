const express = require('express');

const db = require('../config/database');
const { requireAuthenticatedUser } = require('../middleware/auth');
const { cleanText } = require('../middleware/validation');
const {
  MONETIZATION_SPINE_MARKER,
  createHostedPayment,
  handleGenericPaymentWebhook
} = require('../services/paymentProviderService');

const PRICING = require('../config/pricing');

const router = express.Router();

function featureEnabled(name, fallback = false) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value);
}

// Products come from the rate card (config/pricing.js). Retired products
// (Agent Pro, the featured lender slot) and parked ones are not listed, and
// nothing here says listing is free by default.
const OFF_SALE_PRODUCT_KEYS = new Set(Object.keys(PRICING.off_sale));
const BOOST_PRODUCT_KEYS = new Set(['listing_boost_basic']);

function boostedProduct() {
  return {
    key: 'listing_boost_basic',
    type: 'listing_boost',
    name: 'Boosted listing',
    description: `Ranks above standard listings in results and alerts for a month. ${PRICING.vat.label}.`,
    price: PRICING.boosted.amount_ugx,
    currency: PRICING.currency,
    billing: 'one_time',
    period: PRICING.boosted.period,
    unit: PRICING.boosted.unit,
    duration_days: 30 * (PRICING.boosted.months || 1),
    rate_card_version: PRICING.version
  };
}

router.get('/config', async (_req, res, next) => {
  try {
    return res.json({
      ok: true,
      data: {
        marker: MONETIZATION_SPINE_MARKER,
        rate_card_version: PRICING.version,
        vat: { included: true, label: PRICING.vat.label },
        flags: {
          listing_boosts_enabled: featureEnabled('MAKAUG_LISTING_BOOSTS_ENABLED', false)
        },
        products: [boostedProduct()]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/listing-boost/checkout', requireAuthenticatedUser, async (req, res, next) => {
  try {
    if (!featureEnabled('MAKAUG_LISTING_BOOSTS_ENABLED', false)) {
      return res.status(403).json({
        ok: false,
        error: 'Listing boosts are prepared but not live yet.',
        marker: MONETIZATION_SPINE_MARKER
      });
    }
    const listingId = cleanText(req.body.listing_id || req.body.property_id);
    const productKey = cleanText(req.body.product_key || 'listing_boost_basic') || 'listing_boost_basic';
    if (OFF_SALE_PRODUCT_KEYS.has(productKey)) {
      return res.status(410).json({ ok: false, error: 'This product is no longer offered.', code: 'product_off_sale' });
    }
    if (!BOOST_PRODUCT_KEYS.has(productKey)) return res.status(404).json({ ok: false, error: 'Boost product not found' });
    if (!listingId) return res.status(400).json({ ok: false, error: 'listing_id is required' });

    const listingResult = await db.query(
      `SELECT id, title, lister_email, lister_phone, agent_id, status
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [listingId]
    );
    const listing = listingResult.rows[0] || null;
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found' });
    if (String(listing.status || '').toLowerCase() !== 'approved') {
      return res.status(400).json({ ok: false, error: 'Only approved live listings can be boosted' });
    }

    const productResult = await db.query(
      `SELECT *
       FROM products
       WHERE key = $1 AND type = 'listing_boost' AND active = true
       LIMIT 1`,
      [productKey]
    );
    const product = productResult.rows[0] || null;
    if (!product) return res.status(404).json({ ok: false, error: 'Boost product is not active yet' });

    const rateCard = boostedProduct();
    const payment = await createHostedPayment(db, {
      purpose: 'listing_boost',
      amount: rateCard.price,
      currency: product.currency || 'UGX',
      payer: {
        id: req.userAuth.id,
        name: [req.userAuth.first_name, req.userAuth.last_name].filter(Boolean).join(' '),
        email: req.userAuth.email,
        phone: req.userAuth.phone
      },
      metadata: {
        account_id: req.userAuth.id,
        listing_id: listing.id,
        product_key: rateCard.key,
        boost_tier: product.metadata?.boost_tier || 'basic',
        duration_days: rateCard.duration_days,
        rate_card_version: PRICING.version
      }
    });
    return res.status(201).json({ ok: true, data: payment });
  } catch (error) {
    return next(error);
  }
});

router.post('/payments/webhook/:provider?', async (req, res, next) => {
  try {
    const payment = await handleGenericPaymentWebhook(db, {
      provider: req.params.provider || 'external',
      payload: req.body,
      signature: req.get('verif-hash') || req.get('x-payment-signature') || req.get('x-signature') || '',
      req
    });
    return res.json({ ok: true, data: { payment } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
