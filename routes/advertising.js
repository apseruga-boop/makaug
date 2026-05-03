const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const { asArray, cleanText, isValidEmail, isValidPhone, toNullableInt } = require('../middleware/validation');
const { getSupportEmail, getSupportWhatsappUrl, sendSupportEmail } = require('../services/emailService');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { createLead } = require('../services/leadService');
const {
  estimateAdvertisingQuote,
  getAdvertisingPackages,
  summarizeAdvertisingPackageKeys
} = require('../services/advertisingCatalogService');
const {
  getPaymentStatus,
  handlePaymentWebhook
} = require('../services/paymentProviderService');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
}

async function loadUserFromToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!isUuid(decoded?.sub)) return null;
  const result = await db.query(
    `SELECT id, first_name, last_name, phone, email, role, status, preferred_contact_channel, preferred_language, profile_data
     FROM users
     WHERE id = $1 AND status = 'active'
     LIMIT 1`,
    [decoded.sub]
  );
  return result.rows[0] || null;
}

async function requireAdvertiserAuth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    const user = await loadUserFromToken(token);
    const profile = user?.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
    const audience = String(profile.audience || profile.account_kind || profile.seeker_type || '').toLowerCase();
    if (!user || (user.role !== 'admin' && audience !== 'advertiser')) {
      return res.status(403).json({ ok: false, error: 'Advertiser account required' });
    }
    req.userAuth = user;
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }
}

function campaignOwnerClause(user, values) {
  const email = cleanText(user.email).toLowerCase();
  const phone = cleanText(user.phone);
  values.push(email || null, phone || null);
  return `(LOWER(advertiser_email) = $${values.length - 1} OR advertiser_phone = $${values.length})`;
}

function buildInvoiceNumber(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const code = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, '0');
  return `MK-INV-${stamp}-${code}`;
}

function buildProviderPaymentUrl(paymentLinkId) {
  const base = String(process.env.PAYMENT_LINK_BASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/pay/${paymentLinkId}`;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function normalizeChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return ['whatsapp', 'email', 'phone'].includes(channel) ? channel : 'whatsapp';
}

function packageLabels(keys = []) {
  return summarizeAdvertisingPackageKeys(keys).map((item) => `${item.label} (UGX ${Number(item.price_ugx || 0).toLocaleString('en-UG')})`);
}

router.get('/packages', (_req, res) => {
  return res.json({
    ok: true,
    data: getAdvertisingPackages()
  });
});

router.get('/placements', async (_req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT key, label, page_key, slot_type, size_label, is_premium, base_price_ugx, preview_image_url, notes
       FROM advertising_placements
       WHERE is_active = true
       ORDER BY sort_order ASC, label ASC`
    );
    return res.json({ ok: true, data: rows.rows });
  } catch (error) {
    if (String(error.message || '').includes('advertising_placements')) {
      return res.json({ ok: true, data: [] });
    }
    return next(error);
  }
});

