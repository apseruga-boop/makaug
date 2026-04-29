const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { asArray, cleanText, isValidEmail, isValidPhone, toNullableInt } = require('../middleware/validation');
const { getSupportEmail, getSupportWhatsappUrl, sendSupportEmail } = require('../services/emailService');
const {
  estimateAdvertisingQuote,
  getAdvertisingPackages,
  summarizeAdvertisingPackageKeys
} = require('../services/advertisingCatalogService');

const router = express.Router();

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
