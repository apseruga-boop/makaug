const express = require('express');

const db = require('../config/database');
const { requireAuthenticatedUser } = require('../middleware/auth');
const { cleanText } = require('../middleware/validation');
const {
  MONETIZATION_SPINE_MARKER,
  createHostedPayment,
  handleGenericPaymentWebhook
} = require('../services/paymentProviderService');

const router = express.Router();

function featureEnabled(name, fallback = false) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value);
}

router.get('/config', async (_req, res, next) => {
  try {
    const products = await db.query(
      `SELECT key, type, name, description, price, currency, billing, active, feature_flag, metadata
       FROM products
       WHERE key IN ('listing_boost_basic','agent_pro_monthly','featured_lender_monthly')
       ORDER BY key ASC`
    ).catch(() => ({ rows: [] }));
    return res.json({
      ok: true,
      data: {
        marker: MONETIZATION_SPINE_MARKER,
        free_default: true,
        flags: {
          listing_boosts_enabled: featureEnabled('MAKAUG_LISTING_BOOSTS_ENABLED', false),
          agent_pro_enabled: featureEnabled('MAKAUG_AGENT_PRO_ENABLED', false),
          featured_lenders_enabled: featureEnabled('MAKAUG_FEATURED_LENDERS_ENABLED', false)
        },
        products: products.rows
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

    const payment = await createHostedPayment(db, {
      purpose: 'listing_boost',
      amount: product.price,
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
        product_key: product.key,
        boost_tier: product.metadata?.boost_tier || 'basic',
        duration_days: product.metadata?.duration_days || 7
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
      provider: req.params.provider || process.env.UGANDA_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'flutterwave',
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