router.get('/dashboard', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const email = cleanText(req.userAuth.email).toLowerCase();
    const phone = cleanText(req.userAuth.phone);
    const [inquiries, campaigns, invoices, links] = await Promise.all([
      db.query(
        `SELECT *
         FROM advertising_inquiries
         WHERE (LOWER(email) = $1 AND $1::text IS NOT NULL)
            OR (phone = $2 AND $2::text IS NOT NULL)
         ORDER BY created_at DESC
         LIMIT 50`,
        [email || null, phone || null]
      ),
      db.query(
        `SELECT *
         FROM advertising_campaigns
         WHERE (LOWER(advertiser_email) = $1 AND $1::text IS NOT NULL)
            OR (advertiser_phone = $2 AND $2::text IS NOT NULL)
         ORDER BY created_at DESC
         LIMIT 50`,
        [email || null, phone || null]
      ),
      db.query(
        `SELECT i.*
         FROM invoices i
         LEFT JOIN advertising_campaigns c ON c.id = i.campaign_id
         WHERE i.advertiser_id = $1
            OR (LOWER(c.advertiser_email) = $2 AND $2::text IS NOT NULL)
            OR (c.advertiser_phone = $3 AND $3::text IS NOT NULL)
         ORDER BY i.created_at DESC
         LIMIT 50`,
        [req.userAuth.id, email || null, phone || null]
      ),
      db.query(
        `SELECT pl.*
         FROM payment_links pl
         LEFT JOIN advertising_campaigns c ON c.id = pl.related_campaign_id
         WHERE pl.advertiser_id = $1
            OR (LOWER(c.advertiser_email) = $2 AND $2::text IS NOT NULL)
            OR (c.advertiser_phone = $3 AND $3::text IS NOT NULL)
         ORDER BY pl.created_at DESC
         LIMIT 50`,
        [req.userAuth.id, email || null, phone || null]
      )
    ]);
    return res.json({
      ok: true,
      data: {
        profile: {
          first_name: req.userAuth.first_name,
          last_name: req.userAuth.last_name,
          email: req.userAuth.email,
          phone: req.userAuth.phone,
          preferred_language: req.userAuth.preferred_language,
          preferred_contact_channel: req.userAuth.preferred_contact_channel
        },
        inquiries: inquiries.rows,
        campaigns: campaigns.rows,
        invoices: invoices.rows,
        paymentLinks: links.rows,
        summary: {
          inquiries: inquiries.rows.length,
          campaigns: campaigns.rows.length,
          activeCampaigns: campaigns.rows.filter((item) => item.status === 'live').length,
          unpaidInvoices: invoices.rows.filter((item) => item.status !== 'paid').length
        }
      }
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, data: { inquiries: [], campaigns: [], invoices: [], paymentLinks: [], summary: {}, provider_missing: true } });
    }
    return next(error);
  }
});

router.post('/campaigns', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name || req.body.name || [req.userAuth.first_name, req.userAuth.last_name].filter(Boolean).join(' ')) || 'Advertiser';
    const businessName = cleanText(req.body.business_name || req.body.company) || fullName;
    const email = cleanText(req.body.email || req.userAuth.email);
    const phone = cleanText(req.body.phone || req.userAuth.phone);
    const goal = cleanText(req.body.goal || req.body.objective || 'listing_promotion').toLowerCase();
    const packageKey = cleanText(req.body.package_key || req.body.package || goal).toLowerCase();
    const productInterests = asArray(req.body.product_interests || [packageKey]).map((item) => cleanText(item).toLowerCase()).filter(Boolean);
    const targetLocations = normalizeList(req.body.target_locations || req.body.locations);
    const targetListingTypes = normalizeList(req.body.target_listing_types || req.body.listing_types);
    const budgetUgx = toNullableInt(req.body.budget_ugx || req.body.budget);
    const pkg = summarizeAdvertisingPackageKeys(productInterests).at(0) || null;
    const quotedAmount = Math.max(0, budgetUgx || Number(pkg?.price_ugx || estimateAdvertisingQuote(productInterests)) || 0);
    const campaignName = cleanText(req.body.campaign_name || req.body.name || `${businessName} MakaUg campaign`);

    if (!email && !phone) return res.status(400).json({ ok: false, error: 'email or phone is required' });
    if (email && !isValidEmail(email)) return res.status(400).json({ ok: false, error: 'email is invalid' });
    if (phone && !isValidPhone(phone)) return res.status(400).json({ ok: false, error: 'phone is invalid' });

    const inquiry = await db.query(
      `INSERT INTO advertising_inquiries (
        full_name, business_name, email, phone, preferred_contact_channel,
        product_interests, target_locations, target_listing_types, audience_segments,
        budget_ugx, desired_duration_days, message, source, estimated_value_ugx
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,'advertiser_dashboard',$13)
      RETURNING *`,
      [
        fullName,
        businessName,
        email || null,
        phone || null,
        normalizeChannel(req.body.preferred_contact_channel || req.userAuth.preferred_contact_channel),
        JSON.stringify(productInterests),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(normalizeList(req.body.audience_segments || req.body.audiences)),
        budgetUgx,
        toNullableInt(req.body.desired_duration_days || req.body.duration_days),
        cleanText(req.body.message || req.body.creative_brief) || null,
        quotedAmount
      ]
    );

    const campaign = await db.query(
      `INSERT INTO advertising_campaigns (
        inquiry_id, advertiser_name, advertiser_email, advertiser_phone, campaign_name,
        package_key, package_label, placements, target_locations, target_listing_types,
        audience_segments, creative_brief, ai_copy, advertiser_approval_status,
        report_cadence, target_pages, pricing_model, quoted_amount_ugx, status, payment_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,'sent','weekly',$14::jsonb,$15,$16,'draft','unpaid')
      RETURNING *`,
      [
        inquiry.rows[0].id,
        businessName,
        email || null,
        phone || null,
        campaignName,
        pkg?.key || packageKey,
        pkg?.label || packageKey,
        JSON.stringify(normalizeList(req.body.placements || pkg?.placements || [])),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(normalizeList(req.body.audience_segments || req.body.audiences)),
        cleanText(req.body.creative_brief || req.body.message) || null,
        JSON.stringify({
          headline: cleanText(req.body.creative_headline || campaignName),
          body: cleanText(req.body.creative_body || req.body.message || 'Sponsored MakaUg campaign submitted for review.'),
          call_to_action: cleanText(req.body.creative_cta || 'View on MakaUg')
        }),
        JSON.stringify(normalizeList(req.body.target_pages || [])),
        pkg?.pricing_model || 'fixed_days',
        quotedAmount
      ]
    );

    await createLead(db, {
      userId: req.userAuth.id,
      campaignId: campaign.rows[0].id,
      contact: {
        userId: req.userAuth.id,
        name: fullName,
        email,
        phone,
        preferredContactChannel: req.userAuth.preferred_contact_channel,
        preferredLanguage: req.userAuth.preferred_language,
        roleType: 'advertiser',
        locationInterest: targetLocations.join(', '),
        categoryInterest: productInterests.join(', '),
        budgetRange: quotedAmount ? String(quotedAmount) : ''
      },
      source: 'advertiser_dashboard',
      leadType: 'advertiser',
      category: productInterests.join(', '),
      location: targetLocations.join(', '),
      budget: quotedAmount,
      message: `Advertiser campaign created: ${campaignName}`,
      metadata: { advertising_inquiry_id: inquiry.rows[0].id, advertising_campaign_id: campaign.rows[0].id }
    });

    return res.status(201).json({ ok: true, data: { inquiry: inquiry.rows[0], campaign: campaign.rows[0] } });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/payment-link', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const values = [req.params.id];
    const ownerWhere = campaignOwnerClause(req.userAuth, values);
    const campaign = await db.query(
      `SELECT *
       FROM advertising_campaigns
       WHERE id = $1 AND ${ownerWhere}
       LIMIT 1`,
      values
    );
    if (!campaign.rows.length) return res.status(404).json({ ok: false, error: 'Campaign not found' });
    const item = campaign.rows[0];
    const amount = Math.max(0, parseInt(req.body.amount || item.quoted_amount_ugx || 0, 10) || 0);
    const invoice = await db.query(
      `INSERT INTO invoices (
        advertiser_id, campaign_id, invoice_number, amount, currency, status,
        payment_method, payment_provider, due_date
      )
      VALUES ($1,$2,$3,$4,$5,'issued',$6,$7,$8)
      RETURNING *`,
      [
        req.userAuth.id,
        item.id,
        buildInvoiceNumber(),
        amount,
        cleanText(req.body.currency || 'UGX').toUpperCase().slice(0, 8),
        cleanText(req.body.payment_method || 'payment_link') || 'payment_link',
        cleanText(process.env.PAYMENT_PROVIDER || 'manual'),
        cleanText(req.body.due_date) || null
      ]
    );
    const paymentProvider = cleanText(process.env.PAYMENT_PROVIDER || 'manual');
    const link = await db.query(
      `INSERT INTO payment_links (
        provider, amount, currency, purpose, related_campaign_id, advertiser_id,
        invoice_id, status, provider_reference, checkout_url, expires_at
      )
      VALUES ($1,$2,$3,'campaign',$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        paymentProvider,
        amount,
        invoice.rows[0].currency,
        item.id,
        req.userAuth.id,
        invoice.rows[0].id,
        buildProviderPaymentUrl(invoice.rows[0].id) ? 'created' : 'pending',
        invoice.rows[0].invoice_number,
        buildProviderPaymentUrl(invoice.rows[0].id),
        req.body.expires_at || null
      ]
    );
    await db.query(
      `UPDATE advertising_campaigns
       SET status = 'awaiting_payment',
           payment_status = 'invoiced',
           payment_url = $2,
           payment_reference = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [item.id, link.rows[0].checkout_url || null, invoice.rows[0].invoice_number]
    );
    return res.status(201).json({
      ok: true,
      data: {
        invoice: invoice.rows[0],
        paymentLink: link.rows[0],
        providerConfigured: Boolean(link.rows[0].checkout_url),
        providerMissing: !link.rows[0].checkout_url,
        message: link.rows[0].checkout_url
          ? 'Payment link created.'
          : 'Payment provider is not configured. MakaUg has logged the invoice and admin can mark manual payment.'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/payment-links/:id/status', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const status = await getPaymentStatus(db, req.params.id);
    if (!status) return res.status(404).json({ ok: false, error: 'Payment link not found' });
    return res.json({ ok: true, data: status });
  } catch (error) {
    return next(error);
  }
});

router.post('/payment-webhook/:provider?', async (req, res, next) => {
  try {
    const invoice = await handlePaymentWebhook(db, {
      provider: req.params.provider || process.env.PAYMENT_PROVIDER || 'manual',
      payload: req.body,
      signature: req.get('x-payment-signature') || req.get('x-signature') || '',
      req
    });
    return res.json({ ok: true, data: { invoice } });
  } catch (error) {
    return next(error);
  }
});

router.post('/inquiries', async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name || req.body.name);
    const businessName = cleanText(req.body.business_name || req.body.company);
    const email = cleanText(req.body.email);
    const phone = cleanText(req.body.phone);
    const preferredContactChannel = normalizeChannel(req.body.preferred_contact_channel || req.body.contact_channel);
    const productInterests = asArray(req.body.product_interests || req.body.products || req.body.package_keys)
      .map((item) => cleanText(item).toLowerCase())
      .filter(Boolean);
    const targetLocations = normalizeList(req.body.target_locations || req.body.locations);
    const targetListingTypes = normalizeList(req.body.target_listing_types || req.body.listing_types);
    const audienceSegments = normalizeList(req.body.audience_segments || req.body.audiences);
    const linkedPropertyId = cleanText(req.body.linked_property_id) || null;
    const budgetUgx = toNullableInt(req.body.budget_ugx || req.body.budget);
    const desiredStartDate = cleanText(req.body.desired_start_date || req.body.start_date) || null;
    const desiredDurationDays = toNullableInt(req.body.desired_duration_days || req.body.duration_days);
    const message = cleanText(req.body.message || req.body.notes) || null;
    const source = cleanText(req.body.source) || 'website';

    const errors = [];
    if (!fullName) errors.push('full_name is required');
    if (!email && !phone) errors.push('email or phone is required');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (!productInterests.length) errors.push('select at least one advertising product');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const estimatedValue = estimateAdvertisingQuote(productInterests);
    const inserted = await db.query(
      `INSERT INTO advertising_inquiries (
        full_name,
        business_name,
        email,
        phone,
        preferred_contact_channel,
        product_interests,
        target_locations,
        target_listing_types,
        audience_segments,
        linked_property_id,
        budget_ugx,
        desired_start_date,
        desired_duration_days,
        message,
        source,
        estimated_value_ugx
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        fullName,
        businessName || null,
        email || null,
        phone || null,
        preferredContactChannel,
        JSON.stringify(productInterests),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(audienceSegments),
        linkedPropertyId,
        budgetUgx,
        desiredStartDate,
        desiredDurationDays,
        message,
        source,
        estimatedValue
      ]
    );

    const inquiry = inserted.rows[0];
    captureLearningEvent({
      eventName: 'advertising_inquiry_submitted',
      source,
      channel: preferredContactChannel,
      sessionId: `advertising_inquiry:${inquiry.id}`,
      externalUserId: phone || email || fullName,
      inputText: message || `${businessName || fullName} wants advertising: ${productInterests.join(', ')}`,
      responseText: 'Advertising inquiry saved for MakaUg proposal and creative preview.',
      payload: {
        id: inquiry.id,
        full_name: fullName,
        business_name: businessName || null,
        product_interests: productInterests,
        target_locations: targetLocations,
        target_listing_types: targetListingTypes,
        audience_segments: audienceSegments,
        estimated_value_ugx: estimatedValue,
        preferred_contact_channel: preferredContactChannel
      },
      entities: {
        products: productInterests,
        locations: targetLocations,
        budget_ugx: budgetUgx
      },
      dedupeKey: `advertising_inquiry:${inquiry.id}`,
      requestIp: req.ip,
      userAgent: req.get('user-agent')
    });
    const supportEmail = getSupportEmail();
    const whatsappUrl = getSupportWhatsappUrl();
    const labels = packageLabels(productInterests);

    try {
      await sendSupportEmail({
        to: supportEmail,
        subject: `[MakaUg Ads] New advertising inquiry - ${businessName || fullName}`,
        text: [
          'New advertising inquiry received on makaug.com.',
          '',
          `Inquiry ID: ${inquiry.id}`,
          `Name: ${fullName}`,
          `Business: ${businessName || '-'}`,
          `Email: ${email || '-'}`,
          `Phone: ${phone || '-'}`,
          `Preferred Contact: ${preferredContactChannel}`,
          `Estimated Package Value: UGX ${Number(estimatedValue || 0).toLocaleString('en-UG')}`,
          `Budget: ${budgetUgx ? `UGX ${Number(budgetUgx).toLocaleString('en-UG')}` : '-'}`,
          `Target Locations: ${targetLocations.join(', ') || '-'}`,
          `Listing Types: ${targetListingTypes.join(', ') || '-'}`,
          `Audience Segments: ${audienceSegments.join(', ') || '-'}`,
          '',
          'Selected Products:',
          labels.length ? labels.map((label) => `- ${label}`).join('\n') : '-',
          '',
          message ? `Message: ${message}` : '',
          '',
          'Admin action: open Advertising Inquiries, prepare creative/package proposal, then mark the campaign paid/live when ready.'
        ].filter(Boolean).join('\n'),
        replyTo: email || undefined
      });

      if (email) {
        await sendSupportEmail({
          to: email,
          subject: 'MakaUg received your advertising inquiry',
          text: [
            `Hello ${fullName},`,
            '',
            'Thank you for asking about advertising with MakaUg.',
            'We have received your inquiry and will help you choose the best placement for your goal.',
            '',
            `Inquiry ID: ${inquiry.id}`,
            `Preferred contact: ${preferredContactChannel}`,
            `Selected products: ${labels.join(', ') || 'Advertising package'}`,
            targetLocations.length ? `Target locations: ${targetLocations.join(', ')}` : '',
            '',
            'Next step: our team will confirm the package, prepare a preview, and send payment details before the ad goes live.',
            '',
            `WhatsApp MakaUg: ${whatsappUrl}`,
            `Email: ${supportEmail}`
          ].filter(Boolean).join('\n')
        });
      }
    } catch (emailError) {
      logger.warn('Advertising inquiry email notification failed', {
        inquiryId: inquiry.id,
        error: emailError.message || 'email_failed'
      });
    }

    return res.status(201).json({
      ok: true,
      data: {
        ...inquiry,
        selected_packages: summarizeAdvertisingPackageKeys(productInterests),
        support_email: supportEmail,
        whatsapp_url: whatsappUrl
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
